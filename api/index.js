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

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      debugLog(`Download attempt ${attempt}/${maxRetries} via axios...`);
      const response = await axios.get(mediaUrl, {
        responseType: 'stream',
        timeout: 120000,
        maxBodyLength: Infinity,
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
          'Referer': 'https://youtube-info-download-api.p.rapidapi.com/'
        }
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tempFilePath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      // Check if file is completely empty
      const stats = fs.statSync(tempFilePath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty (0 bytes)');
      }

      debugLog(`Download successful via axios (${stats.size} bytes)`);
      return tempFilePath;
    } catch (err) {
      lastError = err;
      debugLog(`Download attempt ${attempt} failed: ${err.message}`);
      
      // Try curl fallback on last attempt if axios keeps failing
      if (attempt === maxRetries) {
        debugLog('Trying curl fallback as last resort...');
        try {
          const ua = getRandomUA();
          await execPromise(`curl -sL -o "${tempFilePath}" -A "${ua}" -H "Accept: video/mp4,video/*" "${mediaUrl}"`, { timeout: 120000 });
          const stats = fs.statSync(tempFilePath);
          if (stats.size > 0) {
            debugLog(`Download successful via curl (${stats.size} bytes)`);
            return tempFilePath;
          }
        } catch (curlErr) {
          debugLog(`curl fallback failed: ${curlErr.message}`);
        }
      }
      
      await delay(2000 * attempt); // Backoff
    }
  }

  throw new Error(`Failed to download remote video after ${maxRetries} attempts. Last error: ${lastError?.message}`);
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

// Rotating User-Agent pool to avoid fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getYtdlpCommand() {
  // On Windows (local dev): look for yt-dlp.exe in project root
  const winPath = path.join(__dirname, '..', 'yt-dlp.exe');
  if (fs.existsSync(winPath)) return `"${winPath}"`;
  // On Linux (Render / Docker): installed to /usr/local/bin/yt-dlp
  if (fs.existsSync('/usr/local/bin/yt-dlp')) return '/usr/local/bin/yt-dlp';
  // Fallback to global PATH
  return 'yt-dlp';
}

