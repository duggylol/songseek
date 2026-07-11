const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const Store = require('./store')
const spotifyAuth = require('./spotifyAuth')
const twitchAuth = require('./twitchAuth')
const TwitchService = require('./twitch')
const { SpotifyPlayer } = require('./spotifyPlayer')
const spotifyLibrary = require('./spotifyLibrary')
const search = require('./searchProxy')

let store = null
let win = null
let twitch = null
let spotify = null
let twitchConnecting = false

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const spotifyStatus = (extra = {}) => ({
  connected: !!store.get('spotifyTokens'),
  user: store.get('spotifyUser'),
  deviceReady: !!(spotify && spotify.isRunning()),
  ...extra,
})

function initSpotifyPlayer() {
  if (spotify) return
  spotify = new SpotifyPlayer(store)
  spotify.on('pcm', (chunk) => {
    // Forward the raw PCM ArrayBuffer to the renderer's audio worklet.
    if (win && !win.isDestroyed()) {
      win.webContents.send('spotify:pcm', chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength))
    }
  })
  spotify.on('position', (p) => send('spotify:position', p))
  spotify.on('ended', () => send('spotify:ended'))
  spotify.on('status', (s) => {
    if (s.username) {
      const u = store.get('spotifyUser') || {}
      store.set('spotifyUser', { ...u, name: s.username })
    }
    send('spotify:status', spotifyStatus(s))
  })
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

  if (process.env.VITE_DEV) {
    await win.loadURL('http://127.0.0.1:5173')
  } else {
    // Serve the UI over local HTTP instead of file:// — YouTube's player refuses
    // to play many videos (esp. music) for embeds without a real web origin.
    const port = await serveRenderer()
    await win.loadURL(`http://127.0.0.1:${port}/index.html`)
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
function serveRenderer() {
  const RENDERER_PORT = 43112
  const root = path.join(__dirname, '../../dist')
  return new Promise((resolve, reject) => {
    rendererServer = http.createServer((req, res) => {
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
    rendererServer.on('error', reject)
    rendererServer.listen(RENDERER_PORT, '127.0.0.1', () => resolve(RENDERER_PORT))
  })
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.all())
  ipcMain.handle('settings:set', (_e, patch) => {
    store.merge(patch)
    return store.all()
  })

  ipcMain.handle('spotify:connect', async () => {
    await spotifyAuth.connect(store)
    initSpotifyPlayer()
    spotify.start().catch((e) => send('spotify:status', spotifyStatus({ error: e.message })))
    send('spotify:status', spotifyStatus())
    return spotifyStatus()
  })
  ipcMain.handle('spotify:disconnect', async () => {
    if (spotify) await spotify.stop()
    spotifyAuth.disconnect(store)
    send('spotify:status', spotifyStatus())
    return spotifyStatus()
  })
  ipcMain.handle('spotify:status', () => spotifyStatus())
  ipcMain.handle('spotify:play', (_e, uri) => {
    initSpotifyPlayer()
    return spotify.playUri(uri)
  })
  ipcMain.handle('spotify:pause', () => spotify && spotify.pause())
  ipcMain.handle('spotify:resume', () => spotify && spotify.resume())
  ipcMain.handle('spotify:seek', (_e, ms) => spotify && spotify.seek(ms))
  ipcMain.handle('spotify:stopPlayback', () => spotify && spotify.stopPlayback())

  ipcMain.handle('search:spotify', (_e, q, limit) => spotifyAuth.search(store, q, limit))
  ipcMain.handle('resolve:spotify', (_e, id) => spotifyAuth.getTrack(store, id))

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

  ipcMain.handle('library:connect', () => spotifyLibrary.connect(store))
  ipcMain.handle('library:disconnect', () => {
    spotifyLibrary.disconnect(store)
    return spotifyLibrary.status(store)
  })
  ipcMain.handle('library:status', () => spotifyLibrary.status(store))
  ipcMain.handle('library:playlists', () => spotifyLibrary.playlists(store))
  ipcMain.handle('library:tracks', (_e, id) => spotifyLibrary.playlistTracks(store, id))

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
    await createWindow()
    startTwitchService()
    // Resume the Spotify engine automatically if already logged in.
    if (store.get('spotifyUser')) {
      initSpotifyPlayer()
      spotify.start().catch((e) => send('spotify:status', spotifyStatus({ error: e.message })))
    }
    setupAutoUpdater()
  })

  app.on('before-quit', (e) => {
    // If an update was downloaded, install it now and relaunch the updated app.
    if (updateReady && !installingUpdate) {
      installingUpdate = true
      e.preventDefault()
      if (spotify) spotify.stop()
      try {
        require('electron-updater').autoUpdater.quitAndInstall(true, true) // silent + relaunch
      } catch {
        app.exit(0)
      }
      return
    }
    if (spotify) spotify.stop()
  })
  app.on('window-all-closed', () => app.quit())
}

// ---- auto-update (GitHub Releases) ----
// Checks in the background while the app is open; the downloaded update is
// applied when the user closes the app, which then relaunches itself updated.
let updateReady = null
let installingUpdate = false

function setupAutoUpdater() {
  // Windows only: mac auto-update requires a paid Apple signing certificate.
  if (!app.isPackaged || process.platform !== 'win32') return
  let updater
  try {
    updater = require('electron-updater').autoUpdater
  } catch {
    return
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true // safety net if before-quit doesn't run
  updater.on('update-downloaded', (info) => {
    updateReady = info.version
    send('update:ready', { version: info.version })
  })
  updater.on('error', () => {}) // offline / no release yet — stay quiet
  const check = () => updater.checkForUpdates().catch(() => {})
  setTimeout(check, 20 * 1000) // shortly after launch
  setInterval(check, 45 * 60 * 1000) // and periodically while open
}
