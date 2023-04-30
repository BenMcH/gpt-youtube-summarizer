import openai from 'openai'
import fs from 'fs/promises';
import { exec } from 'child_process';

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

await runCommand(`yt-dlp --write-subs --sub-lang en --skip-download --sub-format srt -o 'input.%(ext)s' ${process.argv[2]}`)
const uniq = Date.now();

const config = new openai.Configuration({
	apiKey: process.env.OPENAI_API_KEY
})
const api = new openai.OpenAIApi(config);
const file = await fs.readFile('./input.en.vtt')

const lines = file.toString().split("\n");

const firstBlank = lines.indexOf('');
const withoutHeaders = lines.slice(firstBlank);
const withoutTimestamps = withoutHeaders.filter(line => !line.match(/^\d{2}:\d{2}:\d{2}.\d{3}\s*-->/) && !line.includes('<c>') && line.replace(/\s*/g, '').length > 0);

const withoutRepeats = withoutTimestamps.filter((line, index) => index > 0 && withoutTimestamps[index] != withoutTimestamps[index - 1])

await fs.writeFile(`output-${uniq}.txt`, withoutRepeats.join('\n'))

const AVG_TOKENS_PER_LINE = withoutRepeats.map(line => line.length / 4).reduce((total, acc) => total + acc) / withoutRepeats.length;
const TARGET_TOKENS = 2000;
const SLICE_LINES = TARGET_TOKENS / AVG_TOKENS_PER_LINE;
const STEP_LINES = SLICE_LINES / 1.25;

let page = 0;
let responses = [];

while (page * STEP_LINES < withoutRepeats.length) {
	const start = page * STEP_LINES;
	const end = start + SLICE_LINES;
	const prompt = withoutRepeats.slice(start, end).join("\n");

	const response = api.createChatCompletion({
		model: 'gpt-3.5-turbo',
		messages: [
			{
				role: 'system',
				content: 'you are a helpful ai companion whose goal is to ingest transcribed speech from youtube videos and return a condensed summary of that section\'s information. Interesting facts and takeaways should be prioritized in these summaries'
			},
			{
				role: 'user',
				content: prompt
			}
		]
	}).then(response => response.data.choices[0].message.content)

	responses.push(response)

	page += 1
}

const answers = await Promise.all(responses);

await fs.writeFile(`all_summaries-${uniq}.json`, JSON.stringify(answers));


const response = await api.createChatCompletion({
	model: 'gpt-3.5-turbo',
	messages: [
		{
			role: 'system',
			content: 'you are a helpful ai companion whose goal is to summarize a collection of summaries generated from overlapping sections of captions. there may be duplicated information among the sections, so be sure to remove any of those that may be encountered while retaining as much unique information and interesting facts as possible. output should be delivered in paragraph form and be between 1 and 5 paragraphs depending on the content received'
		},
		{
			role: 'user',
			content: `SUMMARY: ${answers.join("\n\nSUMMARY:\n")}`
		}
	]
})

await fs.writeFile(`final_summary-${uniq}.json`, JSON.stringify(response.data.choices[0].message.content))

console.log(response.data.choices[0].message.content)
