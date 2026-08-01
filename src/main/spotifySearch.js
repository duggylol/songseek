const account = require('./spotifyAccount')

// Spotify catalog search.
//
// Primary path: the signed-in user's own token. That means a user only ever
// needs a Client ID from their own Spotify app — no client secret — and results
// are matched to their country.
//
// Fallback: if a build bundles an app id + secret (private builds only), use an
// app-only Client-Credentials token so search works before anyone logs in.

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
  if (!r.ok) return null
  const j = await r.json()
  appToken = { token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 }
  return appToken.token
}

const mapTrack = (t) => ({
  source: 'spotify',
  sourceId: t.id,
  uri: t.uri,
  url: t.external_urls && t.external_urls.spotify,
  title: t.name,
  artist: (t.artists || []).map((a) => a.name).join(', '),
  artwork: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || '',
  durationMs: t.duration_ms,
})

async function api(store, pathname, marketToken) {
  // Signed in? Use the user's token — no secret required.
  if (store.get('spotifyLibraryTokens')) {
    return account.request(store, 'GET', pathname.replace('{market}', 'from_token'))
  }
  const token = await getAppToken(store)
  if (!token) {
    const e = new Error('Connect Spotify to search its catalogue')
    e.code = 'NO_SPOTIFY'
    throw e
  }
  const r = await fetch('https://api.spotify.com/v1' + pathname.replace('{market}', 'US'), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j.error && j.error.message) || `Spotify API error ${r.status}`)
  }
  return r.json()
}

async function search(store, q, limit = 6) {
  // Spotify caps `limit` at 10 for Development Mode apps.
  const n = Math.min(limit, 10)
  const j = await api(store, `/search?type=track&limit=${n}&market={market}&q=${encodeURIComponent(q)}`)
  return (((j && j.tracks) || {}).items || []).filter(Boolean).map(mapTrack)
}

async function getTrack(store, id) {
  return mapTrack(await api(store, `/tracks/${id}?market={market}`))
}

function searchConfigured(store) {
  return !!(
    store.get('spotifyLibraryTokens') ||
    (store.get('spotifySearchClientId') && store.get('spotifySearchClientSecret'))
  )
}

module.exports = { search, getTrack, searchConfigured }
