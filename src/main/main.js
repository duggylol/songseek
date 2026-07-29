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

  // The local server always runs: it serves the UI in production (YouTube's
  // player refuses embeds without a real web origin) and the OBS overlay always.
  const port = await serveRenderer()
  if (process.env.VITE_DEV) {
    await win.loadURL('http://127.0.0.1:5173')
  } else {
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
    await createWindow()
    startTwitchService()
    // Start watching the user's Spotify playback if already connected.
    if (store.get('spotifyLibraryTokens')) initSpotifyControl()
    setupAutoUpdater()
  })

  app.on('before-quit', (e) => {
    // If an update was downloaded, install it now and relaunch the updated app.
    if (updateReady && !installingUpdate) {
      installingUpdate = true
      e.preventDefault()
      if (control) control.stop()
      try {
        require('electron-updater').autoUpdater.quitAndInstall(true, true) // silent + relaunch
      } catch {
        app.exit(0)
      }
      return
    }
    if (control) control.stop()
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
