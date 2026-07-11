const { EventEmitter } = require('events')

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws'
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'

// Listens for channel-point redemptions (EventSub WebSocket) and chat commands (IRC),
// and can announce queue updates back into chat.
class TwitchService extends EventEmitter {
  constructor({ store, getToken }) {
    super()
    this.store = store
    this.getToken = getToken
    this.stopped = true
    this.es = null
    this.irc = null
    this.ircReady = false
    this.esRetry = 0
    this.ircRetry = 0
  }

  start() {
    this.stopped = false
    this.connectEventSub()
    this.connectChat()
  }

  stop() {
    this.stopped = true
    try { this.es && this.es.close() } catch {}
    try { this.irc && this.irc.close() } catch {}
    this.es = null
    this.irc = null
    this.ircReady = false
    this.emit('status', { connected: false })
  }

  // ---- EventSub (channel point redemptions) ----

  connectEventSub(url = EVENTSUB_URL) {
    if (this.stopped) return
    const ws = new WebSocket(url)
    ws.onmessage = (e) => this.handleEventSubMessage(ws, JSON.parse(e.data))
    ws.onclose = () => {
      if (this.stopped || this.es !== ws) return
      this.es = null
      this.emit('status', { connected: false, error: 'EventSub disconnected — reconnecting…' })
      const delay = Math.min(30000, 1000 * 2 ** this.esRetry++)
      setTimeout(() => this.connectEventSub(), delay)
    }
    ws.onerror = () => {}
    if (this.es) { const old = this.es; setTimeout(() => { try { old.close() } catch {} }, 5000) }
    this.es = ws
  }

  async handleEventSubMessage(ws, msg) {
    const type = msg.metadata && msg.metadata.message_type
    if (type === 'session_welcome') {
      this.esRetry = 0
      try {
        await this.subscribeRedemptions(msg.payload.session.id)
        this.emit('status', { connected: true })
      } catch (e) {
        this.emit('status', { connected: false, error: e.message })
      }
    } else if (type === 'session_reconnect') {
      this.connectEventSub(msg.payload.session.reconnect_url)
    } else if (type === 'notification') {
      const ev = msg.payload.event
      if (msg.payload.subscription.type !== 'channel.channel_points_custom_reward_redemption.add') return
      const want = String(this.store.get('rewardName') || '').trim().toLowerCase()
      const got = String((ev.reward && ev.reward.title) || '').trim().toLowerCase()
      if (want && got !== want) return
      this.emit('request', {
        user: ev.user_name,
        input: (ev.user_input || '').trim(),
        via: 'redeem',
        reward: ev.reward ? ev.reward.title : '',
      })
    }
  }

  async subscribeRedemptions(sessionId) {
    const token = await this.getToken()
    const user = this.store.get('twitchUser')
    if (!token || !user) throw new Error('Twitch not authenticated')
    const r = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': this.store.get('twitchClientId'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: user.id },
        transport: { method: 'websocket', session_id: sessionId },
      }),
    })
    if (r.status === 409) return // already subscribed (session carried over a reconnect)
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(
        `Couldn't subscribe to redemptions (${r.status}): ${j.message || 'unknown'}. ` +
          `You need to be a Twitch Affiliate/Partner for channel points.`
      )
    }
  }

  // ---- IRC chat (command requests + announcements) ----

  async connectChat() {
    if (this.stopped) return
    let token
    try { token = await this.getToken() } catch { token = null }
    const user = this.store.get('twitchUser')
    if (!token || !user) return

    const ws = new WebSocket(IRC_URL)
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws.send(`PASS oauth:${token}`)
      ws.send(`NICK ${user.login}`)
      ws.send(`JOIN #${user.login}`)
    }
    ws.onmessage = (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (!line) continue
        if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue }
        if (line.includes(' 001 ')) { this.ircReady = true; this.ircRetry = 0; continue }
        this.handleChatLine(line)
      }
    }
    ws.onclose = () => {
      if (this.stopped || this.irc !== ws) return
      this.irc = null
      this.ircReady = false
      const delay = Math.min(30000, 1000 * 2 ** this.ircRetry++)
      setTimeout(() => this.connectChat(), delay)
    }
    ws.onerror = () => {}
    this.irc = ws
  }

  handleChatLine(line) {
    const m = line.match(/^(?:@([^ ]+) )?:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/)
    if (!m) return
    const [, rawTags, login, text] = m

    // IRC tags carry sender identity: display-name, mod flag, badges.
    const tags = {}
    if (rawTags) {
      for (const kv of rawTags.split(';')) {
        const eq = kv.indexOf('=')
        if (eq > 0) tags[kv.slice(0, eq)] = kv.slice(eq + 1)
      }
    }
    const display = tags['display-name'] || login
    const badges = tags.badges || ''
    const isMod = tags.mod === '1' || badges.includes('broadcaster/') || badges.includes('moderator/')

    // Song request command (any viewer).
    if (this.store.get('chatCommandEnabled')) {
      const cmd = String(this.store.get('chatCommand') || '!sr').trim()
      if (cmd && text.toLowerCase().startsWith(cmd.toLowerCase() + ' ')) {
        this.emit('request', { user: display, input: text.slice(cmd.length + 1).trim(), via: 'chat' })
        return
      }
    }

    // Playback commands. !song is for everyone; the rest are mods/broadcaster only.
    if (!this.store.get('modCommandsEnabled')) return
    const word = text.trim().split(/\s+/)[0].toLowerCase()
    const COMMANDS = {
      '!skip': 'skip',
      '!pause': 'pause',
      '!play': 'resume',
      '!resume': 'resume',
      '!clearqueue': 'clearqueue',
      '!song': 'song',
      '!currentsong': 'song',
      '!np': 'song',
    }
    const action = COMMANDS[word]
    if (!action) return
    if (action !== 'song' && !isMod) return // silently ignore non-mods
    this.emit('command', { cmd: action, user: display, isMod })
  }

  say(text) {
    const user = this.store.get('twitchUser')
    if (!this.irc || !this.ircReady || !user) return false
    try {
      this.irc.send(`PRIVMSG #${user.login} :${String(text).replace(/[\r\n]/g, ' ').slice(0, 450)}`)
      return true
    } catch {
      return false
    }
  }
}

module.exports = TwitchService
