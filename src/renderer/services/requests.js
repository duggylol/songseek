import { parseRequest } from './parse'
import { searchTracks, getTrack } from './spotify'
import { enqueue } from '../players/controller'
import { useApp } from '../state/store'

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
  const pos = enqueue({ ...track, requestedBy: user })
  s.toast(`${user} queued “${track.title}”`, 'success')
  announce(
    pos === 0
      ? `@${user} now playing: "${track.title} — ${track.artist}"`
      : `@${user} added "${track.title} — ${track.artist}" to the queue (#${pos})`
  )
}
