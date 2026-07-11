import { useApp } from '../state/store'
import {
  initSpotifyAudio,
  resumeSpotifyAudio,
  setSpotifyPlaying,
  flushSpotifyAudio,
  setSpotifyVolume,
} from '../audio/spotifyAudio'

// Unified playback engine. Exactly one of the three backends is "active":
//  - spotify:    audio streamed from the bundled go-librespot daemon (via main)
//  - youtube:    IFrame player, rendered inside the artwork slot
//  - soundcloud: hidden widget iframe (audio only)
const P = {
  spotify: { lastPos: 0, lastAt: 0, playing: false },
  youtube: { audio: null, token: 0 },
  soundcloud: { widget: null, iframe: null, playing: false },
  active: null,
  volume: 0.8,
  lastEnded: 0,
}

const app = () => useApp.getState()

function ended() {
  const now = Date.now()
  if (now - P.lastEnded < 1200) return
  P.lastEnded = now
  next()
}

// ---------- queue orchestration ----------
//
// Two tiers of playback:
//   1. requests (s.queue) — viewer/manual song requests, always take priority
//   2. playlist (s.playlist) — the user's own music, plays as a backdrop and
//      resumes automatically once the request queue drains.
// A viewer request never interrupts the current song; it waits its turn, and
// after the last request we return to the playlist where it left off.

export function next() {
  const s = app()
  if (s.current) s.setHistory([...s.history.slice(-49), s.current])

  // 1) A queued request always wins.
  if (s.queue.length) {
    const [head, ...rest] = s.queue
    s.setQueue(rest)
    s.setCurrent(head, 'request')
    playTrack(head)
    return
  }

  // 2) Otherwise continue the user's playlist (looping so music never dies).
  const pl = s.playlist
  if (pl && pl.tracks.length) {
    const nextIndex = pl.index + 1
    if (nextIndex >= pl.tracks.length && !pl.loop) {
      s.setCurrent(null, null)
      stopAll()
      return
    }
    const index = ((nextIndex % pl.tracks.length) + pl.tracks.length) % pl.tracks.length
    s.setPlaylist({ ...pl, index })
    s.setCurrent(pl.tracks[index], 'playlist')
    playTrack(pl.tracks[index])
    return
  }

  s.setCurrent(null, null)
  stopAll()
}

export function prev() {
  const s = app()
  if (s.playback.positionMs > 5000) return seek(0)
  // Step back through the playlist when that's what's playing.
  if (s.currentSource === 'playlist' && s.playlist && s.playlist.tracks.length) {
    const pl = s.playlist
    const index = (pl.index - 1 + pl.tracks.length) % pl.tracks.length
    s.setPlaylist({ ...pl, index })
    s.setCurrent(pl.tracks[index], 'playlist')
    playTrack(pl.tracks[index])
    return
  }
  seek(0)
}

// Add a viewer/manual request. It plays immediately only if nothing is playing;
// otherwise it queues behind whatever's on (including playlist backdrop).
export function enqueue(track) {
  const s = app()
  const item = { id: crypto.randomUUID(), ...track }
  const idle = !s.current
  const position = s.queue.length + 1 // 1-based spot in the request queue
  s.setQueue([...s.queue, item])
  if (idle) next()
  return idle ? 0 : position
}

export function playNow(track) {
  const s = app()
  s.setQueue([{ id: crypto.randomUUID(), ...track }, ...s.queue])
  next()
}

export function removeFromQueue(id) {
  const s = app()
  s.setQueue(s.queue.filter((t) => t.id !== id))
}

export function playFromQueue(id) {
  const s = app()
  const track = s.queue.find((t) => t.id === id)
  if (!track) return
  s.setQueue(s.queue.filter((t) => t.id !== id))
  playNow(track)
}

export function clearQueue() {
  app().setQueue([])
}

// Start (or jump within) the user's playlist backdrop. Plays immediately; any
// queued requests still take over when this track ends.
export function playPlaylist(tracks, startIndex, meta) {
  const s = app()
  if (!tracks || !tracks.length) return
  const index = Math.max(0, Math.min(startIndex || 0, tracks.length - 1))
  s.setPlaylist({ id: meta.id, name: meta.name, tracks, index, loop: true })
  s.setLibrary({ activeId: meta.id })
  s.setCurrent(tracks[index], 'playlist')
  playTrack(tracks[index])
}

