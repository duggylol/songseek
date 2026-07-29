const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const Store = require('./store')
const account = require('./spotifyAccount')
const spotifySearch = require('./spotifySearch')
const { SpotifyControl } = require('./spotifyControl')
const twitchAuth = require('./twitchAuth')
const TwitchService = require('./twitch')
const overlay = require('./overlay')
const search = require('./searchProxy')

let store = null
let win = null
let twitch = null
let control = null
let twitchConnecting = false

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const spotifyStatus = (extra = {}) => ({
  ...account.status(store),
  ...extra,
})

function initSpotifyControl() {
  if (control) return control
  control = new SpotifyControl(store)
  control.on('state', (s) => send('spotify:state', s))
  control.on('queue', (q) => send('spotify:queue', q))
  control.start()
  return control
}

const twitchStatus = (extra = {}) => ({
  connected: !!(twitch && !twitch.stopped && store.get('twitchTokens')),
  user: store.get('twitchUser'),
  ...extra,
})

function startTwitchService() {
  if (twitch) twitch.stop()
  if (!store.get('twitchTokens') || !store.get('twitchUser')) return
  twitch = new TwitchService({ store, getToken: () => twitchAuth.getAccessToken(store) })
  twitch.on('request', (payload) => send('twitch:request', payload))
  twitch.on('command', (payload) => send('twitch:command', payload))
  twitch.on('status', (s) => send('twitch:status', twitchStatus(s)))
  twitch.start()
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 1020,
    minHeight: 660,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => send('win:maximized', true))
  win.on('unmaximize', () => send('win:maximized', false))

  // The local server serves the UI in production (YouTube's player refuses
  // embeds without a real web origin) and the OBS overlay always. If it can't
  // bind at all, still show the app rather than dying on launch.
  let port = null
  try {
    port = await serveRenderer()
  } catch (e) {
    console.error('[server] could not start:', e.message)
  }
  if (process.env.VITE_DEV) {
    await win.loadURL('http://127.0.0.1:5173')
  } else if (port) {
    await win.loadURL(`http://127.0.0.1:${port}/index.html`)
  } else {
    await win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
}

let rendererServer = null
let rendererPort = null

// Tries the preferred port, then a few fallbacks. A busy port must never stop
// the app from starting — it only changes the OBS overlay URL.
async function serveRenderer() {
  for (let port = 43112; port <= 43117; port++) {
    try {
      await listenOn(port)
      rendererPort = port
      if (port !== 43112) console.warn(`[server] port 43112 busy, using ${port}`)
      return port
    } catch (e) {
      if (e && e.code === 'EADDRINUSE') continue
      throw e
    }
  }
  throw new Error('No free port for the local server (43112-43117)')
}

function listenOn(RENDERER_PORT) {
  const root = path.join(__dirname, '../../dist')
  return new Promise((resolve, reject) => {
    rendererServer = http.createServer((req, res) => {
      if (overlay.handle(req, res)) return
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      const file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath))
      if (!file.startsWith(root)) {
        res.writeHead(403)
        res.end()
        return
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
        res.end(data)
      })
    })
    rendererServer.on('error', (e) => {
      try { rendererServer.close() } catch {}
      rendererServer = null
      reject(e)
    })
    rendererServer.listen(RENDERER_PORT, '127.0.0.1', () => resolve(RENDERER_PORT))
  })
}

const overlayUrl = () => (rendererPort ? `http://127.0.0.1:${rendererPort}/overlay` : null)

