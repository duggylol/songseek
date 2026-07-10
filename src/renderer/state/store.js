import { create } from 'zustand'

export const useApp = create((set) => ({
  settings: null,
  queue: [],
  history: [],
  current: null,
  playback: { playing: false, positionMs: 0, durationMs: 0 },
  spotify: { connected: false, user: null, deviceReady: false },
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
  setCurrent: (current) => set({ current }),
  setHistory: (history) => set({ history }),
  setPlayback: (p) => set((s) => ({ playback: { ...s.playback, ...p } })),
  setSpotify: (p) => set((s) => ({ spotify: { ...s.spotify, ...p } })),
  setTwitch: (p) => set((s) => ({ twitch: { ...s.twitch, ...p } })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toast: (text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, kind }] }))
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      5000
    )
  },
}))
