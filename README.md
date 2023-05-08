# Youtube Video Summarizer

## Description

This project was created as a proof of concept for using GPT apis to summarize long form content from YouTube. To facilitate GPT's ability to analyze video content, `yt-dlp` is used to download the video's subtitles and the subtitles are recursively fed into GPT to generate a summary. The summaries are then combined together and summarized again to generate a multi-paragaph summary of the video, which is then output to the console. 

To avoid additional API costs and to speed up recurring requests, the summaries are cached in local flat files in the output directory. Several stages saved are immediately sending out the full summary, if available and falling back to relying on the previously generated section summaries if a full summary is not available. If no summary is available, the subtitles are downloaded and processed.
