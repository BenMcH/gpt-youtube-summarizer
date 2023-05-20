// @ts-check

import fs from "fs/promises";
import * as cheerio from "cheerio";
import { runCommand } from "./utils.js";

/**
 * 
 * @param {string} url 
 * @param {string} uniq 
 * @returns {Promise<string>}
 */
export const downloadSubs = async (url, uniq) => {
	await runCommand(`yt-dlp --write-subs --write-auto-subs --sub-lang en --skip-download --sub-format ttml -o './output/${uniq}.%(ext)s' ${url}`);

	const input = await fs.readFile(`./output/${uniq}.en.ttml`, "utf8");

	const $ = cheerio.load(input, { xmlMode: true });
	const ps = $('p');

	let str = "";

	for (let p of ps) {
		str += " " + $(p).text();
	}

	return str;
}
