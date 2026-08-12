// OBS browser-source overlay: GET /overlay renders a transparent, self-contained
// animated "now playing" card; /overlay/events is an SSE stream the page listens
// to for real-time updates (new song → slide in; !song → replay; stop → hide).

let clients = []
let lastTrack = null

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`
  clients = clients.filter((res) => {
    try {
      res.write(line)
      return true
    } catch {
      return false
    }
  })
}

function setTrack(track) {
  lastTrack = track || null
  if (lastTrack) broadcast({ type: 'show', track: lastTrack })
  else broadcast({ type: 'hide' })
}

function replay() {
  if (lastTrack) broadcast({ type: 'show', track: lastTrack })
}

function hide() {
  broadcast({ type: 'hide' })
}

// An open SSE stream is a live socket, and http.Server#close() waits for those
// to drain — so without this the port stays held after we ask the server to
// stop, and a quick relaunch gets bumped to a fallback port. The overlay page
// treats the drop as a normal disconnect and reconnects itself.
function closeAll() {
  for (const res of clients) {
    try { res.end() } catch {}
    try { if (res.socket) res.socket.destroy() } catch {}
  }
  clients = []
}

// The overlay page is also served from a file on disk (see writeOverlayFile), so
// it can be loaded by OBS while SongSeek is closed. That page's origin is
// "null", so every overlay response has to be CORS-open.
const CORS = { 'Access-Control-Allow-Origin': '*' }

// Returns true if it handled the request (hooked into the app's local server).
function handle(req, res) {
  const pathname = new URL(req.url, 'http://x').pathname
  if (pathname === '/overlay') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS })
    res.end(PAGE)
    return true
  }
  // How a page finds which port SongSeek landed on, and whether it's up at all.
  if (pathname === '/overlay/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache', ...CORS })
    res.end('songseek')
    return true
  }
  if (pathname === '/overlay/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    })
    res.write(':ok\n\n')
    clients.push(res)
    // Catch a mid-song OBS (re)load up instantly.
    if (lastTrack) res.write(`data: ${JSON.stringify({ type: 'show', track: lastTrack })}\n\n`)
    // A real event, not an SSE comment: comments keep the socket warm but are
    // invisible to JS, so the page could never tell a live stream from one that
    // died silently (sleep/suspend leaves a half-open socket that fires no
    // error). The page uses these beats as its watchdog.
    const ka = setInterval(() => {
      try { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`) } catch { clearInterval(ka) }
    }, 20000)
    const drop = () => {
      clearInterval(ka)
      clients = clients.filter((c) => c !== res)
    }
    req.on('close', drop)
    res.on('close', drop)
    res.on('error', drop)
    return true
  }
  return false
}

// Write the overlay to disk so OBS can load it as a local file. A file:// source
// ALWAYS loads — even with SongSeek closed — and then waits for the app to come
// up. That's the only way a browser source survives "OBS opened first", since
// OBS never retries a source that failed to connect.
function writeOverlayFile(dir) {
  const fs = require('fs')
  const path = require('path')
  const file = path.join(dir, 'overlay.html')
  try {
    fs.writeFileSync(file, PAGE)
    return file
  } catch {
    return null
  }
}

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>SongSeek Overlay</title>
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; height: 100%; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', Roboto, sans-serif; }

  #card {
    position: absolute; left: 20px; top: 50%;
    display: flex; align-items: center; gap: 18px;
    padding: 14px 30px 14px 14px;
    background: linear-gradient(135deg, rgba(16, 16, 24, 0.96), rgba(30, 30, 46, 0.96));
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 20px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    max-width: calc(100% - 40px);
    transform: translate(calc(-100% - 60px), -50%);
    opacity: 0;
    transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.45s ease;
    will-change: transform, opacity;
  }
  #card.show { transform: translate(0, -50%); opacity: 1; }
  #card.leaving {
    transition: transform 0.6s cubic-bezier(0.5, 0, 0.75, 0.2), opacity 0.45s ease 0.1s;
    transform: translate(calc(-100% - 60px), -50%);
    opacity: 0;
  }

  #artwrap { position: relative; flex: none; }
  #art {
    width: 88px; height: 88px; border-radius: 14px; object-fit: cover; display: block;
    background: #1c1c28;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
    transform: scale(0.7) rotate(-6deg); opacity: 0;
    transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.18s, opacity 0.4s ease 0.18s;
  }
  #card.show #art { transform: scale(1) rotate(0deg); opacity: 1; }
  #art.noart { display: grid; place-items: center; }

  #meta { min-width: 0; padding-right: 4px; }
  #label {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #23d18b;
    margin-bottom: 6px;
    transform: translateX(-14px); opacity: 0;
    transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.26s, opacity 0.4s ease 0.26s;
  }
  #card.show #label { transform: translateX(0); opacity: 1; }
  .eq { display: flex; align-items: flex-end; gap: 2.5px; height: 12px; }
  .eq i { width: 3px; background: #23d18b; border-radius: 1.5px; animation: eq 0.9s ease-in-out infinite; }
  .eq i:nth-child(1) { height: 45%; animation-delay: -0.25s; }
  .eq i:nth-child(2) { height: 100%; animation-delay: -0.55s; }
  .eq i:nth-child(3) { height: 65%; }
  @keyframes eq { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }

  #title {
    font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -0.3px;
    max-width: 560px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
    transform: translateX(-18px); opacity: 0;
    transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.32s, opacity 0.4s ease 0.32s;
  }
  #card.show #title { transform: translateX(0); opacity: 1; }

  #artist {
    font-size: 15.5px; font-weight: 600; color: rgba(255, 255, 255, 0.62); margin-top: 3px;
    max-width: 560px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transform: translateX(-18px); opacity: 0;
    transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.38s, opacity 0.4s ease 0.38s;
  }
  #card.show #artist { transform: translateX(0); opacity: 1; }

  #req {
    display: none; margin-top: 8px; font-size: 11.5px; font-weight: 700;
    color: #c9c2ff; background: rgba(139, 123, 255, 0.16);
    border: 1px solid rgba(139, 123, 255, 0.35);
    padding: 2px 10px; border-radius: 999px; width: fit-content;
    max-width: 420px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transform: translateX(-18px); opacity: 0;
    transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.44s, opacity 0.4s ease 0.44s;
  }
  #card.show #req { transform: translateX(0); opacity: 1; }
  #req.on { display: block; }

  /* content swap pulse when the song changes while the card is on screen */
  #card.swap #art { animation: pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes pop { 0% { transform: scale(0.82); opacity: 0.4; } 100% { transform: scale(1); opacity: 1; } }