function registerIpc() {
  ipcMain.handle('settings:get', () => store.all())
  ipcMain.handle('settings:set', (_e, patch) => {
    store.merge(patch)
    return store.all()
  })

  ipcMain.handle('spotify:connect', async () => {
    await account.connect(store)
    initSpotifyControl()
    send('spotify:status', spotifyStatus())
    return spotifyStatus()
  })
  ipcMain.handle('spotify:disconnect', () => {
    if (control) control.stop()
    control = null
    account.disconnect(store)
    send('spotify:status', spotifyStatus())
    return spotifyStatus()
  })
  ipcMain.handle('spotify:status', () => spotifyStatus())

  // Remote-control commands against the user's own Spotify app.
  ipcMain.handle('spotify:addToQueue', (_e, uri) => initSpotifyControl().addToQueue(uri))
  ipcMain.handle('spotify:next', () => initSpotifyControl().next())
  ipcMain.handle('spotify:previous', () => initSpotifyControl().previous())
  ipcMain.handle('spotify:pause', () => initSpotifyControl().pause())
  ipcMain.handle('spotify:resume', () => initSpotifyControl().play())
  ipcMain.handle('spotify:seek', (_e, ms) => initSpotifyControl().seek(ms))
  ipcMain.handle('spotify:setVolume', (_e, pct) => initSpotifyControl().setVolume(pct))
  ipcMain.handle('spotify:playContext', (_e, opts) => initSpotifyControl().playContext(opts))
  ipcMain.handle('spotify:devices', () => initSpotifyControl().devices())
  ipcMain.handle('spotify:transfer', (_e, id) => initSpotifyControl().transferTo(id))
  ipcMain.handle('spotify:refresh', () => {
    const c = initSpotifyControl()
    c.pollState()
    c.pollQueue()
  })

  ipcMain.handle('search:spotify', (_e, q, limit) => spotifySearch.search(store, q, limit))
  ipcMain.handle('resolve:spotify', (_e, id) => spotifySearch.getTrack(store, id))

  ipcMain.handle('twitch:connect', async () => {
    if (twitchConnecting) throw new Error('Twitch login already in progress')
    twitchConnecting = true
    try {
      await twitchAuth.connect(store)
      startTwitchService()
      return twitchStatus()
    } finally {
      twitchConnecting = false
    }
  })
  ipcMain.handle('twitch:disconnect', () => {
    if (twitch) twitch.stop()
    twitch = null
    twitchAuth.disconnect(store)
    send('twitch:status', twitchStatus())
    return twitchStatus()
  })
  ipcMain.handle('twitch:status', () => twitchStatus())
  ipcMain.handle('twitch:say', (_e, text) => (twitch ? twitch.say(text) : false))

  ipcMain.handle('library:status', () => account.status(store))
  ipcMain.handle('library:playlists', () => account.playlists(store))
  ipcMain.handle('library:tracks', (_e, id) => account.playlistTracks(store, id))

  // Plain-English connection self-test — turns "it doesn't work" into a reason.
  ipcMain.handle('spotify:diagnose', async () => {
    const lines = []
    const tok = store.get('spotifyLibraryTokens')
    const usingOwn = !!(store.get('spotifyUserClientId') || '').trim()
    lines.push(`Spotify app in use: ${usingOwn ? 'your own Client ID' : 'the built-in one'}`)
    if (!tok) {
      lines.push('✗ Not logged in — click "Connect Spotify".')
      return lines.join('\n')
    }
    lines.push(
      account.hasPlayerScopes(store)
        ? '✓ Playback permissions granted'
        : '✗ Missing playback permissions — click "Reconnect".'
    )
    try {
      const me = await account.request(store, 'GET', '/me')
      lines.push(`✓ Spotify accepted the login (account: ${me.display_name || me.id})`)
    } catch (e) {
      lines.push(`✗ Spotify rejected the account: ${e.message}`)
      if (e.code === 'FORBIDDEN') {
        lines.push(
          '   This usually means this Spotify account is not on the built-in app\'s approved list.',
          '   Fix: use your own Spotify app (below), or ask to be added.'
        )
      }
      return lines.join('\n')
    }
    try {
      const p = await account.request(store, 'GET', '/me/player')
      if (!p) lines.push('• Spotify is connected but idle — press play in Spotify and test again.')
      else
        lines.push(
          `✓ Sees playback: ${(p.item && p.item.name) || 'nothing'} on ${(p.device && p.device.name) || 'unknown device'}`
        )
    } catch (e) {
      lines.push(`✗ Can't read playback: ${e.message}`)
    }
    return lines.join('\n')
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), overlayUrl: overlayUrl() }))
  ipcMain.handle('update:state', () => updateState)
  ipcMain.handle('update:check', () => {
    checkForUpdates()
    return updateState
  })
  ipcMain.handle('update:install', () => {
    if (!updater || updateState.status !== 'ready') return false
    if (control) control.stop()
    // Install now and relaunch. Quitting normally would install it too.
    setImmediate(() => updater.quitAndInstall(false, true))
    return true
  })

  ipcMain.handle('overlay:update', (_e, track) => overlay.setTrack(track))
  ipcMain.handle('overlay:show', () => overlay.replay())
  ipcMain.handle('overlay:hide', () => overlay.hide())

  ipcMain.handle('resolve:youtubeStream', (_e, id) => require('./ytdlp').resolveStream(id))
  ipcMain.handle('search:youtube', (_e, q) => search.youtubeSearch(q))
  ipcMain.handle('search:soundcloud', (_e, q) => search.soundcloudSearch(q))
  ipcMain.handle('resolve:youtube', (_e, id) => search.youtubeResolve(id))
  ipcMain.handle('resolve:soundcloud', (_e, url) => search.soundcloudResolve(url))

  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('win:minimize', () => win && win.minimize())
  ipcMain.handle('win:maximize', () => {
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('win:close', () => win && win.close())
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.setAppUserModelId('gg.songseek.app')

  app.whenReady().then(async () => {
    store = new Store()
    registerIpc()
    try {
      await createWindow()
      startTwitchService()
      // Start watching the user's Spotify playback if already connected.
      if (store.get('spotifyLibraryTokens')) initSpotifyControl()
    } catch (e) {
      console.error('[startup]', e)
    }
    // Always last and outside the try: updates must run even if something above
    // failed, so a broken build can still repair itself.
    setupAutoUpdater()
  })

  app.on('before-quit', () => {
    // Nothing clever here on purpose: electron-updater's autoInstallOnAppQuit
    // installs a downloaded update as the app exits, so the next launch is
    // already the new version. Preventing the quit to call quitAndInstall
    // ourselves was unreliable — if it no-op'd, the app just never closed.
    if (control) control.stop()
  })
  app.on('window-all-closed', () => app.quit())
}

// ---- auto-update (GitHub Releases) ----
// Downloads in the background while the app is open and installs on quit, so
// the next launch runs the new version. Windows only — macOS auto-update needs
// a paid Apple signing certificate.
let updater = null
let updateState = {
  currentVersion: '',
  supported: false,
  status: 'idle', // idle | checking | downloading | ready | current | error | unsupported
  version: null,
  percent: 0,
  error: null,
}

function updateLog(line) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'update.log'),
      `[${new Date().toISOString()}] ${line}\n`
    )
  } catch {}
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  send('update:state', updateState)
}

