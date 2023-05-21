//@ts-check

import { exec } from "child_process";

/**
 * 
 * @param {unknown} condition 
 * @param {string?} message 
 * @returns {asserts condition}
 */
export const invariant = (condition, message) => {
	if (condition) {
		return;
	}

	throw new Error(message || "Invariant failed");
};

/**
 * 
 * @param {string} str 
 * @returns {number}
 */
export const tokens = (str) => Math.ceil(str.length / 4)

/**
 * 
 * @param {string} command 
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export const runCommand = (command) => {
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
