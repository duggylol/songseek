const { EventEmitter } = require('events')

// Kick chat runs on a public Pusher cluster. These are Kick's own front-end app
// key/cluster (the same values kick.com's website uses); reading a public
// channel's chat needs no auth. This is an UNOFFICIAL transport — Kick's
// official events are webhook-only, unusable from a desktop app — so it can
// change without notice. If Kick ships a WebSocket/EventSub-style transport,
// swap this out for it.
const PUSHER_KEY = '32cbd69e4b950bf97679'
const PUSHER_CLUSTER = 'us2'
const pusherUrl = () =>
  `wss://ws-${PUSHER_CLUSTER}.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`

// Mirrors TwitchService's surface exactly: emits 'request', 'command', 'status'
// so the rest of the app treats both platforms identically. The only functional
// gap is announcing back into chat, which needs auth we deliberately don't have
// on this path — say() is a no-op that reports false.
class KickService extends EventEmitter {
  constructor({ store }) {
    super()
    this.store = store
    this.stopped = true
    this.ws = null
    this.retry = 0
    this.pingTimer = null
  }

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    clearInterval(this.pingTimer)
    this.pingTimer = null
    try { this.ws && this.ws.close() } catch {}
    this.ws = null
    this.emit('status', { connected: false })
  }

  connect() {
    if (this.stopped) return
    const user = this.store.get('kickUser')
    if (!user || !user.chatroomId) return

    const ws = new WebSocket(pusherUrl())
    ws.onmessage = (e) => this.handle(ws, e.data)
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return
      this.ws = null
      clearInterval(this.pingTimer)
      this.emit('status', { connected: false, error: 'Kick chat disconnected — reconnecting…' })
      const delay = Math.min(30000, 1000 * 2 ** this.retry++)
      setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => {}
    this.ws = ws
  }

  handle(ws, raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    // Pusher frames wrap their payload as a JSON string in `data`.
    let data = msg.data
    if (typeof data === 'string') { try { data = JSON.parse(data) } catch {} }

    if (msg.event === 'pusher:connection_established') {
      this.retry = 0
      const chatroomId = this.store.get('kickUser').chatroomId
      // Subscribe to the channel's v2 chatroom feed.
      ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } }))
      ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatroom_${chatroomId}` } }))
      // Keep the socket warm; Pusher expects periodic pings.
      clearInterval(this.pingTimer)
      this.pingTimer = setInterval(() => { try { ws.send(JSON.stringify({ event: 'pusher:ping', data: {} })) } catch {} }, 60000)
      this.emit('status', { connected: true })
      return
    }
    if (msg.event === 'pusher:ping') { try { ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })) } catch {}; return }

    // Chat message events. Kick has used a couple of event names over time.
    if (msg.event === 'App\\Events\\ChatMessageEvent' || msg.event === 'ChatMessageEvent') {
      this.handleChatMessage(data)
    }
  }

  handleChatMessage(m) {
    if (!m || !m.content) return
    const sender = m.sender || {}
    const display = sender.username || sender.slug || 'viewer'
    const badges = (sender.identity && sender.identity.badges) || []
    const isMod = badges.some((b) => ['moderator', 'broadcaster', 'owner', 'admin', 'super_admin'].includes(b.type))
    const text = String(m.content).trim()

    // Song request command (any viewer) — identical rules to Twitch.
    if (this.store.get('chatCommandEnabled')) {
      const cmd = String(this.store.get('chatCommand') || '!sr').trim()
      if (cmd && text.toLowerCase().startsWith(cmd.toLowerCase() + ' ')) {
        this.emit('request', { user: display, input: text.slice(cmd.length + 1).trim(), via: 'chat' })
        return
      }
    }

    // Playback commands. !song is for everyone; the rest are mods/broadcaster only.
    if (!this.store.get('modCommandsEnabled')) return
    const word = text.split(/\s+/)[0].toLowerCase()
    const COMMANDS = {
      '!skip': 'skip', '!pause': 'pause', '!play': 'resume', '!resume': 'resume',
      '!clearqueue': 'clearqueue', '!song': 'song', '!currentsong': 'song', '!np': 'song',
    }
    const action = COMMANDS[word]
    if (!action) return
    if (action !== 'song' && !isMod) return
    this.emit('command', { cmd: action, user: display, isMod })
  }

  // Posting to Kick chat needs an authenticated session we don't hold on this
  // path. Report false so callers fall back cleanly (e.g. to Twitch).
  say() { return false }
}

module.exports = KickService
