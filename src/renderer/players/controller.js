import { useApp } from '../state/store'

// SongSeek is a REMOTE CONTROL for the user's own Spotify app — it never plays
// Spotify audio itself. Requests are held here (so they can be removed/reordered)
// and handed to Spotify's native queue ONE AT A TIME, which makes them play next
// and then return to whatever playlist/album was already playing.
//
// YouTube / SoundCloud can't go in Spotify's queue, so those still play inside
// SongSeek: at the next Spotify track boundary we pause Spotify, play the clip,
// then resume Spotify.

const P = {
  yt: { audio: null, token: 0 },
  sc: { widget: null, iframe: null, playing: false },
  local: { track: null, playing: false }, // YT/SC currently playing in-app
  pushedUri: null, // request currently handed to Spotify
  lastSpotifyUri: undefined,
  volume: 0.8,
  resumeSpotifyAfterLocal: false,
  starting: false,
}

const app = () => useApp.getState()

// All Spotify remote calls go through here so tests can swap in a fake remote
// (the real bridge object is frozen by contextBridge).
let remoteOverride = null
const SP = () => remoteOverride || window.songseek.spotify
export function __setRemoteForTest(r) {
  remoteOverride = r
}

// ---------- request queue (SongSeek-owned) ----------

// Returns what ACTUALLY happened so chat isn't told "queued!" when Spotify
// never accepted it (e.g. Spotify open but idle = no active device).
export async function enqueue(track) {
  const s = app()
  const item = { id: crypto.randomUUID(), ...track }
  s.setQueue([...s.queue, item])
  const position = s.queue.length + 1
  const res = await reconcile()
  return { position, ...res }
}

export function removeFromQueue(id) {
  const s = app()
  const item = s.queue.find((t) => t.id === id)
  // The on-deck song already lives in Spotify's queue and can't be pulled back
  // (Spotify has no remove-from-queue API) — skipping is the only way past it.
  if (item && item.uri && item.uri === P.pushedUri) {
    s.toast('That song is already queued in Spotify — use skip to pass it.', 'error')
    return
  }
  s.setQueue(s.queue.filter((t) => t.id !== id))
}

export function clearQueue() {
  const s = app()
  const kept = s.queue.filter((t) => t.uri && t.uri === P.pushedUri)
  s.setQueue(kept)
}

// "Play now" = queue it then skip, so the user's context is preserved.
export async function playNow(track) {
  const s = app()
  try {
    if (track.source === 'spotify') {
      await SP().addToQueue(track.uri)
      await SP().next()
    } else {
      s.setQueue([{ id: crypto.randomUUID(), ...track }, ...s.queue])
      await startLocal(s.queue[0] || { id: 'tmp', ...track })
    }
  } catch (e) {
    s.toast(friendly(e), 'error')
  }
}

export async function playFromQueue(id) {
  const s = app()
  const track = s.queue.find((t) => t.id === id)
  if (!track) return
  if (track.source === 'spotify') {
    if (track.uri === P.pushedUri) return SP().next().catch(() => {})
    s.setQueue([track, ...s.queue.filter((t) => t.id !== id)])
    try {
      await SP().addToQueue(track.uri)
      await SP().next()
      s.setQueue(app().queue.filter((t) => t.id !== id))
    } catch (e) {
      s.toast(friendly(e), 'error')
    }
  } else {
    s.setQueue([track, ...s.queue.filter((t) => t.id !== id)])
    startLocal(track)
  }
}

// ---------- transport (delegates to Spotify, or the local clip) ----------

export function next() {
  if (P.local.playing) return endLocal()
  SP().next().catch((e) => app().toast(friendly(e), 'error'))
}

export function prev() {
  if (P.local.playing) return
  SP().previous().catch((e) => app().toast(friendly(e), 'error'))
}

export function togglePlay() {
  const s = app()
  // While a YouTube/SoundCloud clip owns the airwaves, play/pause targets it.
  if (P.local.track) {
    const el = P.yt.audio
    if (el && P.local.track.source === 'youtube') {
      el.paused ? el.play().catch(() => {}) : el.pause()
      return
    }
    if (P.sc.widget) return P.sc.widget.toggle()
  }
  const playing = s.playback.playing
  const call = playing ? SP().pause() : SP().resume()
  call.catch((e) => s.toast(friendly(e), 'error'))
}

export function seek(ms) {
  if (P.local.playing) {
    if (P.yt.audio && P.local.track && P.local.track.source === 'youtube') {
      try { P.yt.audio.currentTime = ms / 1000 } catch {}
    } else if (P.sc.widget) {
      P.sc.widget.seekTo(ms)
    }
    app().setPlayback({ positionMs: ms })
    return
  }
  SP().seek(ms).catch(() => {})
  app().setPlayback({ positionMs: ms })
}