function checkForUpdates() {
  if (!updater) return
  setUpdateState({ status: 'checking', error: null })
  updater.checkForUpdates().catch((e) => {
    const msg = String((e && e.message) || e)
    updateLog('check failed: ' + msg)
    setUpdateState({ status: 'error', error: msg })
  })
}

function setupAutoUpdater() {
  updateState.currentVersion = app.getVersion()
  const supported = app.isPackaged && process.platform === 'win32'
  if (!supported) {
    setUpdateState({ supported: false, status: 'unsupported' })
    updateLog(`updates unsupported (packaged=${app.isPackaged}, platform=${process.platform})`)
    return
  }
  try {
    updater = require('electron-updater').autoUpdater
  } catch (e) {
    setUpdateState({ supported: false, status: 'error', error: 'updater unavailable' })
    return
  }
  setUpdateState({ supported: true, status: 'idle' })

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true // installs on quit → next launch is updated
  updater.disableWebInstaller = true
  updater.logger = { info: updateLog, warn: updateLog, error: updateLog, debug: () => {} }

  updater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }))
  updater.on('update-available', (i) => {
    updateLog('update available: ' + i.version)
    setUpdateState({ status: 'downloading', version: i.version, percent: 0, error: null })
  })
  updater.on('update-not-available', () => setUpdateState({ status: 'current', error: null }))
  updater.on('download-progress', (p) =>
    setUpdateState({ status: 'downloading', percent: Math.round(p.percent || 0) })
  )
  updater.on('update-downloaded', (i) => {
    updateLog('update downloaded: ' + i.version)
    setUpdateState({ status: 'ready', version: i.version, percent: 100 })
    send('update:ready', { version: i.version })
  })
  updater.on('error', (e) => {
    const msg = String((e && e.message) || e)
    updateLog('error: ' + msg)
    setUpdateState({ status: 'error', error: msg })
  })

  setTimeout(checkForUpdates, 4000) // soon after launch, not 20s
  setInterval(checkForUpdates, 30 * 60 * 1000)
}
