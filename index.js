// @ts-check

import fs from "fs/promises";
import express from "express";

import { getObjectFromS3, putObjectToS3 } from "./s3.js";
import { invariant, tokens } from "./utils.js";
import { downloadSubs } from "./yt-dlp.js";
import { chatCompletion, recursivelySummarize, summarizeParts } from "./openai.js";
import { TARGET_TOKENS, prompts } from "./constants.js";

const app = express();

app.get("/", async (req, res) => {
	const url = req.query.url;
	invariant(typeof url === "string", "No url found");
	const summary = await extractValue(url);
	res.send({ summary });
});

/**
 * 
 * @param {string} video 
 * @returns {Promise<void>}
 */
const extractValue = async (video) => {
	const url = video;
	const uniq = new URLSearchParams(url.split("?")[1]).get("v")

	const finalSummaryFromS3 = await getObjectFromS3(`final-summary-${uniq}`);
	if (finalSummaryFromS3 !== undefined) {
		console.log(finalSummaryFromS3)
		return;
	}

	let summaries = (await getObjectFromS3(`all-summaries-${uniq}`))?.split("\n\n");

	if (!summaries) {
		invariant(uniq, "No video id found")
		summaries = await downloadSubs(url, uniq).then(str => summarizeParts(str))

		if (!summaries || summaries?.length === 0) {
			throw new Error("No summaries found")
		}

		await fs.writeFile(`./output/output-${uniq}.txt`, summaries)
	}

	let megaSummary = summaries.join("\n\n");

	await putObjectToS3(`all-summaries-${uniq}`, megaSummary);

	let totalTokens = summaries.map(tokens).reduce((a, b) => a + b, 0);

	if (totalTokens > TARGET_TOKENS) {
		megaSummary = await recursivelySummarize(summaries);
	}

	const systemPrompt = prompts.FINAL_SUMMARY;

	const finalSUmmary = await chatCompletion(
		systemPrompt,
		megaSummary
	);

	invariant(finalSUmmary, "No response found");

	console.log(finalSUmmary)
	await putObjectToS3(`final-summary-${uniq}`, finalSUmmary);
}

if (process.argv.length > 2) {
	await extractValue(process.argv[2])
	process.exit(0);
}

app.listen(3000, () => {
	console.log("Listening on port 3000");
});