export function setVolume(v) {
  P.volume = v
  try { if (P.yt.audio) P.yt.audio.volume = v } catch {}
  try { if (P.sc.widget) P.sc.widget.setVolume(v * 100) } catch {}
  // Spotify device volume (ignored by devices that don't support it).
  SP().setVolume(Math.round(v * 100)).catch(() => {})
}

// ---------- playlists (start them on Spotify) ----------

export async function playPlaylist(tracks, startIndex, meta) {
  const s = app()
  try {
    if (meta.uri) {
      await SP().playContext({ contextUri: meta.uri, offset: startIndex || 0 })
    } else {
      // Liked Songs has no context URI — send a batch of track URIs instead.
      const uris = tracks.slice(0, 100).map((t) => t.uri).filter(Boolean)
      await SP().playContext({ uris })
    }
    s.setLibrary({ activeId: meta.id })
    s.toast(`Playing “${meta.name}” on Spotify`, 'success')
  } catch (e) {
    s.toast(friendly(e), 'error')
  }
}

export function stopPlaylist() {
  app().setLibrary({ activeId: null })
}

// ---------- local (YouTube / SoundCloud) playback ----------

function ensureYtAudio() {
  if (P.yt.audio) return P.yt.audio
  const el = new Audio()
  el.preload = 'auto'
  el.volume = P.volume
  el.addEventListener('ended', () => P.local.playing && endLocal())
  el.addEventListener('playing', () => app().setPlayback({ playing: true }))
  el.addEventListener('pause', () => {
    if (P.local.playing && !el.ended) app().setPlayback({ playing: false })
  })
  el.addEventListener('error', () => {
    if (P.local.playing && el.src) {
      app().toast('YouTube audio failed — skipping', 'error')
      endLocal()
    }
  })
  P.yt.audio = el
  return el
}

function ensureScIframe() {
  if (P.sc.iframe) return P.sc.iframe
  const iframe = document.createElement('iframe')
  iframe.allow = 'autoplay'
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:166px;border:0;'
  document.body.appendChild(iframe)
  P.sc.iframe = iframe
  return iframe
}

async function startLocal(track) {
  if (P.starting) return
  P.starting = true
  const s = app()
  try {
    // Take over the airwaves: pause Spotify while the clip plays.
    const wasPlaying = s.spotify.isPlaying
    if (wasPlaying) {
      try { await SP().pause() } catch {}
    }
    P.resumeSpotifyAfterLocal = wasPlaying
    P.local = { track, playing: true }
    s.setLocal({ track, playing: true })
    s.setPlayback({ playing: true, positionMs: 0, durationMs: track.durationMs || 0 })
    // It's on now, not pending — drop it from the request list immediately.
    s.setQueue(s.queue.filter((t) => t.id !== track.id))
    pushOverlay(track)

    if (track.source === 'youtube') {
      const el = ensureYtAudio()
      const token = ++P.yt.token
      const info = await window.songseek.search.resolveYoutubeStream(track.sourceId)
      if (token !== P.yt.token) return
      el.src = info.streamUrl
      el.volume = P.volume
      if (info.durationMs) s.setPlayback({ durationMs: info.durationMs })
      await el.play()
    } else {
      playSoundcloud(track)
    }
  } catch (e) {
    app().toast(`Couldn't play "${track.title}" — skipping`, 'error')
    app().setQueue(app().queue.filter((t) => t.id !== track.id))
    endLocal()
  } finally {
    P.starting = false
  }
}

function endLocal() {
  const s = app()
  try { P.yt.audio && P.yt.audio.pause() } catch {}
  try { P.sc.widget && P.sc.widget.pause() } catch {}
  P.local = { track: null, playing: false }
  P.sc.playing = false
  s.setLocal({ track: null, playing: false })
  if (P.resumeSpotifyAfterLocal) {
    P.resumeSpotifyAfterLocal = false
    SP().resume().catch(() => {})
  }
  // Let the reconcile loop pick up whatever is next.
  setTimeout(reconcile, 300)
}

function playSoundcloud(track) {
  const iframe = ensureScIframe()
  iframe.src =
    'https://w.soundcloud.com/player/?' +
    new URLSearchParams({ url: track.url, auto_play: 'true', visual: 'false' })
  const bind = () => {
    const widget = window.SC.Widget(iframe)
    P.sc.widget = widget
    const E = window.SC.Widget.Events
    widget.bind(E.READY, () => {
      widget.setVolume(P.volume * 100)
      widget.play()
    })
    widget.bind(E.FINISH, () => P.local.playing && endLocal())
    widget.bind(E.PLAY, () => {
      P.sc.playing = true
      if (P.local.playing) app().setPlayback({ playing: true })
    })
    widget.bind(E.PAUSE, () => {
      P.sc.playing = false
      if (P.local.playing) app().setPlayback({ playing: false })
    })
    widget.bind(E.ERROR, () => P.local.playing && endLocal())
  }
  if (window.SC && window.SC.Widget) bind()
  else {
    const t = setInterval(() => {
      if (window.SC && window.SC.Widget) { clearInterval(t); bind() }
    }, 200)
    setTimeout(() => clearInterval(t), 10000)
  }
}

