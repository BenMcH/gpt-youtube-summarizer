// @ts-check

import * as cheerio from "cheerio";
import { runCommand } from "./utils.js";

/**
 * 
 * @param {string} url 
 * @param {string} uniq 
 * @returns {Promise<string>}
 */
export const downloadSubs = async (url, uniq) => {
	const fileName = `./output/${uniq}`
	const { stdout: input } = await runCommand(`yt-dlp --write-subs --write-auto-subs --sub-lang en --skip-download --sub-format ttml -o '${fileName}.%(ext)s' ${url} && cat ${fileName}.en.ttml && rm ${fileName}.en.ttml`);

	const $ = cheerio.load(input, { xmlMode: true });
	const ps = $('p');

	let str = "";

	for (let p of ps) {
		str += " " + $(p).text();
	}

	return str;
}
