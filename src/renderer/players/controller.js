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
  youtube: { player: null, ready: false, pendingId: null },
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

export function next() {
  const s = app()
  const [head, ...rest] = s.queue
  if (s.current) s.setHistory([...s.history.slice(-49), s.current])
  if (!head) {
    s.setCurrent(null)
    stopAll()
    return
  }
  s.setQueue(rest)
  s.setCurrent(head)
  playTrack(head)
}

export function prev() {
  const s = app()
  if (s.playback.positionMs > 5000 || !s.history.length) {
    seek(0)
    return
  }
  const prevTrack = s.history[s.history.length - 1]
  s.setHistory(s.history.slice(0, -1))
  if (s.current) s.setQueue([s.current, ...s.queue])
  s.setCurrent(prevTrack)
  playTrack(prevTrack)
}

export function enqueue(track) {
  const s = app()
  const item = { id: crypto.randomUUID(), ...track }
  const willAutoplay = !s.current
  s.setQueue([...s.queue, item])
  if (willAutoplay) next()
  return willAutoplay ? 0 : s.queue.length + 1
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

// ---------- playback ----------

export async function playTrack(track) {
  pauseAllExcept(track.source)
  P.active = track.source
  app().setPlayback({ playing: true, positionMs: 0, durationMs: track.durationMs || 0 })
  try {
    if (track.source === 'spotify') {
      P.spotify = { lastPos: 0, lastAt: Date.now(), playing: true }
      flushSpotifyAudio()
      setSpotifyPlaying(true)
      await resumeSpotifyAudio()
      await window.songseek.spotify.play(track.uri)
    } else if (track.source === 'youtube') {
      if (P.youtube.ready) {
        P.youtube.player.loadVideoById(track.sourceId)
        P.youtube.player.playVideo()
      } else {
        P.youtube.pendingId = track.sourceId
      }
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
  if (source !== 'youtube' && P.youtube.ready) {
    try { P.youtube.player.stopVideo() } catch {}
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
    if (s.queue.length) next()
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
  if (P.active === 'youtube' && P.youtube.ready) {
    playing ? P.youtube.player.pauseVideo() : P.youtube.player.playVideo()
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
  if (P.active === 'youtube' && P.youtube.ready) P.youtube.player.seekTo(ms / 1000, true)
  if (P.active === 'soundcloud' && P.soundcloud.widget) P.soundcloud.widget.seekTo(ms)
  app().setPlayback({ positionMs: ms })
}

export function setVolume(v) {
  P.volume = v
  setSpotifyVolume(v)
  try { P.youtube.ready && P.youtube.player.setVolume(v * 100) } catch {}
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
    if (P.active === 'spotify') ended()
  })

  setInterval(poll, 250)
}

// Mounts the YouTube player into the artwork slot (called once from NowPlaying).
export async function attachYouTube(container) {
  if (P.youtube.player || !container) return
  P.youtube.player = true // reserve
  await window.__ytReady
  const inner = document.createElement('div')
  container.appendChild(inner)
  P.youtube.player = new window.YT.Player(inner, {
    width: '100%',
    height: '100%',
    playerVars: {
      controls: 0,
      disablekb: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
      ...(location.protocol.startsWith('http') ? { origin: location.origin } : {}),
    },
    events: {
      onReady: () => {
        P.youtube.ready = true
        P.youtube.player.setVolume(P.volume * 100)
        if (P.youtube.pendingId) {
          const id = P.youtube.pendingId
          P.youtube.pendingId = null
          P.youtube.player.loadVideoById(id)
        }
      },
      onStateChange: (e) => {
        if (P.active !== 'youtube') return
        if (e.data === 0) ended()
        else if (e.data === 1) app().setPlayback({ playing: true })
        else if (e.data === 2) app().setPlayback({ playing: false })
      },
      onError: (e) => {
        if (P.active !== 'youtube') return
        const code = e && e.data
        const msg =
          code === 101 || code === 150
            ? "This video's owner doesn't allow playback outside YouTube — skipping"
            : code === 100
              ? 'YouTube video is private or deleted — skipping'
              : `YouTube playback error (${code}) — skipping`
        app().toast(msg, 'error')
        ended()
      },
    },
  })
}

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
  } else if (P.active === 'youtube' && P.youtube.ready) {
    try {
      const p = P.youtube.player
      setPlayback({
        playing: p.getPlayerState() === 1,
        positionMs: (p.getCurrentTime() || 0) * 1000,
        durationMs: (p.getDuration() || 0) * 1000,
      })
    } catch {}
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
