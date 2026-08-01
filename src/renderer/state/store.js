import { create } from 'zustand'

const emptySpotify = {
  connected: false,
  user: null,
  needsReconnect: false,
  hasDevice: false,
  isPlaying: false,
  progressMs: 0,
  durationMs: 0,
  volumePercent: null,
  deviceName: null,
  deviceId: null,
  supportsVolume: false,
  track: null,
  error: null,
}

export const useApp = create((set) => ({
  settings: null,
  queue: [], // SongSeek's pending requests (removable/reorderable)
  spotifyQueue: [], // what Spotify says is coming up (display only)
  local: { track: null, playing: false }, // YouTube/SoundCloud playing inside SongSeek
  playback: { playing: false, positionMs: 0, durationMs: 0 },
  spotify: { ...emptySpotify },
  library: { connected: false, playlists: [], loading: false, activeId: null },
  twitch: { connected: false, user: null, deviceCode: null, error: null },
  toasts: [],
  settingsOpen: false,

  setSettings: (settings) => set({ settings }),
  patchSettings: async (patch) => {
    const settings = await window.songseek.settings.set(patch)
    set({ settings })
  },
  setQueue: (queue) => {
    set({ queue })
    window.songseek.settings.set({ queue })
  },
  setSpotifyQueue: (spotifyQueue) => set({ spotifyQueue }),
  setLocal: (local) => set({ local }),
  setPlayback: (p) => set((s) => ({ playback: { ...s.playback, ...p } })),
  setSpotify: (p) => set((s) => ({ spotify: { ...s.spotify, ...p } })),
  setLibrary: (p) => set((s) => ({ library: { ...s.library, ...p } })),
  setTwitch: (p) => set((s) => ({ twitch: { ...s.twitch, ...p } })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  toast: (text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2)
    // Errors linger longer — they usually need reading.
    const ms = kind === 'error' ? 9000 : 5000
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
  },
}))

// What's on right now: a local YouTube/SoundCloud clip takes over the display
// while it plays; otherwise it's whatever Spotify is playing.
export const selectCurrent = (s) => s.local.track || s.spotify.track || null
export const selectIsLocal = (s) => !!s.local.track
