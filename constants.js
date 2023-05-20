import packageJson from './package.json' assert { type: "json" };

export const BUCKET = 'mchonedev-gpt-summarizer'
export const TARGET_TOKENS = 3500;
export const TOKEN_SAFTY_NET = 0.9
export const SUMMARIZATION_OVERLAP = 0.2;
export const SUMMARIZATION_OVERLAP_RATIO = 1 - SUMMARIZATION_OVERLAP;
export const prompts = packageJson.prompts;

