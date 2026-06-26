/*===============================================*\
|| ############################################# ||
|| # WWW.AMITDAS.SITE / Version 1.0.0          # ||
|| # ----------------------------------------- # ||
|| # Copyright 2025 AMITDAS All Rights Reserved # ||
|| ############################################# ||
\*===============================================*/

// api/index.js
const axios = require('axios');
const ytdl = require('ytdl-core');
const playdl = require('play-dl');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { WHATSAPP_INSTANCE_ID, WHATSAPP_ACCESS_TOKEN, RAPIDAPI_KEY, RAPIDAPI_HOST } = require('../config');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadRemoteVideoToTemp(mediaUrl, debugLog) {
  const tempFilePath = path.join(os.tmpdir(), `wa-video-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  debugLog(`Downloading remote video to temp file: ${tempFilePath}`);

  const response = await axios.get(mediaUrl, {
    responseType: 'stream',
    timeout: 120000,
    maxBodyLength: Infinity,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  return tempFilePath;
}

async function uploadTempFileToCatbox(tempFilePath, debugLog) {
  debugLog('Uploading video via catbox.moe');
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(tempFilePath));

  const response = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000
  });

  if (response.status === 200 && typeof response.data === 'string' && response.data.startsWith('http')) {
    return response.data.trim();
  }

  throw new Error(`Catbox upload failed with status ${response.status} and body ${String(response.data)}`);
}

async function uploadTempFileToLitterbox(tempFilePath, debugLog) {
  debugLog('Uploading video via litterbox.catbox.moe');
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('time', '24h');
  form.append('fileToUpload', fs.createReadStream(tempFilePath));

  const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000
  });

  if (response.status === 200 && typeof response.data === 'string' && response.data.startsWith('http')) {
    return response.data.trim();
  }

  throw new Error(`Litterbox upload failed with status ${response.status} and body ${String(response.data)}`);
}

async function uploadTempFileToUguu(tempFilePath, debugLog) {
  debugLog('Uploading video via uguu.se');
  const form = new FormData();
  form.append('file', fs.createReadStream(tempFilePath));

  const response = await axios.post('https://uguu.se/api.php?d=upload_file', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000
  });

  const url = (typeof response.data === 'string' ? response.data.trim() : '');
  if (response.status === 200 && url.startsWith('http')) {
    return url;
  }

  throw new Error(`Uguu upload failed with status ${response.status} and body ${String(response.data)}`);
}

async function uploadTempFileToTransferSh(tempFilePath, debugLog) {
  debugLog('Uploading video via transfer.sh');
  const fileName = path.basename(tempFilePath);
  const response = await axios.put(`https://transfer.sh/${fileName}`, fs.createReadStream(tempFilePath), {
    headers: { 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity,
    timeout: 120000
  });

  if (response.status === 200 && typeof response.data === 'string') {
    return response.data.trim();
  }

  throw new Error(`transfer.sh upload failed with status ${response.status}`);
}

async function uploadTempFileToFileIo(tempFilePath, debugLog) {
  debugLog('Uploading video via file.io');
  const form = new FormData();
  form.append('file', fs.createReadStream(tempFilePath));

  const response = await axios.post('https://file.io/?expires=7d', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000
  });

  if (response.status === 200 && response.data && response.data.link) {
    return response.data.link;
  }

  throw new Error(`file.io upload failed with status ${response.status} and body ${JSON.stringify(response.data)}`);
}

async function downloadVideoWithYtdlp(videoUrl, outputPath, debugLog) {
  debugLog(`Downloading video via yt-dlp to: ${outputPath}`);
  const localPath = path.join(__dirname, '..', 'yt-dlp.exe');
  let commandName = 'yt-dlp';
  if (fs.existsSync(localPath)) {
    commandName = `"${localPath}"`;
    debugLog(`Using local yt-dlp: ${localPath}`);
  } else {
    debugLog('Using global yt-dlp');
  }

  const command = `${commandName} -f "best[height<=720][ext=mp4]/best" -o "${outputPath}" "${videoUrl}"`;
  
  try {
    const { stdout, stderr } = await execPromise(command, { timeout: 120000 });
    debugLog(`yt-dlp output length: ${stdout ? stdout.length : 0}`);
    if (stderr && stderr.trim()) {
      debugLog(`yt-dlp stderr: ${stderr.trim()}`);
    }
  } catch (err) {
    debugLog(`yt-dlp download failed: ${err.message}`);
    throw err;
  }
}

