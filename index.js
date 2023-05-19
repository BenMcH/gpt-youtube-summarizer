// @ts-check

import openai from 'openai';
import fs from 'fs/promises';
import cheerio from 'cheerio';
import { exec } from 'child_process';

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand, GetCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const TARGET_TOKENS = 3500;
const TABLE_NAME = process.env.DYNAMO_TABLE || 'openai-summaries';

const client = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const ddbDocClient = DynamoDBDocumentClient.from(client);

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

	while (start < words.length) {
		end += 1;
		const prompt = words.slice(start, end).join(" ").trim();

		const tokenCount = tokens(prompt);

		if (tokenCount > TARGET_TOKENS * 0.8 || end >= words.length) {
			const systemPrompt = 'you are a helpful ai companion whose goal is to ingest transcribed speech and return a condensed summary of that section\'s information. Interesting facts and takeaways should be prioritized in these summaries. Because these are automatically generated transcriptions, there may be some errors (such as misspellings) in the text. Please do your best to correct these errors while retaining the original meaning of the text. There may also be sponsored messages in the transcriptions that advertise products or services, please remove these from the summary.';
			const response = chatCompletion(
				systemPrompt,
				prompt
			)

			responses.push(response)

			if (tokenCount < TARGET_TOKENS * 0.8) {
				break;
			}

			start += (end - start) * 0.8;
			end = start;
		}
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

	const finalSummary = await getStringFromDynamo(`final-summary-${uniq}`);
	if (finalSummary !== undefined) {
		console.log(finalSummary)
		return;
	}

	let summaries = (await getStringFromDynamo(`all-summaries-${uniq}`))?.split('\n\n');

	if (!summaries) {
		invariant(uniq, 'No video id found')
		let str = await downloadSubs(url, uniq)

		await fs.writeFile(`./output/output-${uniq}.txt`, str)
		summaries = await summarizeParts(str);
	}

	// await fs.writeFile(`./output/all_summaries-${uniq}.json`, JSON.stringify(summaries));
	await putStringToDynamo(`all-summaries-${uniq}`, summaries.join('\n\n'));

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

		const response = await chatCompletion(
			'you are a helpful ai whose goal is to receive several summaries of information from adjacent transcriptions from the same source material and create a more succinct summary of the information presented.',
			summariesToSummarize.join('\n\n')
		);

		summaries.splice(0, summaryIndex, response);
		totalTokens = summaries.map(tokens).reduce((a, b) => a + b, 0);
	}

	const response = await chatCompletion(
		'you are a helpful ai companion whose goal is to write a short blog post in markdown about the information presented to you. there may be duplicated information among the sections, so be sure to remove any of those that may be encountered while retaining as much unique information and interesting facts as possible. output should be delivered in paragraph form using markdown formatting and be between 2 and 8 paragraphs depending on the content received',
		summaries.join('\n\n')
	);

	invariant(response, 'No response found');

	await putStringToDynamo(`final-summary-${uniq}`, response);

	console.log(response)
}

/**
 * 
 * @param {string} key 
 * @returns {Promise<string | undefined>}
 */
const getStringFromDynamo = async (key) => {
	const { Item } = await ddbDocClient.send(new GetCommand({
		TableName: TABLE_NAME,
		Key: {
			key
		}
	}));


	return Item?.value;
}

/**
 * 
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
const putStringToDynamo = async (key, value) => {
	await ddbDocClient.send(new PutCommand({
		TableName: TABLE_NAME,
		Item: {
			key,
			value
		}
	}));
}


await extractValue(process.argv[2])
