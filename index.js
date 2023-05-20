// @ts-check

import openai from 'openai';
import fs from 'fs/promises';
import cheerio from 'cheerio';
import { exec } from 'child_process';

import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	ListObjectsCommand
} from "@aws-sdk/client-s3";

import packageJson from './package.json' assert { type: "json" };

const prompts = packageJson.prompts;

const BUCKET = 'mchonedev-gpt-summarizer';
const TARGET_TOKENS = 3500;
const TOKEN_SAFTY_NET = 0.9
const SUMMARIZATION_OVERLAP = 0.2;
const SUMMARIZATION_OVERLAP_RATIO = 1 - SUMMARIZATION_OVERLAP;

const client = new S3Client({ region: process.env.REGION || 'us-east-1' });

/**
 * 
 * @param {unknown} condition 
 * @param {string?} message 
 * @returns {asserts condition}
 */
const invariant = (condition, message) => {
	if (condition) {
		return;
	}

	throw new Error(message || 'Invariant failed');
};

const apiKey = process.env.OPENAI_API_KEY
invariant(apiKey, 'No OpenAI API key found')

const config = new openai.Configuration({
	apiKey
});

const openAiClient = new openai.OpenAIApi(config);

/**
 * 
 * @param {string} str 
 * @returns {number}
 */
const tokens = (str) => Math.ceil(str.length / 4)

const runCommand = (command) => {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
};

/**
 * 
 * @param {string} url 
 * @param {string} uniq 
 * @returns {Promise<string>}
 */
const downloadSubs = async (url, uniq) => {
	await runCommand(`yt-dlp --write-subs --write-auto-subs --sub-lang en --skip-download --sub-format ttml -o './output/${uniq}.%(ext)s' ${url}`);

	const input = await fs.readFile(`./output/${uniq}.en.ttml`, 'utf8');

	const $ = cheerio.load(input, { xmlMode: true });
	const ps = $('p');

	let str = '';

	for (let p of ps) {
		str += ' ' + $(p).text();
	}

	return str;
}

/**
 * 
 * @param {string} systemPrompt 
 * @param {string} userPrompt 
 * @returns {Promise<string>}
 */
const chatCompletion = async (systemPrompt, userPrompt) => {
	const systemTokens = tokens(systemPrompt);
	const userTokens = tokens(userPrompt);
	console.log({ systemTokens, userTokens, totalTokens: systemTokens + userTokens })

	return openAiClient.createChatCompletion({
		model: 'gpt-3.5-turbo',
		messages: [
			{
				role: 'system',
				content: systemPrompt
			},
			{
				role: 'user',
				content: userPrompt
			}
		]
	}).then(response => {
		const msg = response.data.choices[0].message?.content

		if (!msg) {
			throw new Error('No message found')
		}

		return msg;
	}).catch(e => {
		console.error(e)
		console.log({ systemPrompt, userPrompt })
		throw e;
	})
}

/**
 * 
 * @param {string} input 
 * @returns {Promise<Array<string>>}
 */
const summarizeParts = async (input) => {
	const words = input.match(/[^\s]+/g);
	if (!words) {
		return [];
	}

	let start = 0;
	let end = 0;

	let responses = [];

	const systemPrompt = prompts.PARTIAL_SUMMARY;

	const systemPromptTokens = tokens(systemPrompt);
	const target = (TARGET_TOKENS - systemPromptTokens) * TOKEN_SAFTY_NET;

	while (start < words.length) {
		end += 1;
		const prompt = words.slice(start, end).join(" ").trim();

		const tokenCount = tokens(prompt);

		if (tokenCount < target && end < words.length) continue;

		const response = chatCompletion(
			systemPrompt,
			prompt
		)

		responses.push(response)

		if (tokenCount < target) {
			break;
		}

		start += (end - start) * SUMMARIZATION_OVERLAP_RATIO;
		end = start;
	}

	return Promise.all(responses);
}

/**
 * 
 * @param {string} video 
 * @returns {Promise<void>}
 */
const extractValue = async (video) => {
	const url = video;
	const uniq = new URLSearchParams(url.split('?')[1]).get('v')

	const finalSummary = await getObjectFromS3(`final-summary-${uniq}`);
	if (finalSummary !== undefined) {
		console.log(finalSummary)
		return;
	}

	let summaries = (await getObjectFromS3(`all-summaries-${uniq}`))?.split('\n\n');

	if (!summaries) {
		invariant(uniq, 'No video id found')
		let str = await downloadSubs(url, uniq)

		await fs.writeFile(`./output/output-${uniq}.txt`, str)
		summaries = await summarizeParts(str);
	}

	await putObjectToS3(`all-summaries-${uniq}`, summaries.join('\n\n'));

	summaries = summaries.map(s => `SUMMARY: ${s}`)

	let totalTokens = summaries.map(tokens).reduce((a, b) => a + b, 0);

	while (totalTokens > TARGET_TOKENS) {
		console.log("unable to summarize in one pass, trying to further simplify");
		let tokenCount = 0;
		let summaryIndex = 0;
		let summariesToSummarize = [];

		while (tokenCount < TARGET_TOKENS) {
			tokenCount += tokens(summaries[summaryIndex]);
			summariesToSummarize.push(summaries[summaryIndex]);
			summaryIndex += 1;
		}

		const systemPrompt = prompts.INTERMEDIATE_SUMMARY;

		const response = await chatCompletion(
			systemPrompt,
			summariesToSummarize.join('\n\n')
		);

		summaries.splice(0, summaryIndex, response);
		totalTokens = summaries.map(tokens).reduce((a, b) => a + b, 0);
	}

	const systemPrompt = prompts.FINAL_SUMMARY;

	const response = await chatCompletion(
		systemPrompt,
		summaries.join('\n\n')
	);

	invariant(response, 'No response found');

	console.log(response)
	await putObjectToS3(`final-summary-${uniq}`, response);
}

/**
 * 
 * @param {string} key 
 * @returns {Promise<string | undefined>}
 */
const getObjectFromS3 = async (key) => {
	const { Contents } = await client.send(new ListObjectsCommand({
		Bucket: BUCKET,
		Prefix: key
	}));

	if (!Contents?.length) {
		return;
	}

	const obj = await client.send(new GetObjectCommand({
		Bucket: BUCKET,
		Key: key
	}));

	return obj.Body?.transformToString('utf-8');
}

/**
 * 
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
const putObjectToS3 = async (key, value) => {
	await client.send(new PutObjectCommand({
		Bucket: BUCKET,
		Key: key,
		Body: value
	}));
}


await extractValue(process.argv[2])
