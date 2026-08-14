// Update-before-open.
//
// On launch we show a small progress window, ask GitHub whether there's a newer
// build, and if there is, download and install it before the app opens — the
// installer relaunches straight into the new version. That replaces the old
// "download while running, install on quit" flow, where a user who never fully
// quit could sit on a stale build for days.
//
// The overriding rule here is that NOTHING in this file may stop SongSeek from
// opening. GitHub being slow, offline, rate-limited, or returning junk must all
// end the same way: close the window and launch what's already installed. Every
// exit path resolves, and three independent timers guarantee it.

const { app, BrowserWindow } = require('electron')
const path = require('path')

const CHECK_TIMEOUT_MS = 9000 // no verdict from GitHub → just open the app
const STALL_TIMEOUT_MS = 45000 // download stopped moving → give up, open the app
const CEILING_MS = 5 * 60 * 1000 // absolute backstop for the whole phase

// Accent per theme so the splash matches what the user picked. Mirrors themes.js.
const ACCENTS = {
  midnight: ['#8b7bff', '#6f5cff'],
  verdant: ['#1ed760', '#14a34a'],
  aurora: ['#3fe0c8', '#4b8cff'],
  ember: ['#ff8a4c', '#ff4d6d'],
  mono: ['#ffffff', '#b9b9b9'],
  synthwave: ['#ff4ecd', '#00e5ff'],
}

function createSplash(theme) {
  const win = new BrowserWindow({
    width: 400,
    height: 190,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    title: 'SongSeek',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.removeMenu && win.removeMenu()
  win.loadFile(path.join(__dirname, 'splash.html'))
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.show()
    const [a, b] = ACCENTS[theme] || ACCENTS.midnight
    run(win, `window.__setAccent(${JSON.stringify(a)}, ${JSON.stringify(b)})`)
    run(win, `window.__setVersion(${JSON.stringify('v' + app.getVersion())})`)
  })
  return win
}

// executeJavaScript rejects if the window closed mid-flight; never let that
// bubble up and take the launch down with it.
function run(win, js) {
  if (!win || win.isDestroyed()) return Promise.resolve()
  return win.webContents.executeJavaScript(js).catch(() => {})
}

/**
 * Resolves when it's safe to open the main window. If an update is installed
 * this never resolves — the installer takes over and relaunches the app.
 * @returns {Promise<{updated: boolean, reason: string}>}
 */
function runBootUpdate({ log = () => {}, theme = 'midnight', demo = false } = {}) {
  const supported = app.isPackaged && process.platform === 'win32'
  if (!supported && !demo) {
    log(`boot update skipped (packaged=${app.isPackaged}, platform=${process.platform})`)
    return Promise.resolve({ updated: false, reason: 'unsupported' })
  }

  return new Promise((resolve) => {
    let splash = null
    let done = false
    let timers = []
    let intervals = []

    const clearTimers = () => {
      timers.forEach((t) => clearTimeout(t))
      intervals.forEach((t) => clearInterval(t))
      timers = []
      intervals = []
    }
    // Single exit point. Idempotent, always closes the splash, always resolves.
    const finish = (reason) => {
      if (done) return
      done = true
      clearTimers()
      log(`boot update → continue (${reason})`)
      if (splash && !splash.isDestroyed()) splash.destroy()
      resolve({ updated: false, reason })
    }
    const after = (ms, fn) => timers.push(setTimeout(fn, ms))

    try {
      splash = createSplash(theme)
    } catch (e) {
      return finish('splash failed: ' + (e && e.message))
    }

    const say = (text, percent) =>
      run(splash, `window.__set(${JSON.stringify(text)}, ${percent == null ? 'null' : percent})`)

    // Backstop: whatever happens, the app opens.
    after(CEILING_MS, () => finish('ceiling reached'))

    if (demo) {
      // Dev-only path for eyeballing the window without a real release.
      say('Checking for updates…', null)
      after(1200, () => say('Downloading update 9.9.9…', 0))
      let p = 0
      const tick = setInterval(() => {
        p += 7
        say(`Downloading update 9.9.9 — ${Math.min(p, 100)}%`, Math.min(p, 100))
        if (p >= 100) {
          clearInterval(tick)
          say('Installing…', 100)
          after(1500, () => finish('demo complete'))
        }
      }, 160)
      intervals.push(tick)
      return
    }

    let updater
    try {
      updater = require('electron-updater').autoUpdater
    } catch (e) {
      return finish('updater unavailable')
    }

    // We drive the download ourselves so the splash can report real progress.
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.disableWebInstaller = true
    updater.logger = { info: log, warn: log, error: log, debug: () => {} }

    say('Checking for updates…', null)
    const checkTimer = setTimeout(() => finish('check timed out'), CHECK_TIMEOUT_MS)
    timers.push(checkTimer)

    let stallTimer = null
    const bumpStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => finish('download stalled'), STALL_TIMEOUT_MS)
      timers.push(stallTimer)
    }

    updater.once('update-not-available', () => {
      clearTimeout(checkTimer)
      say('SongSeek is up to date', 100)
      // A brief beat so the window doesn't just flicker past.
      after(450, () => finish('up to date'))
    })

    updater.once('update-available', (info) => {
      clearTimeout(checkTimer)
      const v = (info && info.version) || ''
      log('boot update available: ' + v)
      say(`Downloading update ${v}…`, 0)
      bumpStall()
      updater.downloadUpdate().catch((e) => finish('download failed: ' + (e && e.message)))
    })

    updater.on('download-progress', (p) => {
      bumpStall()
      const pct = Math.max(0, Math.min(100, Math.round(p.percent || 0)))
      say(`Downloading update — ${pct}%`, pct)
    })

    updater.once('update-downloaded', (info) => {
      clearTimers()
      const v = (info && info.version) || ''
      log('boot update downloaded, installing: ' + v)
      say('Installing…', 100)
      // Let the frame paint before the installer takes the process down.
      setTimeout(() => {
        try {
          // isSilent = true, isForceRunAfter = true → NSIS installs quietly and
          // relaunches straight into the new version.
          updater.quitAndInstall(true, true)
          // If quitAndInstall no-ops for any reason, don't strand the user on a
          // dead splash screen — open the app they already have.
          setTimeout(() => finish('install did not take effect'), 12000)
        } catch (e) {
          finish('install threw: ' + (e && e.message))
        }
      }, 700)
    })

    updater.once('error', (e) => finish('updater error: ' + String((e && e.message) || e)))

    try {
      updater.checkForUpdates().catch((e) => finish('check failed: ' + (e && e.message)))
    } catch (e) {
      finish('check threw: ' + (e && e.message))
    }
  })
}

module.exports = { runBootUpdate }