async function ensureStableMediaUrl(mediaUrl, originalLink, source, debugLog) {
  const needsUpload = /googlevideo\.com|youtube\.com|youtu\.be/i.test(mediaUrl) || !/^https?:\/\/.+\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(mediaUrl);
  if (!needsUpload) {
    return mediaUrl;
  }

  debugLog('Media URL looks temporary or unsupported for TextSnap; uploading stable copy.');
  
  let tempFilePath = path.join(os.tmpdir(), `wa-video-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  try {
    if (source === 'play-dl' || source === 'ytdl-core' || /youtube\.com|youtu\.be/i.test(originalLink)) {
      await downloadVideoWithYtdlp(originalLink, tempFilePath, debugLog);
    } else {
      tempFilePath = await downloadRemoteVideoToTemp(mediaUrl, debugLog);
    }
  } catch (downloadErr) {
    debugLog(`Direct download failed: ${downloadErr.message}. Falling back to remote download.`);
    tempFilePath = await downloadRemoteVideoToTemp(mediaUrl, debugLog);
  }

  const uploadErrors = [];

  try {
    const url = await uploadTempFileToCatbox(tempFilePath, debugLog);
    return url;
  } catch (err) {
    uploadErrors.push(`catbox:${err.message}`);
    debugLog(`Catbox upload failed: ${err.message}`);
  }

  try {
    const url = await uploadTempFileToLitterbox(tempFilePath, debugLog);
    return url;
  } catch (err) {
    uploadErrors.push(`litterbox:${err.message}`);
    debugLog(`Litterbox upload failed: ${err.message}`);
  }

  try {
    const url = await uploadTempFileToUguu(tempFilePath, debugLog);
    return url;
  } catch (err) {
    uploadErrors.push(`uguu:${err.message}`);
    debugLog(`Uguu upload failed: ${err.message}`);
  }

  try {
    const url = await uploadTempFileToTransferSh(tempFilePath, debugLog);
    return url;
  } catch (err) {
    uploadErrors.push(`transfer.sh:${err.message}`);
    debugLog(`transfer.sh upload failed: ${err.message}`);
  }

  try {
    const url = await uploadTempFileToFileIo(tempFilePath, debugLog);
    return url;
  } catch (err) {
    uploadErrors.push(`file.io:${err.message}`);
    debugLog(`file.io upload failed: ${err.message}`);
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        debugLog(`Deleted temporary file: ${tempFilePath}`);
      }
    } catch (cleanupErr) {
      debugLog(`Failed to delete temp file: ${cleanupErr.message}`);
    }
  }

  throw new Error(`All stable upload attempts failed: ${uploadErrors.join(' | ')}`);
}

async function fetchRapidApiDownload(link, debugLog) {
  if (!RAPIDAPI_KEY || RAPIDAPI_KEY.includes('YOUR_') || !RAPIDAPI_HOST || RAPIDAPI_HOST.includes('YOUR_')) {
    throw new Error('RapidAPI credentials are not configured. Set RAPIDAPI_KEY and RAPIDAPI_HOST in config.js.');
  }

  debugLog(`Requesting RapidAPI download for: ${link}`);
  const response = await axios.get('https://youtube-info-download-api.p.rapidapi.com/ajax/download.php', {
    params: {
      format: '720',
      add_info: '0',
      url: link,
      audio_quality: '128',
      allow_extended_duration: 'false',
      no_merge: 'false',
      audio_language: 'en'
    },
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
      Accept: 'application/json'
    },
    timeout: 60000
  });

  const data = response.data;
  if (!data || data.success !== true) {
    throw new Error(data?.message || 'RapidAPI download request failed');
  }

  const title = data.title || data.info?.title || 'Video';
  if (data.url) {
    return {
      mediaUrl: data.url,
      title,
      raw: { source: 'rapidapi', initial: data }
    };
  }

  if (!data.progress_url) {
    throw new Error('RapidAPI did not return a progress URL');
  }

  debugLog(`RapidAPI progress URL: ${data.progress_url}`);

  for (let attempt = 1; attempt <= 12; attempt++) {
    await delay(2500);
    debugLog(`Polling RapidAPI progress (${attempt}/12)`);

    let progressResponse;
    try {
      progressResponse = await axios.get(data.progress_url, {
        headers: { Accept: 'application/json' },
        timeout: 60000
      });
    } catch (err) {
      debugLog(`RapidAPI progress poll failed: ${err.message}`);
      continue;
    }

    let progressData = progressResponse.data;
    if (!progressData && typeof progressResponse.data === 'string') {
      try {
        progressData = JSON.parse(progressResponse.data);
      } catch (jsonErr) {
        debugLog(`RapidAPI progress response is not JSON: ${jsonErr.message}`);
        continue;
      }
    }

    if (progressData?.url) {
      return {
        mediaUrl: progressData.url,
        title: progressData.title || title,
        raw: { source: 'rapidapi', initial: data, progress: progressData }
      };
    }

    if (progressData?.success === false) {
      throw new Error(progressData?.message || 'RapidAPI progress failed');
    }
  }

  throw new Error('RapidAPI progress polling timed out');
}

async function getYoutubeDownloadInfo(link, debugLog) {
  debugLog(`Fetching YouTube download info for: ${link}`);

  try {
    return await fetchRapidApiDownload(link, debugLog);
  } catch (rapidError) {
    debugLog(`RapidAPI downloader failed: ${rapidError.message}`);
  }

  // Local fallback: try ytdl-core first
  try {
    const info = await ytdl.getInfo(link, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      }
    });

    const bestFormat = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: (format) => format.hasVideo && format.hasAudio && format.container === 'mp4' && format.url
    });

    if (bestFormat && bestFormat.url) {
      return {
        mediaUrl: bestFormat.url,
        title: info.videoDetails?.title || 'Video',
        raw: {
          source: 'ytdl-core',
          title: info.videoDetails?.title,
          quality: bestFormat.qualityLabel || bestFormat.itag,
          mimeType: bestFormat.mimeType
        }
      };
    }

    debugLog('ytdl-core returned no usable format, falling back to play-dl');
  } catch (ytdlError) {
    debugLog(`ytdl-core failed: ${ytdlError.message}`);
  }

  try {
    const info = await playdl.video_info(link);
    const formats = info.format || [];
    const bestFormat = formats
      .filter((format) => format.url && format.mimeType?.includes('mp4'))
      .sort((a, b) => {
        const qa = parseInt(a.qualityLabel?.replace(/[^0-9]/g, '') || a.itag || '0', 10) || 0;
        const qb = parseInt(b.qualityLabel?.replace(/[^0-9]/g, '') || b.itag || '0', 10) || 0;
        return qb - qa;
      })[0];

    if (!bestFormat || !bestFormat.url) {
      throw new Error('play-dl failed to find a valid MP4 format');
    }

    return {
      mediaUrl: bestFormat.url,
      title: info.video_details?.title || info.video_details?.name || 'Video',
      raw: {
        source: 'play-dl',
        title: info.video_details?.title || info.video_details?.name,
        quality: bestFormat.qualityLabel || bestFormat.itag,
        mimeType: bestFormat.mimeType
      }
    };
  } catch (playDlError) {
    debugLog(`play-dl failed: ${playDlError.message}`);
  }

  // Local fallback 2: Try yt-dlp to dump info!
  try {
    debugLog('Attempting to extract video info using yt-dlp');
    const localPath = path.join(__dirname, '..', 'yt-dlp.exe');
    let commandName = 'yt-dlp';
    if (fs.existsSync(localPath)) {
      commandName = `"${localPath}"`;
    }
    
    const command = `${commandName} --dump-json --skip-download "${link}"`;
    const { stdout } = await execPromise(command, { timeout: 40000 });
    const info = JSON.parse(stdout);
    
    return {
      mediaUrl: link, // Pass the original link, since we will download via yt-dlp anyway
      title: info.title || 'Video',
      raw: {
        source: 'yt-dlp',
        title: info.title
      }
    };
  } catch (ytdlDlpError) {
    debugLog(`yt-dlp extraction failed: ${ytdlDlpError.message}`);
    throw new Error(`All download info extractors failed. yt-dlp error: ${ytdlDlpError.message}`);
  }
}

async function fetchDownloadInfo(link, debugLog) {
  const youtubeRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)/i;
  if (youtubeRegex.test(link)) {
    return await getYoutubeDownloadInfo(link, debugLog);
  }

  debugLog('Downloader only supports YouTube links locally.');
  throw new Error('Unsupported URL: only YouTube links are supported at this time.');
}


module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const DEBUG_LOG = true; // Set to false to disable debugging
  function debugLog(msg) {
    if (DEBUG_LOG) console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`);
  }

  debugLog("Script started");
  debugLog(`Raw body: ${JSON.stringify(req.body)}`);

  const data = req.body;
  if (!data) {
    debugLog("Invalid JSON format");
    return res.status(400).json({ error: "❌ Invalid JSON format." });
  }

  // Check event type - ALLOW BOTH messages.upsert and received_message
  const event = data.data?.event || '';
  debugLog(`Webhook event type: ${event}`);

  if (event !== 'messages.upsert' && event !== 'received_message') {
    debugLog(`Ignoring event (not messages.upsert or received_message): ${event}`);
    return res.status(200).json({ message: `⚠️ Ignoring event: ${event}` });
  }

  let remoteJid = '';
  let remoteJidAlt = '';
  let messageText = '';

  if (event === 'messages.upsert') {
    debugLog("Processing messages.upsert event");
    const messages = data.data.data?.messages || [];
    if (!messages.length) {
      debugLog("No messages in webhook messages.upsert");
      return res.status(400).json({ error: "❌ No messages found." });
    }
    
    const firstMessage = messages[0];
    const messageKey = firstMessage.key || {};
    remoteJid = messageKey.remoteJid || '';
    remoteJidAlt = messageKey.remoteJidAlt || '';
    messageText = firstMessage.message?.extendedTextMessage?.text || firstMessage.message?.conversation || '';
  } else if (event === 'received_message') {
    debugLog("Processing received_message event");
    const bodyMessage = data.data?.message?.body_message;
    if (!bodyMessage) {
      debugLog("No body_message found in received_message event");
      return res.status(400).json({ error: "❌ Invalid received_message format." });
    }
    
    const messageKey = data.message_key || data.data?.message_key || {};
    remoteJid = messageKey.remoteJid || '';
    remoteJidAlt = messageKey.remoteJidAlt || '';
    messageText = bodyMessage.content || bodyMessage.messages?.extendedTextMessage?.text || '';
  }

  debugLog(`remoteJid: ${remoteJid}, remoteJidAlt: ${remoteJidAlt}`);

  // Ignore groups, broadcasts, newsletters, etc.
  const ignorePatterns = [
    '@g.us',              // WhatsApp groups
    '@broadcast',         // Broadcast lists
    '@newsletter',        // Newsletter
    'status@broadcast',   // Status updates
    '-@g.us',             // Groups with dash
    'broadcast',          // Just broadcast
    'newsletter',         // Just newsletter
    'status'              // Status messages
  ];

  if (ignorePatterns.some(pattern => remoteJid.toLowerCase().includes(pattern.toLowerCase()))) {
    debugLog(`Ignored remoteJid (matched pattern): ${remoteJid}`);
    return res.status(200).json({ message: `⚠️ Ignored remoteJid: ${remoteJid}` });
  }

  debugLog(`messageText: ${messageText}, remoteJid: ${remoteJid}`);

  if (!messageText || !remoteJid) {
    debugLog("Missing messageText or remoteJid");
    return res.status(400).json({ error: "❌ Invalid webhook format." });
  }

  // Extract phone number - PREFER remoteJidAlt format
  let number = '';
  
  // First try remoteJidAlt (this has the correct WhatsApp format)
  if (remoteJidAlt) {
    const altMatch = remoteJidAlt.match(/^(\d+)@/);
    if (altMatch) {
      number = altMatch[1];
      debugLog(`Using phone number from remoteJidAlt: ${number}`);
    }
  }

  // Fallback to remoteJid
  if (!number) {
    const numberMatch = remoteJid.match(/^(\d+)@/);
    if (numberMatch) {
      number = numberMatch[1];
      debugLog(`Using phone number from remoteJid: ${number}`);
    }
  }

  if (!number) {
    debugLog("Could not extract phone number");
    return res.status(400).json({ error: "❌ Invalid remoteJid format." });
  }

  debugLog(`Final phone number to send: ${number}`);

  // Detect supported URLs (Pinterest, Facebook, Instagram, YouTube, TeraBox)
  const videoRegexes = [
    // Pinterest
    /(https:\/\/pin\.it\/[a-zA-Z0-9]+|https:\/\/(?:[a-z]+\.)?pinterest\.[a-z]+\/pin\/\d+\/?)/i,
    // Facebook
    /https:\/\/(?:www\.)?facebook\.[a-z]+\/[^\s]+/i,
    // Instagram
    /https:\/\/(?:www\.)?instagram\.[a-z]+\/[^\s]+/i,
    // TeraBox
    /https?:\/\/(?:[A-Za-z0-9\.-]*terabox[A-Za-z0-9\.-]*\.[A-Za-z]{2,})(?:\/[^\s]*)*/i,
    // YouTube Shorts
    /https:\/\/(?:www\.)?youtube\.com\/shorts\/[\w\-]+/i,
    // YouTube Regular videos
    /https:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w\-]+/i,
    // YouTube Shortened URLs (youtu.be)
    /https?:\/\/youtu\.be\/[\w\-]+/i
  ];

  let linkFound = '';
  for (const regex of videoRegexes) {
    const match = messageText.match(regex);
    if (match) {
      linkFound = match[0];
      break;
    }
  }

  if (!linkFound) {
    debugLog(`No supported video link found in: ${messageText}`);
    return res.status(400).json({ error: "❌ No supported video link found in message." });
  }

  debugLog(`Detected video URL: ${linkFound}`);

  let mediaUrl;
  let title;
  let source;
  try {
    const downloaderInfo = await fetchDownloadInfo(linkFound, debugLog);
    mediaUrl = downloaderInfo.mediaUrl;
    title = downloaderInfo.title;
    source = downloaderInfo.raw?.source;
    debugLog(`Downloader response: ${JSON.stringify(downloaderInfo.raw)}`);
  } catch (err) {
    const message = err?.response?.data?.error || err?.message || String(err);
    debugLog(`Downloader API error: ${message}, Raw: ${JSON.stringify(err)}`);
    return res.status(500).json({ error: `❌ Downloader API error: ${message}, Raw: ${JSON.stringify(err)}` });
  }

  let stableMediaUrl = mediaUrl;
  try {
    stableMediaUrl = await ensureStableMediaUrl(mediaUrl, linkFound, source, debugLog);
    if (stableMediaUrl !== mediaUrl) {
      debugLog(`Uploaded stable video URL: ${stableMediaUrl}`);
    }
  } catch (uploadError) {
    debugLog(`Stable media upload failed: ${uploadError.message}. Proceeding with original media URL.`);
    stableMediaUrl = mediaUrl;
  }

  debugLog(`Video URL: ${mediaUrl}, Title: ${title}`);
  debugLog(`Media URL sent to TextSnap: ${stableMediaUrl}`);

  // Send to WhatsApp API using the documented request structure
  const whatsappPayload = {
    number,
    type: 'video',
    media_url: stableMediaUrl,
    message: title,
    instance_id: WHATSAPP_INSTANCE_ID,
    access_token: WHATSAPP_ACCESS_TOKEN
  };

  debugLog(`WhatsApp API Payload: ${JSON.stringify(whatsappPayload)}`);

  let waRes;
  try {
    waRes = await fetch("https://textsnap.in/api/send", {
      method: 'POST',
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(whatsappPayload),
      timeout: 30000
    });
  } catch (err) {
    debugLog(`WhatsApp API fetch error: ${err.message}`);
    return res.status(500).json({ error: `❌ WhatsApp API fetch error: ${err.message}` });
  }

  debugLog(`WhatsApp API HTTP code: ${waRes.status}`);

  let waText = '';
  try {
    waText = await waRes.text();
  } catch (err) {
    waText = 'Could not read response body';
  }

  debugLog(`WhatsApp API response: ${waText}`);

  if (!waRes.ok && waRes.status !== 201 && waRes.status !== 200) {
    debugLog(`WhatsApp API error: ${waRes.status} ${waText}`);
    return res.status(500).json({ 
      error: `❌ WhatsApp API error: ${waRes.status}`,
      details: waText 
    });
  }

  debugLog("✅ Video sent successfully!");
  return res.status(200).json({
    status: "success",
    message: "✅ Video sent successfully!",
    phone_number: number,
    video_url: linkFound
  });
};
module.exports.ensureStableMediaUrl = ensureStableMediaUrl;