</style>
</head>
<body>
  <div id="card">
    <div id="artwrap"><img id="art" alt="" /></div>
    <div id="meta">
      <div id="label"><span class="eq"><i></i><i></i><i></i></span>NOW PLAYING</div>
      <div id="title"></div>
      <div id="artist"></div>
      <div id="req"></div>
    </div>
  </div>
<script>
  const card = document.getElementById('card')
  const art = document.getElementById('art')
  const title = document.getElementById('title')
  const artist = document.getElementById('artist')
  const req = document.getElementById('req')
  const HOLD_MS = 7000
  let hideTimer = null

  function setContent(t) {
    title.textContent = t.title || ''
    artist.textContent = t.artist || ''
    if (t.artwork) { art.src = t.artwork; art.style.visibility = 'visible' }
    else { art.removeAttribute('src'); art.style.visibility = 'hidden' }
    if (t.requestedBy) { req.textContent = 'requested by ' + t.requestedBy; req.classList.add('on') }
    else { req.classList.remove('on'); req.textContent = '' }
  }

  function show(t) {
    clearTimeout(hideTimer)
    if (card.classList.contains('show')) {
      // already visible — swap content with a small pop and restart the clock
      setContent(t)
      card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap')
    } else {
      setContent(t)
      card.classList.remove('leaving', 'swap'); void card.offsetWidth
      card.classList.add('show')
    }
    hideTimer = setTimeout(hide, HOLD_MS)
  }

  function hide() {
    clearTimeout(hideTimer)
    if (!card.classList.contains('show')) return
    card.classList.add('leaving')
    card.classList.remove('show')
    setTimeout(() => card.classList.remove('leaving'), 700)
  }

  // ---- connection: must survive SongSeek being closed, restarted, moved to a
  // fallback port, or the machine going to sleep. It never gives up. ----
  const PORTS = [43112, 43113, 43114, 43115, 43116, 43117]
  const STALE_MS = 55000   // no beat for this long => the stream died silently
  let base = location.protocol.indexOf('http') === 0 ? location.origin : null
  let es = null, watchdog = null, pending = null, lastBeat = 0

  function schedule(ms) {
    if (pending) return
    pending = setTimeout(() => { pending = null; connect() }, ms)
  }

  function probe(b) {
    // A plain fetch with a short deadline: a closed port rejects immediately,
    // but a firewalled one can hang, so cap it.
    return new Promise((resolve) => {
      let done = false
      const finish = (ok) => { if (!done) { done = true; resolve(ok) } }
      const timer = setTimeout(() => finish(false), 1500)
      fetch(b + '/overlay/ping', { cache: 'no-store' })
        .then((r) => { clearTimeout(timer); finish(r.ok) })
        .catch(() => { clearTimeout(timer); finish(false) })
    })
  }

  async function findBase() {
    if (base && (await probe(base))) return base
    for (const p of PORTS) {
      const b = 'http://127.0.0.1:' + p
      if (await probe(b)) return b
    }
    return null
  }

  function teardown() {
    try { if (es) { es.onerror = null; es.onmessage = null; es.close() } } catch {}
    es = null
    clearInterval(watchdog); watchdog = null
  }

  async function connect() {
    teardown()
    const b = await findBase()
    if (!b) { schedule(2000); return }   // SongSeek isn't up yet — keep waiting
    base = b
    try { es = new EventSource(b + '/overlay/events') } catch { schedule(2000); return }
    lastBeat = Date.now()
    es.onopen = () => { lastBeat = Date.now() }
    es.onmessage = (e) => {
      lastBeat = Date.now()
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      if (msg.type === 'show' && msg.track) show(msg.track)
      else if (msg.type === 'hide') hide()
      // 'ping' just refreshes lastBeat above
    }
    // Rebuild from scratch rather than trusting EventSource's own retry: the app
    // may have come back on a different port, which its retry would never find.
    es.onerror = () => schedule(2000)
    watchdog = setInterval(() => {
      if (Date.now() - lastBeat > STALE_MS) schedule(0)
    }, 10000)
  }

  // Waking from sleep is the classic silent-death case — re-check immediately.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastBeat > STALE_MS) schedule(0)
  })
  window.addEventListener('online', () => schedule(0))

  connect()
</script>
</body>
</html>`

module.exports = { handle, setTrack, replay, hide, writeOverlayFile, closeAll }
