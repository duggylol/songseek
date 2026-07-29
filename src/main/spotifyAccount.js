const http = require('http')
const crypto = require('crypto')
const { shell } = require('electron')

// The single Spotify account connection: one user login (your registered app)
// that powers BOTH library reading and playback control. SongSeek never plays
// Spotify audio itself — it controls the user's own Spotify app.

const REDIRECT_PORT = 8888
// Must exactly match a Redirect URI registered on the Spotify app.
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`

const LIBRARY_SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read']
const PLAYER_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
]
const SCOPES = [...LIBRARY_SCOPES, ...PLAYER_SCOPES].join(' ')

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function clientId(store) {
  const id = store.get('spotifySearchClientId')
  if (!id) throw new Error('No Spotify app configured.')
  return id
}

async function tokenRequest(store, params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  if (!r.ok) throw new Error(`Spotify token error (${r.status}): ${await r.text()}`)
  return r.json()
}

function saveTokens(store, tokens, prev) {
  store.set('spotifyLibraryTokens', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || (prev && prev.refresh_token),
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
    scope: tokens.scope || (prev && prev.scope) || '',
  })
}

async function connect(store) {
  const id = clientId(store)
  const verifier = b64url(crypto.randomBytes(48))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const stateParam = b64url(crypto.randomBytes(12))

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI)
      if (u.pathname !== '/' || (!u.searchParams.get('code') && !u.searchParams.get('error'))) {
        res.writeHead(404)
        res.end()
        return
      }
      const error = u.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<body style="background:#0a0a0f;color:#eee;font-family:system-ui;display:grid;place-items:center;height:100vh"><h2>${
          error ? 'Spotify connection failed — you can close this tab.' : 'Spotify connected! Return to SongSeek.'
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
          ? new Error('Port 8888 is busy — close other apps using it and try again.')
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
        client_id: id,
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

  const tokens = await tokenRequest(store, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: id,
    code_verifier: verifier,
  })
  saveTokens(store, tokens, null)

  // Record who's connected (display only).
  try {
    const me = await api(store, '/me')
    store.set('spotifyUser', { id: me.id, name: me.display_name || me.id, product: me.product })
  } catch {
    /* non-fatal */
  }
  return status(store)
}

async function getToken(store) {
  const t = store.get('spotifyLibraryTokens')
  if (!t) return null
  if (Date.now() < t.expires_at) return t.access_token
  if (!t.refresh_token) return null
  const nt = await tokenRequest(store, {
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: clientId(store),
  })
  saveTokens(store, nt, t)
  return nt.access_token
}

function disconnect(store) {
  store.merge({ spotifyLibraryTokens: null, spotifyUser: null })
}

// Tokens issued before playback control was added lack the player scopes; the
// user must reconnect once to grant them.
function hasPlayerScopes(store) {
  const t = store.get('spotifyLibraryTokens')
  if (!t) return false
  const granted = String(t.scope || '').split(/\s+/)
  return PLAYER_SCOPES.every((s) => granted.includes(s))
}

function status(store) {
  const connected = !!store.get('spotifyLibraryTokens')
  return {
    connected,
    user: store.get('spotifyUser') || null,
    needsReconnect: connected && !hasPlayerScopes(store),
  }
}

// Raw request helper. Returns parsed JSON, or null for empty (204) responses.
async function request(store, method, pathname, { body, expectEmpty } = {}) {
  const token = await getToken(store)
  if (!token) throw Object.assign(new Error('Spotify is not connected'), { code: 'NO_AUTH' })
  const r = await fetch(pathname.startsWith('http') ? pathname : 'https://api.spotify.com/v1' + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (r.status === 204 || r.status === 202) return null
  if (r.status === 401) {
    const j = await r.json().catch(() => ({}))
    const msg = (j.error && j.error.message) || ''
    // "Permissions missing" = token lacks the newer scopes, not a dead session.
    if (/permission/i.test(msg)) {
      throw Object.assign(new Error('Reconnect Spotify to allow playback control.'), { code: 'NEEDS_RECONNECT' })
    }
    disconnect(store)
    throw Object.assign(new Error('Spotify login expired — reconnect.'), { code: 'NO_AUTH' })
  }
  // Spotify tells us WHY in error.reason — don't guess. Notably a missing
  // device comes back as 404/NO_ACTIVE_DEVICE, which is not a Premium problem.
  if (r.status === 403 || r.status === 404) {
    const j = await r.json().catch(() => ({}))
    const err = (j && j.error) || {}
    const reason = err.reason || ''
    if (reason === 'NO_ACTIVE_DEVICE') {
      throw Object.assign(new Error('Spotify is open but not playing — press play in Spotify first.'), {
        code: 'NO_DEVICE',
      })
    }
    if (reason === 'PREMIUM_REQUIRED') {
      throw Object.assign(
        new Error('Spotify Premium is required to control playback (this account is on Free).'),
        { code: 'PREMIUM' }
      )
    }
    if (r.status === 404) {
      throw Object.assign(new Error(err.message || 'Spotify could not find that.'), { code: 'NOT_FOUND' })
    }
    throw Object.assign(new Error(err.message || `Spotify refused the request (${reason || 403}).`), {
      code: 'FORBIDDEN',
      reason,
    })
  }
  if (r.status === 429) {
    throw Object.assign(new Error('Spotify rate limit — slowing down.'), { code: 'RATE_LIMIT' })
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j.error && j.error.message) || `Spotify API error ${r.status}`)
  }
  if (expectEmpty) return null
  return r.json().catch(() => null)
}

const api = (store, pathname) => request(store, 'GET', pathname)

// ---- library ----

const mapTrack = (t) => {
  if (!t || !t.id) return null
  return {
    source: 'spotify',
    sourceId: t.id,
    uri: t.uri,
    url: t.external_urls && t.external_urls.spotify,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    artwork: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || '',
    durationMs: t.duration_ms || 0,
  }
}

async function playlists(store) {
  const out = [{ id: 'liked', name: 'Liked Songs', trackCount: null, artwork: null, kind: 'liked' }]
  let url = '/me/playlists?limit=50'
  while (url) {
    const j = await api(store, url)
    for (const p of (j && j.items) || []) {
      if (!p) continue
      out.push({
        id: p.id,
        uri: p.uri,
        name: p.name,
        trackCount: p.tracks ? p.tracks.total : null,
        artwork: (p.images && p.images[0] && p.images[0].url) || null,
        owner: p.owner && p.owner.display_name,
        kind: 'playlist',
      })
    }
    url = j && j.next
  }
  return out
}

async function likedTracks(store, limit = 200) {
  const tracks = []
  let url = `/me/tracks?limit=50`
  while (url && tracks.length < limit) {
    const j = await api(store, url)
    for (const it of (j && j.items) || []) tracks.push(mapTrack(it.track))
    url = j && j.next
  }
  return tracks.filter(Boolean)
}

async function playlistTracks(store, id, limit = 500) {
  if (id === 'liked') return likedTracks(store, limit)
  const tracks = []
  let url = `/playlists/${id}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,external_urls,artists(name),album(images)))`
  while (url && tracks.length < limit) {
    const j = await api(store, url)
    for (const it of (j && j.items) || []) tracks.push(mapTrack(it.track))
    url = j && j.next
  }
  return tracks.filter(Boolean)
}

module.exports = {
  connect,
  disconnect,
  status,
  getToken,
  request,
  api,
  mapTrack,
  playlists,
  playlistTracks,
  hasPlayerScopes,
  REDIRECT_URI,
}
