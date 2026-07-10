const { EventEmitter } = require('events')
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')
const { app } = require('electron')

const API_PORT = 43120
const API = `http://127.0.0.1:${API_PORT}`
const PCM_SAMPLE_RATE = 44100
const PCM_CHANNELS = 2

// s16le stereo @ 44.1kHz. The pipe backend has no real-time pacing, so we meter
// PCM out at this rate and backpressure the pipe — otherwise go-librespot decodes
// the whole track in seconds, reports it "finished", and the track skips early.
const BYTES_PER_SEC = PCM_SAMPLE_RATE * PCM_CHANNELS * 2
const PACE_TICK_MS = 25
const START_CREDIT = Math.round(BYTES_PER_SEC * 0.25) // initial buffer for a fast start
const CREDIT_CAP = Math.round(BYTES_PER_SEC * 0.3) // cap catch-up bursts
const HIGH_WATER = BYTES_PER_SEC * 3 // pause reading the pipe above this
const LOW_WATER = BYTES_PER_SEC * 1 // resume reading below this

function binaryPath() {
  const plat = `${process.platform}-${process.arch}`
  const name = process.platform === 'win32' ? 'go-librespot.exe' : 'go-librespot'
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '../../resources/bin')
  return path.join(base, plat, name)
}

// Drives the bundled go-librespot daemon: writes its config, owns the audio pipe
// that carries raw PCM back into the app, and exposes playback controls + events.
// Emits: 'ready', 'pcm' (Buffer), 'position' ({positionMs,durationMs,playing}),
//        'ended', 'status' ({running,error}).
class SpotifyPlayer extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.proc = null
    this.ws = null
    this.pipeServer = null
    this.pipeStream = null
    this.ready = false
    this.starting = null
    this.currentUri = null
    this.configDir = path.join(app.getPath('userData'), 'librespot')
    this.pipeFd = null
    this.carry = null // partial stereo frame carried between pipe chunks
    this.pace = null // real-time PCM meter
    this.endTimer = null
    this.pipePath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\songseek-audio-${process.pid}`
        : path.join(this.configDir, 'audio.fifo')
  }

  isRunning() {
    return !!this.proc && this.ready
  }

  writeConfig(username, token) {
    fs.mkdirSync(this.configDir, { recursive: true })
    // YAML — credentials.type spotify_token bootstraps the session from our OAuth
    // token; after first login go-librespot stores its own creds in state and the
    // token is no longer needed. Audio is written as PCM to our pipe.
    const yaml = [
      'device_name: SongSeek',
      'device_type: computer',
      'bitrate: 320',
      'audio_backend: pipe',
      // Double-quoted so backslashes (Windows pipe) and spaces (mac path) are safe.
      `audio_output_pipe: "${this.pipePath.replace(/\\/g, '\\\\')}"`,
      'audio_output_pipe_format: s16le',
      'normalisation_disabled: false',
      'server:',
      '  enabled: true',
      '  address: 127.0.0.1',
      `  port: ${API_PORT}`,
      'credentials:',
      '  type: spotify_token',
      '  spotify_token:',
      `    username: "${(username || '').replace(/"/g, '')}"`,
      `    access_token: "${(token || '').replace(/"/g, '')}"`,
    ].join('\n')
    fs.writeFileSync(path.join(this.configDir, 'config.yml'), yaml + '\n')
  }

  // Create the reader side of the audio pipe BEFORE the daemon opens the writer.
  async setupPipe() {
    await this.teardownPipe()
    this.startPacer()
    if (process.platform === 'win32') {
      // Windows: host a named-pipe server; the daemon connects as a client and
      // writes PCM (see build/librespot patch for the Windows pipe open).
      await new Promise((resolve, reject) => {
        this.pipeServer = net.createServer((sock) => {
          this.pipeStream = sock
          sock.on('data', (chunk) => this.onPcmChunk(chunk))
          sock.on('error', () => {})
        })
        this.pipeServer.on('error', reject)
        this.pipeServer.listen(this.pipePath, resolve)
      })
    } else {
      // Unix: a real FIFO. Open the read end O_RDWR (returns immediately and
      // counts as a reader) so the daemon's non-blocking O_WRONLY open succeeds.
      fs.mkdirSync(this.configDir, { recursive: true })
      try { fs.unlinkSync(this.pipePath) } catch {}
      execFileSync('mkfifo', [this.pipePath])
      this.pipeFd = fs.openSync(this.pipePath, fs.constants.O_RDWR)
      this.pipeStream = fs.createReadStream(null, { fd: this.pipeFd, autoClose: false })
      this.pipeStream.on('data', (chunk) => this.onPcmChunk(chunk))
      this.pipeStream.on('error', () => {})
    }
  }

  // Emit only whole stereo frames (4 bytes = 2ch × s16); carry any remainder so
  // left/right channels never desync across chunk boundaries. Frames go into the
  // pacer queue rather than straight out, so they're metered at real time.
  onPcmChunk(chunk) {
    let data = this.carry ? Buffer.concat([this.carry, chunk]) : chunk
    const usable = data.length - (data.length % 4)
    if (usable < data.length) {
      this.carry = Buffer.from(data.subarray(usable))
      data = data.subarray(0, usable)
    } else {
      this.carry = null
    }
    if (!data.length || !this.pace) return
    this.pace.queue.push(data)
    this.pace.bytes += data.length
    if (this.pace.bytes > HIGH_WATER && this.pipeStream && !this.pace.paused) {
      this.pace.paused = true
      try { this.pipeStream.pause() } catch {}
    }
  }

  startPacer() {
    this.pace = { queue: [], bytes: 0, credit: START_CREDIT, last: 0, paused: false }
    this.pace.timer = setInterval(() => this.drainPacer(), PACE_TICK_MS)
  }

  stopPacer() {
    if (this.pace && this.pace.timer) clearInterval(this.pace.timer)
    this.pace = null
    this.carry = null
  }

  flushPacer() {
    if (!this.pace) return
    this.pace.queue = []
    this.pace.bytes = 0
    this.pace.credit = START_CREDIT
    this.pace.last = 0
    this.carry = null
  }

  drainPacer() {
    const p = this.pace
    if (!p) return
    const now = Date.now()
    if (!p.last) p.last = now
    p.credit = Math.min(CREDIT_CAP, p.credit + ((now - p.last) / 1000) * BYTES_PER_SEC)
    p.last = now

    let emit = Math.min(p.credit, p.bytes)
    emit -= emit % 4
    if (emit > 0) {
      const out = this.pullBytes(emit)
      p.credit -= emit
      p.bytes -= emit
      this.emit('pcm', out)
    }
    if (p.bytes < LOW_WATER && this.pipeStream && p.paused) {
      p.paused = false
      try { this.pipeStream.resume() } catch {}
    }
  }

  pullBytes(n) {
    const out = Buffer.allocUnsafe(n)
    let off = 0
    const q = this.pace.queue
    while (off < n && q.length) {
      const head = q[0]
      const take = Math.min(head.length, n - off)
      head.copy(out, off, 0, take)
      off += take
      if (take === head.length) q.shift()
      else q[0] = head.subarray(take)
    }
    return out
  }

  async teardownPipe() {
    this.stopPacer()
    if (this.pipeStream) { try { this.pipeStream.destroy() } catch {} this.pipeStream = null }
    if (this.pipeFd != null) { try { fs.closeSync(this.pipeFd) } catch {} this.pipeFd = null }
    if (this.pipeServer) {
      await new Promise((r) => this.pipeServer.close(() => r()))
      this.pipeServer = null
    }
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(this.pipePath) } catch {}
    }
  }

  async start() {
    if (this.starting) return this.starting
    this.starting = this._start().catch((e) => {
      this.starting = null
      this.emit('status', { running: false, error: e.message })
      throw e
    })
    return this.starting
  }

  async _start() {
    const user = this.store.get('spotifyUser')
    if (!user) throw new Error('Connect Spotify first')
    // Ensure a fresh token bootstraps the session (ignored once librespot has
    // stored its own creds, but needed on the very first login).
    let token = ''
    try {
      token = (await require('./spotifyAuth').getAccessToken(this.store)) || ''
    } catch {
      const t = this.store.get('spotifyTokens')
      token = (t && t.access_token) || ''
    }

    const bin = binaryPath()
    if (!fs.existsSync(bin)) throw new Error(`Spotify engine not found at ${bin}`)

    await this.stop()
    await this.setupPipe()
    this.writeConfig(user.id, token)

    this.logTail = []
    this.proc = spawn(bin, ['--config_dir', this.configDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.proc.on('error', (e) => {
      this.ready = false
      this.proc = null
      this.emit('status', { running: false, error: `Spotify engine failed to launch: ${e.message}` })
    })
    this.proc.stdout.on('data', (d) => this.onLog(d.toString()))
    this.proc.stderr.on('data', (d) => this.onLog(d.toString()))
    this.proc.on('exit', (code) => {
      this.ready = false
      this.proc = null
      const hint = this.logTail.length ? ` — ${this.logTail[this.logTail.length - 1].slice(0, 160)}` : ''
      const codeStr = code != null && code < 0 ? `0x${(code >>> 0).toString(16)}` : code
      this.emit('status', {
        running: false,
        error: code ? `Spotify engine exited (${codeStr})${hint}` : null,
      })
    })

    await this.waitForApi()
    this.ready = true
    this.connectEvents()
    this.emit('status', { running: true, username: await this.fetchUsername() })
    this.emit('ready')
    this.starting = null
  }

  // The engine knows the real account name (we can't call /v1/me with this token).
  async fetchUsername() {
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch(API + '/status')
        if (r.ok) {
          const j = await r.json().catch(() => ({}))
          if (j && j.username) return j.username
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 700))
    }
    return null
  }

  onLog(text) {
    // Keep a rolling log for diagnosing remote installs.
    try {
      fs.appendFileSync(path.join(this.configDir, 'engine.log'), text)
    } catch {}
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      this.logTail = [...(this.logTail || []), line.trim()].slice(-20)
      if (/bad.*credential|invalid.*token|failed authenticating|unauthorized|401/i.test(line)) {
        this.emit('status', { running: false, error: 'Spotify login expired — reconnect in Settings.' })
      } else if (/failed to open output pipe|failed to open fifo|output.*error/i.test(line)) {
        this.emit('status', {
          running: false,
          error: 'Spotify audio device failed to start. Please restart SongSeek; if it persists, let the developer know.',
        })
      }
    }
  }

  async waitForApi() {
    const deadline = Date.now() + 25000
    let lastErr = 'timeout'
    while (Date.now() < deadline) {
      try {
        const r = await fetch(API + '/status')
        if (r.ok) {
          const j = await r.json().catch(() => ({}))
          if (j && (j.username || j.stopped !== undefined || j.track !== undefined)) return
          return
        }
      } catch (e) {
        lastErr = e.message
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    throw new Error(`Spotify engine did not start (${lastErr})`)
  }

  connectEvents() {
    try { this.ws && this.ws.close() } catch {}
    const ws = new WebSocket(`ws://127.0.0.1:${API_PORT}/events`)
    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      this.handleEvent(msg)
    }
    ws.onclose = () => {
      if (this.ws === ws && this.ready) setTimeout(() => this.connectEvents(), 1000)
    }
    ws.onerror = () => {}
    this.ws = ws
  }

  handleEvent(msg) {
    const t = msg.type
    const d = msg.data || {}
    if (t === 'metadata') {
      this.emit('position', {
        positionMs: d.position || 0,
        durationMs: d.duration || 0,
        playing: true,
      })
    } else if (t === 'playing' || t === 'seek') {
      this.emit('position', { positionMs: d.position, durationMs: d.duration, playing: true })
    } else if (t === 'paused') {
      this.emit('position', { positionMs: d.position, durationMs: d.duration, playing: false })
    } else if (t === 'not_playing' || t === 'stopped') {
      // go-librespot finished *decoding*, but ~1-3s is still buffered in the pacer.
      // Wait for it to drain so the song plays fully before we advance.
      if (this.currentUri) this.scheduleEnded()
    }
  }

  scheduleEnded() {
    if (this.endTimer) return
    const uri = this.currentUri
    const deadline = Date.now() + 6000
    this.endTimer = setInterval(() => {
      const drained = !this.pace || this.pace.bytes < BYTES_PER_SEC * 0.15
      if (this.currentUri !== uri) {
        clearInterval(this.endTimer)
        this.endTimer = null
        return
      }
      if (drained || Date.now() > deadline) {
        clearInterval(this.endTimer)
        this.endTimer = null
        // Small tail for the renderer's own worklet buffer to finish.
        setTimeout(() => {
          if (this.currentUri === uri) this.emit('ended')
        }, 250)
      }
    }, 100)
  }

  async cmd(pathname, body) {
    const r = await fetch(API + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) throw new Error(`Spotify engine command failed (${pathname}: ${r.status})`)
  }

  async playUri(uri) {
    if (!this.ready) await this.start()
    this.currentUri = uri
    this.flushPacer() // drop any buffered audio from the previous track
    // The HTTP server is up before Spotify auth completes; retry briefly so the
    // first request after connecting doesn't fail on a not-yet-ready session.
    let lastErr
    for (let i = 0; i < 12; i++) {
      try {
        await this.cmd('/player/play', { uri, skip_to_uri: uri, paused: false })
        return
      } catch (e) {
        lastErr = e
        if (this.currentUri !== uri) return // superseded by a newer request
        await new Promise((r) => setTimeout(r, 800))
      }
    }
    throw lastErr || new Error('Spotify playback failed')
  }

  pause() { return this.cmd('/player/pause').catch(() => {}) }
  resume() { return this.cmd('/player/resume').catch(() => {}) }
  seek(ms) {
    this.flushPacer() // drop pre-seek audio so the new position plays immediately
    return this.cmd('/player/seek', { position: Math.round(ms), relative: false }).catch(() => {})
  }

  async stopPlayback() {
    this.currentUri = null
    await this.cmd('/player/stop').catch(() => {})
  }

  async stop() {
    this.ready = false
    this.currentUri = null
    if (this.endTimer) { clearInterval(this.endTimer); this.endTimer = null }
    try { this.ws && this.ws.close() } catch {}
    this.ws = null
    if (this.proc) {
      const p = this.proc
      this.proc = null
      try { p.kill() } catch {}
      await new Promise((r) => {
        const to = setTimeout(() => { try { p.kill('SIGKILL') } catch {} ; r() }, 2500)
        p.on('exit', () => { clearTimeout(to); r() })
      })
    }
    await this.teardownPipe()
  }
}

module.exports = { SpotifyPlayer, PCM_SAMPLE_RATE, PCM_CHANNELS }
