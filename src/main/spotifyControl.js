const { EventEmitter } = require('events')
const account = require('./spotifyAccount')

// Remote control for the user's own Spotify app. SongSeek plays no Spotify audio;
// it reads playback state and issues commands (queue/next/pause/play/volume).
// Adding to Spotify's native queue is what keeps the user's playlist context
// intact — the queued song plays next, then Spotify returns to whatever was on.

const STATE_MS = 2000 // poll playback state
const QUEUE_MS = 6000 // poll upcoming queue (changes less often)

class SpotifyControl extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.timer = null
    this.queueTimer = null
    this.state = emptyState()
    this.queue = []
    this.backoffUntil = 0
  }

  start() {
    this.stop()
    this.timer = setInterval(() => this.pollState(), STATE_MS)
    this.queueTimer = setInterval(() => this.pollQueue(), QUEUE_MS)
    this.pollState()
    this.pollQueue()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.queueTimer) clearInterval(this.queueTimer)
    this.timer = this.queueTimer = null
  }

  emitState(patch) {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  async pollState() {
    if (Date.now() < this.backoffUntil) return
    if (!this.store.get('spotifyLibraryTokens')) return
    if (!account.hasPlayerScopes(this.store)) {
      this.emitState({ needsReconnect: true, hasDevice: false })
      return
    }
    try {
      // 204 (null) means: connected, but no active device.
      const j = await account.request(this.store, 'GET', '/me/player')
      if (!j) {
        this.emitState({ ...emptyState(), hasDevice: false, error: null, needsReconnect: false })
        return
      }
      const item = j.item || null
      this.emitState({
        hasDevice: true,
        needsReconnect: false,
        error: null,
        isPlaying: !!j.is_playing,
        progressMs: j.progress_ms || 0,
        durationMs: (item && item.duration_ms) || 0,
        volumePercent: j.device && typeof j.device.volume_percent === 'number' ? j.device.volume_percent : null,
        deviceName: (j.device && j.device.name) || null,
        deviceId: (j.device && j.device.id) || null,
        supportsVolume: !!(j.device && j.device.supports_volume),
        track: item ? account.mapTrack(item) : null,
      })
    } catch (e) {
      this.handleError(e)
    }
  }

  async pollQueue() {
    if (Date.now() < this.backoffUntil) return
    if (!this.store.get('spotifyLibraryTokens') || !account.hasPlayerScopes(this.store)) return
    try {
      const j = await account.request(this.store, 'GET', '/me/player/queue')
      const list = ((j && j.queue) || []).map(account.mapTrack).filter(Boolean)
      this.queue = list
      this.emit('queue', list)
    } catch (e) {
      if (e.code === 'RATE_LIMIT') this.backoffUntil = Date.now() + 15000
    }
  }

  handleError(e) {
    if (e.code === 'RATE_LIMIT') {
      this.backoffUntil = Date.now() + 15000
      return
    }
    if (e.code === 'NO_DEVICE') {
      this.emitState({ hasDevice: false, isPlaying: false })
      return
    }
    if (e.code === 'NEEDS_RECONNECT') {
      this.emitState({ needsReconnect: true, hasDevice: false })
      return
    }
    if (e.code === 'NO_AUTH') {
      this.emitState({ ...emptyState(), error: e.message })
      return
    }
    this.emitState({ error: e.message })
  }

  // ---- commands (all target the user's active device) ----

  async addToQueue(uri) {
    await account.request(this.store, 'POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`, {
      expectEmpty: true,
    })
    // Reflect the change quickly in the UI.
    setTimeout(() => this.pollQueue(), 400)
  }

  async next() {
    await account.request(this.store, 'POST', '/me/player/next', { expectEmpty: true })
    setTimeout(() => this.pollState(), 350)
    setTimeout(() => this.pollQueue(), 700)
  }

  async previous() {
    await account.request(this.store, 'POST', '/me/player/previous', { expectEmpty: true })
    setTimeout(() => this.pollState(), 350)
  }

  async pause() {
    await account.request(this.store, 'PUT', '/me/player/pause', { expectEmpty: true })
    this.emitState({ isPlaying: false })
    setTimeout(() => this.pollState(), 350)
  }

  async play(body) {
    await account.request(this.store, 'PUT', '/me/player/play', { body, expectEmpty: true })
    this.emitState({ isPlaying: true })
    setTimeout(() => this.pollState(), 500)
    setTimeout(() => this.pollQueue(), 900)
  }

  async seek(ms) {
    await account.request(this.store, 'PUT', `/me/player/seek?position_ms=${Math.round(ms)}`, {
      expectEmpty: true,
    })
    this.emitState({ progressMs: Math.round(ms) })
    setTimeout(() => this.pollState(), 400)
  }

  async setVolume(percent) {
    const v = Math.max(0, Math.min(100, Math.round(percent)))
    await account.request(this.store, 'PUT', `/me/player/volume?volume_percent=${v}`, { expectEmpty: true })
    this.emitState({ volumePercent: v })
  }

  // Start a playlist (or Liked Songs, which has no context uri) on the user's device.
  async playContext({ contextUri, uris, offset }) {
    const body = contextUri ? { context_uri: contextUri } : { uris }
    if (offset != null) body.offset = { position: offset }
    await this.play(body)
  }

  async devices() {
    const j = await account.request(this.store, 'GET', '/me/player/devices')
    return (j && j.devices) || []
  }

  // Wake up a device when nothing is active (e.g. Spotify open but idle).
  async transferTo(deviceId, play = true) {
    await account.request(this.store, 'PUT', '/me/player', {
      body: { device_ids: [deviceId], play },
      expectEmpty: true,
    })
    setTimeout(() => this.pollState(), 700)
  }
}

function emptyState() {
  return {
    hasDevice: false,
    needsReconnect: false,
    error: null,
    isPlaying: false,
    progressMs: 0,
    durationMs: 0,
    volumePercent: null,
    deviceName: null,
    deviceId: null,
    supportsVolume: false,
    track: null,
  }
}

module.exports = { SpotifyControl }
