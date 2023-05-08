import openai from 'openai'
import fs from 'fs/promises';
import fsSync from 'fs';
import cheerio from 'cheerio'
import { exec } from 'child_process';

const invariant = (condition, message) => {
	if (!condition) {
		throw new Error(message);
	}
};

const apiKey = process.env.OPENAI_API_KEY
invariant(apiKey, 'No OpenAI API key found')

const config = new openai.Configuration({
	apiKey
})

const openAiClient = new openai.OpenAIApi(config);

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
 * @returns {string}
 */
const chatCompletion = async (systemPrompt, userPrompt) => {
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
	}).then(response => response.data.choices[0].message.content)
}

/**
 * 
 * @param {string} input 
 * @returns {Promise<string[]>}
 */
const summarizeParts = async (input) => {
	const words = input.match(/[^\s]+/g);
	const AVG_TOKENS_PER_WORD = words.map(w => w.length / 4).reduce((a, b) => a + b, 0) / words.length;
	const TARGET_TOKENS = 3750;
	const SLICE_WORDS = Math.ceil(TARGET_TOKENS / AVG_TOKENS_PER_WORD);
	const STEP_WORDS = Math.ceil(SLICE_WORDS / 1.25);

	let page = 0;
	let responses = [];

	while (page * STEP_WORDS < words.length) {
		const start = page * STEP_WORDS;
		const end = start + SLICE_WORDS;
		const prompt = words.slice(start, end).join(" ").trim();

		const response = chatCompletion(
			'you are a helpful ai companion whose goal is to ingest transcribed speech and return a condensed summary of that section\'s information. Interesting facts and takeaways should be prioritized in these summaries. Because these are automatically generated transcriptions, there may be some errors (such as misspellings) in the text. Please do your best to correct these errors while retaining the original meaning of the text. There may also be sponsored messages in the transcriptions that advertise products or services, please remove these from the summary.',
			prompt
		)

		responses.push(response)

		page += 1
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

	if (fsSync.existsSync(`./output/final_summary-${uniq}.json`)) {
		const file = await fs.readFile(`./output/final_summary-${uniq}.json`)
		console.log(JSON.parse(file.toString()))
		return;
	}

	let summaries;

	if (fsSync.existsSync(`./output/all_summaries-${uniq}.json`)) {
		summaries = JSON.parse((await fs.readFile(`./output/all_summaries-${uniq}.json`)).toString());
	} else {
		invariant(uniq, 'No video id found')
		let str = await downloadSubs();

		await fs.writeFile(`./output/output-${uniq}.txt`, str)
		summaries = await summarizeParts(str);
	}

	await fs.writeFile(`./output/all_summaries-${uniq}.json`, JSON.stringify(summaries));

	const response = await chatCompletion(
		'you are a helpful ai companion whose goal is to write a short blog post in markdown about the information presented to you. there may be duplicated information among the sections, so be sure to remove any of those that may be encountered while retaining as much unique information and interesting facts as possible. output should be delivered in paragraph form using markdown formatting and be between 2 and 8 paragraphs depending on the content received'
			`SUMMARY: ${summaries.join("\n\nSUMMARY:\n")}`
	);

	await fs.writeFile(`./output/final_summary-${uniq}.txt`, response)

	console.log(response)
}


await extractValue(process.argv[2])
