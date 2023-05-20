// @ts-check

import openai from "openai"
import { invariant, tokens } from "./utils.js";
import { SUMMARIZATION_OVERLAP_RATIO, TARGET_TOKENS, TOKEN_SAFTY_NET } from "./constants.js";
import packageJson from "./package.json" assert { type: "json" };

const prompts = packageJson.prompts;

const apiKey = process.env.OPENAI_API_KEY
invariant(apiKey, "No OpenAI API key found")

const config = new openai.Configuration({
	apiKey
});

const openAiClient = new openai.OpenAIApi(config);

/**
 * 
 * @param {string} systemPrompt 
 * @param {string} userPrompt 
 * @returns {Promise<string>}
 */
export const chatCompletion = async (systemPrompt, userPrompt) => {
	const systemTokens = tokens(systemPrompt);
	const userTokens = tokens(userPrompt);
	console.log({ systemTokens, userTokens, totalTokens: systemTokens + userTokens })

	return openAiClient.createChatCompletion({
		model: "gpt-3.5-turbo",
		messages: [
			{
				role: "system",
				content: systemPrompt
			},
			{
				role: "user",
				content: userPrompt
			}
		]
	}).then(response => {
		const msg = response.data.choices[0].message?.content

		if (!msg) {
			throw new Error("No message found")
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
export const summarizeParts = async (input) => {
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
 * @param {string[]} input 
 * @returns {Promise<string>}
 */
export const recursivelySummarize = async (input) => {
	let _input = input.slice();
	let totalTokens = _input.map(tokens).reduce((a, b) => a + b, 0);

	while (totalTokens > TARGET_TOKENS) {
		console.log("unable to summarize in one pass, trying to further simplify");
		let tokenCount = 0;
		let summaryIndex = 0;
		let summariesToSummarize = [];

		while (tokenCount < TARGET_TOKENS * TOKEN_SAFTY_NET) {
			tokenCount += tokens(_input[summaryIndex]);
			summariesToSummarize.push(_input[summaryIndex]);
			summaryIndex += 1;
		}

		const systemPrompt = prompts.INTERMEDIATE_SUMMARY;

		const response = await chatCompletion(
			systemPrompt,
			summariesToSummarize.join("\n\n")
		);

		_input.splice(0, summaryIndex, response);
		totalTokens = _input.map(tokens).reduce((a, b) => a + b, 0);
	}

	return _input.join("\n\n");
}
