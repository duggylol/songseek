const http = require('http')
const crypto = require('crypto')
const { shell } = require('electron')

const REDIRECT_PORT = 43111
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`
const SCOPES = 'channel:read:redemptions chat:read chat:edit'

// One-click browser login (OAuth implicit flow) — no client secret, no code to
// type. Twitch returns the token in the URL fragment, so the loopback page reads
// it with JS and posts it back to the local server.
async function connect(store) {
  const clientId = store.get('twitchClientId')
  if (!clientId) throw new Error('No Twitch Client ID configured.')

  const stateParam = crypto.randomBytes(12).toString('hex')

  const token = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI)
      if (u.pathname === '/') {
        // The fragment (#access_token=…) isn't sent to servers; bounce it into a query.
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<!doctype html><body style="background:#0a0a0f;color:#eee;font-family:system-ui;display:grid;place-items:center;height:100vh">
           <h2>Finishing Twitch login…</h2>
           <script>location.replace('/capture?'+location.hash.slice(1))</script></body>`
        )
        return
      }
      if (u.pathname === '/capture') {
        const error = u.searchParams.get('error_description') || u.searchParams.get('error')
        const accessToken = u.searchParams.get('access_token')
        const returnedState = u.searchParams.get('state')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<body style="background:#0a0a0f;color:#eee;font-family:system-ui;display:grid;place-items:center;height:100vh"><h2>${
            error || !accessToken
              ? 'Twitch connection failed — you can close this tab.'
              : 'Twitch connected! You can close this tab and return to SongSeek.'
          }</h2></body>`
        )
        clearTimeout(timer)
        server.close()
        if (error) reject(new Error(`Twitch authorization refused: ${error}`))
        else if (returnedState !== stateParam) reject(new Error('OAuth state mismatch'))
        else if (!accessToken) reject(new Error('No token returned by Twitch'))
        else resolve(accessToken)
        return
      }
      res.writeHead(404)
      res.end()
    })
    server.on('error', (e) =>
      reject(
        e.code === 'EADDRINUSE'
          ? new Error('Port 43111 is busy — close other SongSeek windows and try again.')
          : e
      )
    )
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for the Twitch login'))
    }, 5 * 60 * 1000)

    // Bind dual-stack (no host) so the browser reaches us whether it resolves
    // `localhost` to 127.0.0.1 or ::1. The random `state` check below prevents
    // any other local process from injecting a token during the brief window.
    server.listen(REDIRECT_PORT, () => {
      const authUrl = new URL('https://id.twitch.tv/oauth2/authorize')
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'token',
        scope: SCOPES,
        state: stateParam,
        force_verify: 'false',
      }).toString()
      shell.openExternal(authUrl.toString())
    })
  })

  // Implicit tokens have no refresh token; store with an approximate expiry.
  store.set('twitchTokens', { access_token: token, expires_at: Date.now() + 50 * 24 * 3600 * 1000 })
  return validate(store)
}

async function validate(store) {
  const token = getAccessToken(store)
  if (!token) throw new Error('Twitch not connected')
  const r = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${token}` },
  })
  if (!r.ok) {
    store.merge({ twitchTokens: null, twitchUser: null })
    throw new Error('Twitch login expired — please reconnect.')
  }
  const j = await r.json()
  store.set('twitchUser', { id: j.user_id, login: j.login })
  return store.get('twitchUser')
}

// Implicit flow: no refresh. Return the stored token; validate() detects expiry.
function getAccessToken(store) {
  const t = store.get('twitchTokens')
  return t ? t.access_token : null
}

function disconnect(store) {
  store.merge({ twitchTokens: null, twitchUser: null })
}

module.exports = { connect, getAccessToken, validate, disconnect }
