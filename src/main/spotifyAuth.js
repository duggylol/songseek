const http = require('http')
const crypto = require('crypto')
const { shell } = require('electron')

// Spotify's own public "keymaster" client id — the same one used by the desktop
// app and by librespot. Using it means users never create a developer app: they
// just click a button and log in. It permits loopback redirects with PKCE.
const CLIENT_ID = '65b708073fc0480ea92a077233ca87bd'
const REDIRECT_PORT = 43110
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/login`
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ')

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  if (!r.ok) throw new Error(`Spotify token error (${r.status}): ${await r.text()}`)
  return r.json()
}

function saveTokens(store, tokens, prev) {
  store.set('spotifyTokens', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || (prev && prev.refresh_token),
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
  })
}

// Authorization Code + PKCE via the system browser and a loopback listener.
async function connect(store) {
  const verifier = b64url(crypto.randomBytes(48))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const stateParam = b64url(crypto.randomBytes(12))

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI)
      if (u.pathname !== '/login') {
        res.writeHead(404)
        res.end()
        return
      }
      const error = u.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<body style="background:#0a0a0f;color:#eee;font-family:system-ui;display:grid;place-items:center;height:100vh"><h2>${
          error
            ? 'Spotify connection failed — you can close this tab.'
            : 'Spotify connected! You can close this tab and return to SongSeek.'
        }</h2></body>`
      )
      clearTimeout(timer)
      server.close()
      if (error) reject(new Error(`Spotify authorization refused: ${error}`))
      else if (u.searchParams.get('state') !== stateParam) reject(new Error('OAuth state mismatch'))
      else resolve(u.searchParams.get('code'))
    })
    server.on('error', (e) =>
      reject(
        e.code === 'EADDRINUSE'
          ? new Error('Port 43110 is busy — close other SongSeek windows and try again.')
          : e
      )
    )
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for the Spotify login'))
    }, 5 * 60 * 1000)

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const authUrl = new URL('https://accounts.spotify.com/authorize')
      authUrl.search = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        scope: SCOPES,
        state: stateParam,
      }).toString()
      shell.openExternal(authUrl.toString())
    })
  })

  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  })
  saveTokens(store, tokens, null)

  // Note: this token authenticates Spotify's internal protocol (playback via the
  // engine) but is rejected by the public Web API, so we don't call /v1/me here.
  // The engine reports the real username via its /status once it's running.
  store.set('spotifyUser', { id: '', name: '' })
  return store.get('spotifyUser')
}

async function getAccessToken(store) {
  const t = store.get('spotifyTokens')
  if (!t) return null
  if (Date.now() < t.expires_at) return t.access_token
  if (!t.refresh_token) return null
  const nt = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: CLIENT_ID,
  })
  saveTokens(store, nt, t)
  return nt.access_token
}

function disconnect(store) {
  store.merge({ spotifyTokens: null, spotifyUser: null })
}

// --- Web API search (main-side) ---
//
// Spotify's Web API needs a token from a registered app; the user's login token
// (issued to Spotify's built-in client) is rejected there. So catalog search uses
// an app-only Client-Credentials token from the bundled app id/secret. This needs
// NO user login and is NOT subject to any per-user allowlist. If no app creds are
// bundled, Spotify search is skipped (YouTube/SoundCloud still work).

let appToken = null // { token, expires_at }

async function getAppToken(store) {
  const id = store.get('spotifySearchClientId')
  const secret = store.get('spotifySearchClientSecret')
  if (!id || !secret) return null
  if (appToken && Date.now() < appToken.expires_at) return appToken.token
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })
  if (!r.ok) throw new Error(`Spotify app auth failed (${r.status})`)
  const j = await r.json()
  appToken = { token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 }
  return appToken.token
}

async function api(store, pathname) {
  const token = await getAppToken(store)
  if (!token) {
    const e = new Error('Spotify search is not configured')
    e.code = 'NO_APP_TOKEN'
    throw e
  }
  const r = await fetch('https://api.spotify.com/v1' + pathname, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j.error && j.error.message) || `Spotify API error ${r.status}`)
  }
  return r.json()
}

const mapTrack = (t) => ({
  source: 'spotify',
  sourceId: t.id,
  uri: t.uri,
  url: t.external_urls && t.external_urls.spotify,
  title: t.name,
  artist: t.artists.map((a) => a.name).join(', '),
  artwork: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || '',
  durationMs: t.duration_ms,
})

async function search(store, q, limit = 6) {
  // Client-credentials tokens have no user market; use a fixed one.
  const j = await api(store, `/search?type=track&limit=${limit}&market=US&q=${encodeURIComponent(q)}`)
  return ((j.tracks && j.tracks.items) || []).filter(Boolean).map(mapTrack)
}

async function getTrack(store, id) {
  return mapTrack(await api(store, `/tracks/${id}?market=US`))
}

function searchConfigured(store) {
  return !!(store.get('spotifySearchClientId') && store.get('spotifySearchClientSecret'))
}

module.exports = { connect, getAccessToken, disconnect, search, getTrack, searchConfigured, CLIENT_ID }
