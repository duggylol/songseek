// Spotify catalog search using the bundled app's Client-Credentials token.
// App-only: needs no user login and no per-user allowlist.

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
  const j = await api(store, `/search?type=track&limit=${limit}&market=US&q=${encodeURIComponent(q)}`)
  return ((j.tracks && j.tracks.items) || []).filter(Boolean).map(mapTrack)
}

async function getTrack(store, id) {
  return mapTrack(await api(store, `/tracks/${id}?market=US`))
}

function searchConfigured(store) {
  return !!(store.get('spotifySearchClientId') && store.get('spotifySearchClientSecret'))
}

module.exports = { search, getTrack, searchConfigured }