async function downloadVideoWithYtdlp(videoUrl, outputPath, debugLog) {
  debugLog(`Downloading video via yt-dlp to: ${outputPath}`);
  const cmd = getYtdlpCommand();
  debugLog(`Using yt-dlp binary: ${cmd}`);

  const ua = getRandomUA();
  const command = [
    cmd,
    '-f', '"best[height<=720][ext=mp4]/bestvideo[height<=720]+bestaudio/best"',
    '--merge-output-format', 'mp4',
    '--no-check-certificates',
    '--no-cache-dir',
    '--extractor-retries', '5',
    '--retry-sleep', 'extractor:5',
    '--sleep-requests', '1',
    '--extractor-args', '"youtube:player_client=web_creator,ios,mweb"',
    '--user-agent', `"${ua}"`,
    '--referer', '"https://www.youtube.com/"',
    '-o', `"${outputPath}"`,
    `"${videoUrl}"`
  ].join(' ');

  try {
    const { stdout, stderr } = await execPromise(command, {
      timeout: 180000,
      env: { ...process.env, YTDL_NO_UPDATE: '1' }
    });
    debugLog(`yt-dlp output length: ${stdout ? stdout.length : 0}`);
    if (stderr && stderr.trim()) {
      debugLog(`yt-dlp stderr: ${stderr.substring(0, 500)}`);
    }
  } catch (err) {
    debugLog(`yt-dlp download failed: ${err.message.substring(0, 500)}`);
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

  for (let attempt = 1; attempt <= 25; attempt++) {
    await delay(3000);
    debugLog(`Polling RapidAPI progress (${attempt}/25)`);

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

    debugLog(`RapidAPI progress data: ${JSON.stringify(progressData).substring(0, 300)}`);

    if (progressData?.url || progressData?.download_url) {
      return {
        mediaUrl: progressData.url || progressData.download_url,
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

// ============================================================
// Extract YouTube video ID from any URL format
// ============================================================
function extractYoutubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/i,
    /[?&]v=([\w-]{11})/i
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ============================================================
// COBALT — External proxy API for YouTube downloads
// ============================================================
async function fetchCobaltDownload(link, debugLog) {
  debugLog('Trying cobalt.tools API...');

  // Each entry: [url, requiresApiVersion]
  const cobaltInstances = [
    'https://api.cobalt.tools',
    'https://cobalt-api.ayo.tf',
    'https://cobalt.api.timelessnesses.me'
  ];

  for (const instance of cobaltInstances) {
    try {
      debugLog(`Cobalt instance: ${instance}`);
      const response = await axios.post(`${instance}/`, {
        url: link,
        videoQuality: '720'
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });

      const result = response.data;
      debugLog(`Cobalt response: ${JSON.stringify(result).substring(0, 400)}`);

      if (result.status === 'error') {
        debugLog(`Cobalt error detail: ${result.error?.code || JSON.stringify(result)}`);
        continue;
      }

      if ((result.status === 'redirect' || result.status === 'tunnel' || result.status === 'stream') && result.url) {
        return {
          mediaUrl: result.url,
          title: result.filename || 'Video',
          raw: { source: 'cobalt', instance, status: result.status }
        };
      }

      if (result.status === 'picker' && result.picker?.length > 0) {
        const pick = result.picker.find(p => p.type === 'video') || result.picker[0];
        if (pick.url) {
          return {
            mediaUrl: pick.url,
            title: result.filename || 'Video',
            raw: { source: 'cobalt', instance, status: 'picker' }
          };
        }
      }

      debugLog(`Cobalt returned unexpected structure`);
    } catch (err) {
      const respBody = err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : 'no body';
      debugLog(`Cobalt ${instance} failed: ${err.response?.status || err.message} | body: ${respBody}`);
    }
  }

  throw new Error('All cobalt instances failed');
}

// ============================================================
// PIPED — Open-source YouTube frontend with streaming API
// ============================================================
async function fetchPipedDownload(link, debugLog) {
  const videoId = extractYoutubeVideoId(link);
  if (!videoId) throw new Error('Could not extract video ID for Piped');

  debugLog(`Trying Piped API for video ID: ${videoId}`);

  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.r4fo.com',
    'https://pipedapi.moomoo.me',
    'https://api.piped.projectsegfau.lt'
  ];

  for (const instance of instances) {
    try {
      debugLog(`Piped instance: ${instance}`);
      const response = await axios.get(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': getRandomUA() },
        timeout: 15000
      });

      const data = response.data;
      if (data.error) {
        debugLog(`Piped ${instance} returned error: ${data.error}`);
        continue;
      }

      const title = data.title || 'Video';
      const videoStreams = data.videoStreams || [];

      // Try muxed streams first (videoOnly === false means it has audio)
      const muxed = videoStreams
        .filter(s => s.videoOnly === false && s.format === 'MPEG_4' && parseInt(s.quality) <= 720)
        .sort((a, b) => parseInt(b.quality) - parseInt(a.quality))[0];

      if (muxed?.url) {
        debugLog(`Piped found muxed stream: ${muxed.quality}`);
        return {
          mediaUrl: muxed.url,
          title,
          raw: { source: 'piped', instance, quality: muxed.quality, muxed: true }
        };
      }

      // Fallback to video-only stream (no audio, but at least we get video)
      const videoOnly = videoStreams
        .filter(s => s.format === 'MPEG_4' && parseInt(s.quality) <= 720)
        .sort((a, b) => parseInt(b.quality) - parseInt(a.quality))[0];

      if (videoOnly?.url) {
        debugLog(`Piped found video-only stream: ${videoOnly.quality}`);
        return {
          mediaUrl: videoOnly.url,
          title,
          raw: { source: 'piped', instance, quality: videoOnly.quality, muxed: false }
        };
      }

      debugLog(`Piped ${instance} returned no usable MP4 streams`);
    } catch (err) {
      debugLog(`Piped ${instance} failed: ${err.message?.substring(0, 200)}`);
    }
  }

  throw new Error('All Piped instances failed');
}

// ============================================================
// INVIDIOUS — Open-source YouTube frontend with public API
// ============================================================
async function fetchInvidiousDownload(link, debugLog) {
  const videoId = extractYoutubeVideoId(link);
  if (!videoId) throw new Error('Could not extract video ID for Invidious');

  debugLog(`Trying Invidious API for video ID: ${videoId}`);

  const instances = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://yewtu.be',
    'https://inv.tux.pizza',
    'https://invidious.privacyredirect.com'
  ];

  for (const instance of instances) {
    try {
      debugLog(`Invidious instance: ${instance}`);
      const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': getRandomUA() },
        timeout: 12000
      });

      const data = response.data;
      const title = data.title || 'Video';
      const streams = data.formatStreams || [];
      const adaptiveFormats = data.adaptiveFormats || [];

      const bestStream = streams
        .filter(s => s.type?.includes('video/mp4') && parseInt(s.qualityLabel) <= 720)
        .sort((a, b) => parseInt(b.qualityLabel) - parseInt(a.qualityLabel))[0];

      if (bestStream?.url) {
        debugLog(`Invidious found stream: ${bestStream.qualityLabel}`);
        return {
          mediaUrl: bestStream.url,
          title,
          raw: { source: 'invidious', instance, quality: bestStream.qualityLabel }
        };
      }

      const bestAdaptive = adaptiveFormats
        .filter(f => f.type?.includes('video/mp4') && parseInt(f.qualityLabel) <= 720)
        .sort((a, b) => parseInt(b.qualityLabel) - parseInt(a.qualityLabel))[0];

      if (bestAdaptive?.url) {
        debugLog(`Invidious found adaptive: ${bestAdaptive.qualityLabel}`);
        return {
          mediaUrl: bestAdaptive.url,
          title,
          raw: { source: 'invidious', instance, quality: bestAdaptive.qualityLabel }
        };
      }

      debugLog(`Invidious ${instance} no usable formats`);
    } catch (err) {
      debugLog(`Invidious ${instance} failed: ${err.message?.substring(0, 200)}`);
    }
  }

  throw new Error('All Invidious instances failed');
}