export function stopPlaylist() {
  app().setPlaylist(null)
  app().setLibrary({ activeId: null })
}

// ---------- playback ----------

export async function playTrack(track) {
  pauseAllExcept(track.source)
  P.active = track.source
  app().setPlayback({ playing: true, positionMs: 0, durationMs: track.durationMs || 0 })
  try {
    if (track.source === 'spotify') {
      P.spotify = { lastPos: 0, lastAt: Date.now(), playing: true, startedAt: Date.now() }
      flushSpotifyAudio()
      setSpotifyPlaying(true)
      await resumeSpotifyAudio()
      await window.songseek.spotify.play(track.uri)
    } else if (track.source === 'youtube') {
      await playYouTube(track)
    } else if (track.source === 'soundcloud') {
      playSoundcloud(track)
    }
  } catch (e) {
    app().toast(`Couldn't play "${track.title}": ${e.message}`, 'error')
    setTimeout(ended, 400)
  }
}

function pauseAllExcept(source) {
  if (source !== 'spotify') {
    setSpotifyPlaying(false)
    window.songseek.spotify.pause()
  }
  if (source !== 'youtube' && P.youtube.audio) {
    try { P.youtube.audio.pause() } catch {}
  }
  if (source !== 'soundcloud' && P.soundcloud.widget) {
    try { P.soundcloud.widget.pause() } catch {}
  }
}

export function stopAll() {
  pauseAllExcept(null)
  window.songseek.spotify.stop()
  P.active = null
  app().setPlayback({ playing: false, positionMs: 0, durationMs: 0 })
}

export function togglePlay() {
  const s = app()
  if (!P.active) {
    next() // starts the queue or resumes the playlist; no-op when neither exists
    return
  }
  const playing = s.playback.playing
  if (P.active === 'spotify') {
    if (playing) {
      setSpotifyPlaying(false)
      window.songseek.spotify.pause()
      app().setPlayback({ playing: false })
      P.spotify.playing = false
    } else {
      setSpotifyPlaying(true)
      window.songseek.spotify.resume()
      resumeSpotifyAudio()
      app().setPlayback({ playing: true })
      P.spotify.playing = true
      P.spotify.lastAt = Date.now()
    }
  }
  if (P.active === 'youtube' && P.youtube.audio) {
    playing ? P.youtube.audio.pause() : P.youtube.audio.play().catch(() => {})
  }
  if (P.active === 'soundcloud' && P.soundcloud.widget) P.soundcloud.widget.toggle()
}

export function seek(ms) {
  if (P.active === 'spotify') {
    flushSpotifyAudio()
    window.songseek.spotify.seek(ms)
    P.spotify.lastPos = ms
    P.spotify.lastAt = Date.now()
  }
  if (P.active === 'youtube' && P.youtube.audio) { try { P.youtube.audio.currentTime = ms / 1000 } catch {} }
  if (P.active === 'soundcloud' && P.soundcloud.widget) P.soundcloud.widget.seekTo(ms)
  app().setPlayback({ positionMs: ms })
}

export function setVolume(v) {
  P.volume = v
  setSpotifyVolume(v)
  try { if (P.youtube.audio) P.youtube.audio.volume = v } catch {}
  try { P.soundcloud.widget && P.soundcloud.widget.setVolume(v * 100) } catch {}
}

// ---------- init ----------

export function initPlayers(volume) {
  P.volume = volume ?? 0.8
  initSpotifyAudio(P.volume)

  window.songseek.spotify.onPosition((p) => {
    if (P.active !== 'spotify') return
    if (typeof p.positionMs === 'number') P.spotify.lastPos = p.positionMs
    P.spotify.lastAt = Date.now()
    if (typeof p.playing === 'boolean') P.spotify.playing = p.playing
    app().setPlayback({
      positionMs: P.spotify.lastPos,
      durationMs: p.durationMs || app().playback.durationMs,
      playing: P.spotify.playing,
    })
  })
  window.songseek.spotify.onEnded(() => {
    if (P.active !== 'spotify') return
    // An "ended" arriving right after a track starts is a straggler from the
    // previous track (skip/transition race) — never advance on it.
    if (Date.now() - (P.spotify.startedAt || 0) < 2000) return
    ended()
  })

  setInterval(poll, 250)
}

