const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const { app } = require('electron')

function ytdlpPath() {
  const plat = `${process.platform}-${process.arch}`
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '../../resources/bin')
  return path.join(base, plat, name)
}

function run(args, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const bin = ytdlpPath()
    if (!fs.existsSync(bin)) return reject(new Error('yt-dlp not found'))
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) return reject(new Error(err.message.split('\n')[0]))
      resolve(stdout)
    })
  })
}

// Resolve a YouTube video to a directly-playable audio stream URL (+ fresh
// metadata). This bypasses embedding restrictions that block the IFrame player.
async function resolveStream(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const out = await run([
    '-f', 'bestaudio[acodec=opus]/bestaudio/best',
    '--no-playlist',
    '-J', // single JSON object for the video
    url,
  ])
  const j = JSON.parse(out)
  const streamUrl = j.url || (j.requested_formats && j.requested_formats[0] && j.requested_formats[0].url)
  if (!streamUrl) throw new Error('No audio stream found')
  const thumb =
    (j.thumbnails && j.thumbnails.length && j.thumbnails[j.thumbnails.length - 1].url) ||
    `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  return {
    source: 'youtube',
    sourceId: videoId,
    url,
    streamUrl,
    title: j.title || 'Unknown title',
    artist: j.uploader || j.channel || 'YouTube',
    artwork: thumb,
    durationMs: j.duration ? Math.round(j.duration * 1000) : 0,
  }
}

module.exports = { resolveStream }