async function getYoutubeDownloadInfo(link, debugLog) {
  debugLog(`Fetching YouTube download info for: ${link}`);

  // ============================================================
  // STRATEGY 1: RapidAPI (ALMOST worked last time — just needed more polling)
  // ============================================================
  try {
    debugLog('Trying RapidAPI downloader (priority)...');
    return await fetchRapidApiDownload(link, debugLog);
  } catch (rapidError) {
    debugLog(`RapidAPI failed: ${rapidError.message}`);
  }

  // ============================================================
  // STRATEGY 2: Piped API (YouTube frontend, external servers)
  // ============================================================
  try {
    return await fetchPipedDownload(link, debugLog);
  } catch (pipedErr) {
    debugLog(`Piped strategy failed: ${pipedErr.message}`);
  }

  // ============================================================
  // STRATEGY 3: cobalt.tools (external proxy)
  // ============================================================
  try {
    return await fetchCobaltDownload(link, debugLog);
  } catch (cobaltErr) {
    debugLog(`Cobalt strategy failed: ${cobaltErr.message}`);
  }

  // ============================================================
  // STRATEGY 4: Invidious API (external proxy)
  // ============================================================
  try {
    return await fetchInvidiousDownload(link, debugLog);
  } catch (invErr) {
    debugLog(`Invidious strategy failed: ${invErr.message}`);
  }

  // ============================================================
  // STRATEGY 5: yt-dlp with player client rotation
  // ============================================================
  const cmd = getYtdlpCommand();

  try {
    debugLog('yt-dlp info extraction attempt...');
    const ua = getRandomUA();
    const command = [
      cmd,
      '--dump-json',
      '--skip-download',
      '--no-check-certificates',
      '--no-cache-dir',
      '--extractor-retries', '3',
      '--retry-sleep', 'extractor:3',
      '--sleep-requests', '1',
      '--extractor-args', '"youtube:player_client=web_creator,ios,mweb"',
      '--user-agent', `"${ua}"`,
      '--referer', '"https://www.youtube.com/"',
      `"${link}"`
    ].join(' ');

    const { stdout } = await execPromise(command, {
      timeout: 60000,
      env: { ...process.env, YTDL_NO_UPDATE: '1' }
    });

    const info = JSON.parse(stdout);
    debugLog(`yt-dlp extracted: title="${info.title}", duration=${info.duration}s`);

    return {
      mediaUrl: link,
      title: info.title || 'Video',
      raw: { source: 'yt-dlp', title: info.title, duration: info.duration }
    };
  } catch (ytdlpErr) {
    debugLog(`yt-dlp failed: ${ytdlpErr.message?.substring(0, 300)}`);
  }

  // ============================================================
  // STRATEGY 6-7 (LAST RESORT): ytdl-core / play-dl
  // ============================================================
  try {
    const info = await ytdl.getInfo(link, { requestOptions: { headers: { 'User-Agent': getRandomUA() } } });
    const best = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: (f) => f.hasVideo && f.hasAudio && f.container === 'mp4' && f.url
    });
    if (best?.url) {
      return { mediaUrl: best.url, title: info.videoDetails?.title || 'Video', raw: { source: 'ytdl-core' } };
    }
  } catch (e) { debugLog(`ytdl-core: ${e.message?.substring(0, 100)}`); }

  try {
    const info = await playdl.video_info(link);
    const best = (info.format || []).filter(f => f.url && f.mimeType?.includes('mp4')).sort((a, b) => parseInt(b.qualityLabel || '0') - parseInt(a.qualityLabel || '0'))[0];
    if (best?.url) {
      return { mediaUrl: best.url, title: info.video_details?.title || 'Video', raw: { source: 'play-dl' } };
    }
  } catch (e) { debugLog(`play-dl: ${e.message?.substring(0, 100)}`); }

  throw new Error('ALL 7 extractors failed (rapidapi, piped, cobalt, invidious, yt-dlp, ytdl-core, play-dl)');
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
    
    // Deep-search the payload for message text
    const d = data.data || {};
    const bodyMessage = d.message?.body_message || d.data?.message?.body_message || null;
    const rawText = 
      bodyMessage?.content ||
      bodyMessage?.messages?.extendedTextMessage?.text ||
      d.data?.message?.conversation ||
      d.data?.message?.extendedTextMessage?.text ||
      d.body ||
      '';
    
    if (!rawText) {
      debugLog(`No message text in received_message. Payload keys: ${JSON.stringify(Object.keys(d))}`);
      debugLog(`data.data sub-keys: ${JSON.stringify(Object.keys(d.data || {}))}`);
      return res.status(400).json({ error: "❌ Invalid received_message format." });
    }
    
    messageText = rawText;
    
    // Deep-search the payload for remoteJid (try every known location)
    const possibleKeys = [
      data.message_key,
      d.message_key,
      d.key,
      d.data?.key,
      d.data?.message_key,
      d.message?.key,
      d.data?.message?.key
    ];
    
    for (const k of possibleKeys) {
      if (k?.remoteJid) {
        remoteJid = k.remoteJid;
        remoteJidAlt = k.remoteJidAlt || '';
        debugLog(`Found remoteJid at path: ${JSON.stringify(k)}`);
        break;
      }
    }
    
    // If still no remoteJid, try sender/from/chatId fields
    if (!remoteJid) {
      remoteJid = d.sender || d.from || d.chatId || d.data?.sender || d.data?.from || d.data?.chatId || '';
      if (remoteJid) debugLog(`Found remoteJid from sender/from/chatId: ${remoteJid}`);
    }
    
    // Last resort: recursively search for any @s.whatsapp.net string
    if (!remoteJid) {
      const bodyStr = JSON.stringify(data);
      const jidMatch = bodyStr.match(/(\d{10,15})@s\.whatsapp\.net/);
      if (jidMatch) {
        remoteJid = `${jidMatch[1]}@s.whatsapp.net`;
        debugLog(`Found remoteJid via regex scan: ${remoteJid}`);
      } else {
        debugLog(`Could not find remoteJid anywhere in received_message payload`);
        debugLog(`Full payload for debugging: ${JSON.stringify(data).substring(0, 1000)}`);
      }
    }
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

