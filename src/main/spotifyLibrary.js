const http = require('http')
const crypto = require('crypto')
const { shell } = require('electron')

// Reads the user's Spotify library (playlists, liked songs) via the Web API.
// This uses YOUR registered app (app-config.json) with a normal user login,
// because the built-in-client login token used for playback is blocked by the
// public Web API. Playback still goes through go-librespot on the same account,
// so tracks listed here play fine.

const REDIRECT_PORT = 8888
// Must exactly match a Redirect URI registered on the Spotify app.
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`
const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read'

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function clientId(store) {
  const id = store.get('spotifySearchClientId')
  if (!id) throw new Error('No Spotify app configured for library access.')
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
          error ? 'Library connection failed — you can close this tab.' : 'Library connected! Return to SongSeek.'
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
  store.merge({ spotifyLibraryTokens: null })
}

function status(store) {
  return { connected: !!store.get('spotifyLibraryTokens') }
}

async function api(store, pathname) {
  const token = await getToken(store)
  if (!token) throw new Error('Spotify library is not connected')
  const r = await fetch(pathname.startsWith('http') ? pathname : 'https://api.spotify.com/v1' + pathname, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (r.status === 401) {
    disconnect(store)
    throw new Error('Spotify library login expired — reconnect.')
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j.error && j.error.message) || `Spotify API error ${r.status}`)
  }
  return r.json()
}

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

// The virtual "Liked Songs" playlist + the user's own/followed playlists.
async function playlists(store) {
  const out = [{ id: 'liked', name: 'Liked Songs', trackCount: null, artwork: null, kind: 'liked' }]
  let url = '/me/playlists?limit=50'
  while (url) {
    const j = await api(store, url)
    for (const p of j.items || []) {
      if (!p) continue
      out.push({
        id: p.id,
        name: p.name,
        trackCount: p.tracks ? p.tracks.total : null,
        artwork: (p.images && p.images[0] && p.images[0].url) || null,
        owner: p.owner && p.owner.display_name,
        kind: 'playlist',
      })
    }
    url = j.next
  }
  return out
}

async function likedTracks(store, limit = 200) {
  const tracks = []
  let url = `/me/tracks?limit=50`
  while (url && tracks.length < limit) {
    const j = await api(store, url)
    for (const it of j.items || []) tracks.push(mapTrack(it.track))
    url = j.next
  }
  return tracks.filter(Boolean)
}

async function playlistTracks(store, id, limit = 500) {
  if (id === 'liked') return likedTracks(store, limit)
  const tracks = []
  let url = `/playlists/${id}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,external_urls,artists(name),album(images)))`
  while (url && tracks.length < limit) {
    const j = await api(store, url)
    for (const it of j.items || []) tracks.push(mapTrack(it.track))
    url = j.next
  }
  return tracks.filter(Boolean)
}

module.exports = { connect, disconnect, status, playlists, playlistTracks, REDIRECT_URI }