// ---------- reconciliation with Spotify's real state ----------

// Hand the next request to Spotify (one at a time) or start a local clip.
// Resolves with what happened, so callers can report it truthfully.
async function reconcile() {
  const s = app()
  if (P.local.playing || P.starting) return { status: 'busy' }
  const head = s.queue[0]
  if (!head) return { status: 'empty' }
  if (!s.spotify.hasDevice) return { status: 'no-device' } // Spotify idle/closed
  if (head.source !== 'spotify') return { status: 'local-pending' } // waits for a track boundary
  if (P.pushedUri) return { status: 'waiting' } // one already on deck

  P.pushedUri = head.uri
  try {
    await SP().addToQueue(head.uri)
    return { status: 'pushed' }
  } catch (e) {
    P.pushedUri = null
    const error = friendly(e)
    s.toast(error, 'error')
    return { status: 'error', error }
  }
}

export function onSpotifyState(state) {
  const s = app()
  s.setSpotify(state)

  const uri = state.track && state.track.uri
  const boundary = P.lastSpotifyUri !== undefined && uri !== P.lastSpotifyUri
  P.lastSpotifyUri = uri

  // Our on-deck request started playing → it's no longer pending.
  if (P.pushedUri && uri === P.pushedUri) {
    P.pushedUri = null
    s.setQueue(s.queue.filter((t) => t.uri !== uri))
  }

  if (!P.local.playing) {
    // Mirror Spotify into the app's playback display.
    s.setPlayback({
      playing: state.isPlaying,
      positionMs: state.progressMs,
      durationMs: state.durationMs,
    })
    if (boundary && uri) pushOverlay(state.track)
    // A queued YouTube/SoundCloud clip gets its turn at a track boundary.
    const head = app().queue[0]
    if (boundary && head && head.source !== 'spotify') {
      startLocal(head)
      return
    }
  }
  reconcile()
}

// Spotify's own upcoming queue (for display) + reconciliation of the on-deck song.
export function onSpotifyQueue(list) {
  const s = app()
  s.setSpotifyQueue(list)
  if (!P.pushedUri) return
  const stillQueued = list.some((t) => t.uri === P.pushedUri)
  const nowPlaying = s.spotify.track && s.spotify.track.uri === P.pushedUri
  if (!stillQueued && !nowPlaying) {
    // It was played or skipped past — release the slot so the next one goes in.
    const gone = P.pushedUri
    P.pushedUri = null
    s.setQueue(s.queue.filter((t) => t.uri !== gone))
    reconcile()
  }
}

function pushOverlay(track) {
  if (!track) return
  window.songseek.overlay
    .update({
      title: track.title,
      artist: track.artist,
      artwork: track.artwork || '',
      requestedBy: track.requestedBy && track.requestedBy !== 'You' ? track.requestedBy : null,
    })
    .catch(() => {})
}

function friendly(e) {
  const m = String((e && e.message) || e).replace(/^Error invoking .*?: /, '')
  if (/no active spotify device/i.test(m)) return 'Open Spotify and start playing something first.'
  if (/premium/i.test(m)) return 'Spotify Premium is required to control playback.'
  if (/reconnect/i.test(m)) return 'Reconnect Spotify in Settings to allow playback control.'
  return m
}

// ---------- init ----------

export function initPlayers(volume) {
  P.volume = volume ?? 0.8
  SP().onState(onSpotifyState)
  SP().onQueue(onSpotifyQueue)

  // Smooth progress between the 2s state polls.
  setInterval(() => {
    const s = app()
    if (P.local.playing) {
      const el = P.yt.audio
      if (P.local.track && P.local.track.source === 'youtube' && el) {
        s.setPlayback({
          playing: !el.paused,
          positionMs: (el.currentTime || 0) * 1000,
          durationMs: el.duration && isFinite(el.duration) ? el.duration * 1000 : s.playback.durationMs,
        })
      } else if (P.sc.widget) {
        try {
          P.sc.widget.getPosition((pos) => s.setPlayback({ positionMs: pos || 0, playing: P.sc.playing }))
        } catch {}
      }
      return
    }
    if (s.playback.playing && s.playback.durationMs) {
      s.setPlayback({
        positionMs: Math.min(s.playback.positionMs + 250, s.playback.durationMs),
      })
    }
  }, 250)
}

// Kept for compatibility with NowPlaying's mount effect.
export async function attachYouTube() {}
export function stopAll() {}
