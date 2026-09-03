const { BrowserWindow } = require('electron')

// "Login" for the unofficial local path is just: which Kick channel? Reading a
// public channel's chat needs no OAuth, so connecting is even simpler than
// Twitch — the streamer types their channel name and we resolve its chatroom id.
//
// Kick's channel endpoint sits behind Cloudflare and returns a challenge to
// plain HTTP clients, so we resolve it inside a hidden Chromium window (a real
// browser passes the challenge). A direct fetch is tried first in case it's
// open.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function normalizeSlug(input) {
  let s = String(input || '').trim()
  if (!s) throw new Error('Enter your Kick channel name.')
  // Accept a full URL or an @handle, keep just the slug.
  s = s.replace(/^https?:\/\/(www\.)?kick\.com\//i, '').replace(/^@/, '')
  s = s.split(/[/?#]/)[0].trim().toLowerCase()
  if (!/^[a-z0-9_]+$/.test(s)) throw new Error('That doesn’t look like a Kick channel name.')
  return s
}

async function fetchJsonDirect(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
    })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('json')) return null
    return await r.json()
  } catch {
    return null
  }
}

// Load the API URL in a hidden window and read the JSON the browser receives.
function fetchJsonViaWindow(url) {
  return new Promise((resolve) => {
    let win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
    })
    let settled = false
    const done = (val) => {
      if (settled) return
      settled = true
      try { if (win && !win.isDestroyed()) win.destroy() } catch {}
      win = null
      resolve(val)
    }
    const timer = setTimeout(() => done(null), 20000)

    win.webContents.on('did-finish-load', async () => {
      try {
        // JSON endpoints render as text in the document body.
        const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""')
        clearTimeout(timer)
        try { done(JSON.parse(text)) } catch { done(null) }
      } catch {
        clearTimeout(timer)
        done(null)
      }
    })
    win.webContents.on('did-fail-load', () => { clearTimeout(timer); done(null) })
    win.loadURL(url).catch(() => { clearTimeout(timer); done(null) })
  })
}

async function lookupChannel(slug) {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`
  let data = await fetchJsonDirect(url)
  if (!data || !data.chatroom) data = await fetchJsonViaWindow(url)
  if (!data || !data.chatroom || !data.chatroom.id) {
    throw new Error(`Couldn’t find the Kick channel "${slug}". Check the spelling and that the channel exists.`)
  }
  return {
    slug,
    id: data.id,
    chatroomId: data.chatroom.id,
    username: (data.user && data.user.username) || slug,
  }
}

async function connect(store, channelInput) {
  const slug = normalizeSlug(channelInput)
  const user = await lookupChannel(slug)
  store.set('kickUser', user)
  return user
}

function disconnect(store) {
  store.set('kickUser', null)
}

module.exports = { connect, disconnect, normalizeSlug }
