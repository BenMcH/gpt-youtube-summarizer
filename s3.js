// @ts-check

import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	ListObjectsCommand
} from "@aws-sdk/client-s3";

import { BUCKET } from "./constants.js";

const client = new S3Client({ region: process.env.REGION || "us-east-1" });

/**
 * 
 * @param {string} key 
 * @returns {Promise<string | undefined>}
 */
export const getObjectFromS3 = async (key) => {
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

	return obj.Body?.transformToString("utf-8");
}

/**
 * 
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
export const putObjectToS3 = async (key, value) => {
	await client.send(new PutObjectCommand({
		Bucket: BUCKET,
		Key: key,
		Body: value
	}));
}