// YouTube plays as a direct audio stream (resolved by yt-dlp in the main process),
// so embedding-disabled music videos — which the old IFrame player refused — work.
function ensureYtAudio() {
  if (P.youtube.audio) return P.youtube.audio
  const el = new Audio()
  el.preload = 'auto'
  el.volume = P.volume
  el.addEventListener('ended', () => { if (P.active === 'youtube') ended() })
  el.addEventListener('playing', () => { if (P.active === 'youtube') app().setPlayback({ playing: true }) })
  el.addEventListener('pause', () => { if (P.active === 'youtube' && !el.ended) app().setPlayback({ playing: false }) })
  el.addEventListener('error', () => {
    if (P.active === 'youtube' && P.youtube.audio === el && el.src) {
      app().toast('YouTube audio failed — skipping', 'error')
      ended()
    }
  })
  P.youtube.audio = el
  return el
}

async function playYouTube(track) {
  const el = ensureYtAudio()
  const token = ++P.youtube.token
  el.pause()
  try {
    const info = await window.songseek.search.resolveYoutubeStream(track.sourceId)
    if (token !== P.youtube.token || P.active !== 'youtube') return // superseded
    if (track.durationMs !== info.durationMs && info.durationMs) {
      app().setPlayback({ durationMs: info.durationMs })
    }
    el.src = info.streamUrl
    el.volume = P.volume
    await el.play()
  } catch (e) {
    if (token !== P.youtube.token) return
    app().toast(`Couldn't load "${track.title}" from YouTube — skipping`, 'error')
    ended()
  }
}

// No-op kept for NowPlaying, which still calls it; YouTube no longer needs a mount.
export async function attachYouTube() {}

function ensureScIframe() {
  if (P.soundcloud.iframe) return P.soundcloud.iframe
  const iframe = document.createElement('iframe')
  iframe.id = 'sc-embed'
  iframe.allow = 'autoplay'
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:166px;border:0;'
  document.body.appendChild(iframe)
  P.soundcloud.iframe = iframe
  return iframe
}

function playSoundcloud(track) {
  const iframe = ensureScIframe()
  iframe.src =
    'https://w.soundcloud.com/player/?' +
    new URLSearchParams({ url: track.url, auto_play: 'true', visual: 'false' })

  const bindWidget = () => {
    const widget = window.SC.Widget(iframe)
    P.soundcloud.widget = widget
    const E = window.SC.Widget.Events
    widget.bind(E.READY, () => {
      widget.setVolume(P.volume * 100)
      widget.play()
    })
    widget.bind(E.FINISH, () => P.active === 'soundcloud' && ended())
    widget.bind(E.PLAY, () => {
      P.soundcloud.playing = true
      if (P.active === 'soundcloud') app().setPlayback({ playing: true })
    })
    widget.bind(E.PAUSE, () => {
      P.soundcloud.playing = false
      if (P.active === 'soundcloud') app().setPlayback({ playing: false })
    })
    widget.bind(E.ERROR, () => {
      if (P.active === 'soundcloud') {
        app().toast('SoundCloud track failed — skipping', 'error')
        ended()
      }
    })
  }

  if (window.SC && window.SC.Widget) bindWidget()
  else {
    const t = setInterval(() => {
      if (window.SC && window.SC.Widget) {
        clearInterval(t)
        bindWidget()
      }
    }, 200)
    setTimeout(() => clearInterval(t), 10000)
  }
}

// ---------- position polling / interpolation ----------

function poll() {
  const setPlayback = app().setPlayback
  if (P.active === 'spotify') {
    if (!P.spotify.playing) return
    const pos = P.spotify.lastPos + (Date.now() - P.spotify.lastAt)
    const dur = app().playback.durationMs
    setPlayback({ positionMs: dur ? Math.min(pos, dur) : pos, playing: true })
  } else if (P.active === 'youtube' && P.youtube.audio) {
    const a = P.youtube.audio
    setPlayback({
      playing: !a.paused,
      positionMs: (a.currentTime || 0) * 1000,
      durationMs: a.duration && isFinite(a.duration) ? a.duration * 1000 : app().playback.durationMs,
    })
  } else if (P.active === 'soundcloud' && P.soundcloud.widget) {
    try {
      P.soundcloud.widget.getPosition((pos) => {
        P.soundcloud.widget.getDuration((dur) => {
          setPlayback({ positionMs: pos || 0, durationMs: dur || 0, playing: P.soundcloud.playing })
        })
      })
    } catch {}
  }
}
