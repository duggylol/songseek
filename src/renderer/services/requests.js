import { parseRequest } from './parse'
import { searchTracks, getTrack } from './spotify'
import { enqueue, next, togglePlay, clearQueue } from '../players/controller'
import { useApp, selectCurrent } from '../state/store'

// Resolve any request (link or free text) into a track.
// Free-text priority: Spotify → YouTube → SoundCloud.
export async function resolveRequest(text) {
  const p = parseRequest(text)
  if (!p) return null
  switch (p.type) {
    case 'spotify':
      return getTrack(p.id)
    case 'youtube':
      return window.songseek.search.resolveYoutube(p.id)
    case 'soundcloud':
      return window.songseek.search.resolveSoundcloud(p.url)
    case 'query': {
      try {
        const s = await searchTracks(p.q, 1)
        if (s[0]) return s[0]
      } catch {}
      try {
        const y = await window.songseek.search.youtube(p.q)
        if (y[0]) return y[0]
      } catch {}
      try {
        const sc = await window.songseek.search.soundcloud(p.q)
        if (sc[0]) return sc[0]
      } catch {}
      return null
    }
    default:
      return null
  }
}

function announce(text) {
  const s = useApp.getState()
  if (s.settings && s.settings.chatAnnounce) window.songseek.twitch.say(text)
}

// Entry point for Twitch redemptions / chat commands / the "simulate" box.
export async function handleIncomingRequest({ user, input }) {
  const s = useApp.getState()
  if (!input) {
    announce(`@${user} include a song name or link with your request!`)
    return
  }
  let track = null
  try {
    track = await resolveRequest(input)
  } catch (e) {
    console.error('request resolve failed:', e)
  }
  if (!track) {
    s.toast(`Couldn't find "${input}" (requested by ${user})`, 'error')
    announce(`@${user} sorry, couldn't find "${input}" on Spotify, YouTube or SoundCloud.`)
    return
  }
  const r = await enqueue({ ...track, requestedBy: user })
  const label = `${track.title} — ${track.artist}`

  if (r.status === 'error') {
    s.toast(`Couldn't queue “${track.title}”: ${r.error}`, 'error')
    announce(`@${user} couldn't queue "${track.title}" — ${r.error}`)
    return
  }
  if (r.status === 'rate-limited') {
    s.toast(`${user} requested “${track.title}” — Spotify is busy, queueing shortly`, 'info')
    announce(`@${user} "${label}" is queued (#${r.position}) — Spotify is rate limiting us, it'll go in shortly.`)
    return
  }
  if (r.status === 'no-device') {
    // Kept in SongSeek's list; it goes to Spotify the moment playback starts.
    s.toast(`${user} requested “${track.title}” — start playing in Spotify to queue it`, 'error')
    announce(`@${user} "${label}" is saved (#${r.position}) — it'll queue once the stream's Spotify is playing.`)
    return
  }
  s.toast(`${user} queued “${track.title}”`, 'success')
  announce(`@${user} added "${label}" to the queue (#${r.position})`)
}

// Mod/viewer chat commands (!skip, !pause, !play, !clearqueue; !song for everyone).
// Mod-gating happens in the main process from IRC badges — anything arriving
// here is already authorized. Per-command cooldown stops chat spam.
const cmdLastRun = {}

export function handleChatCommand({ cmd, user }) {
  const now = Date.now()
  if (now - (cmdLastRun[cmd] || 0) < 3000) return
  cmdLastRun[cmd] = now

  const s = useApp.getState()
  const cur = selectCurrent(s)
  switch (cmd) {
    case 'skip': {
      if (!cur) return
      next()
      s.toast(`${user} skipped “${cur.title}” via chat`, 'info')
      announce(`@${user} skipped "${cur.title}"`)
      break
    }
    case 'pause': {
      if (!s.playback.playing) return
      togglePlay()
      s.toast(`${user} paused via chat`, 'info')
      announce(`@${user} paused playback`)
      break
    }
    case 'resume': {
      if (s.playback.playing) return
      togglePlay()
      s.toast(`${user} resumed via chat`, 'info')
      announce(`@${user} resumed playback`)
      break
    }
    case 'clearqueue': {
      if (!s.queue.length) return
      const n = s.queue.length
      clearQueue()
      s.toast(`${user} cleared ${n} request${n === 1 ? '' : 's'} via chat`, 'info')
      announce(`@${user} cleared the pending requests (${n} song${n === 1 ? '' : 's'})`)
      break
    }
    case 'song': {
      // A viewer asked — always answer, regardless of the announce setting.
      window.songseek.twitch.say(
        cur
          ? `Now playing: ${cur.title} — ${cur.artist}${cur.requestedBy ? ` (requested by ${cur.requestedBy})` : ''}`
          : 'Nothing is playing right now.'
      )
      if (cur) window.songseek.overlay.show().catch(() => {}) // replay the OBS animation
      break
    }
  }
}
