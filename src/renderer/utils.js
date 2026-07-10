export function fmtTime(ms) {
  if (!ms || ms < 0 || !isFinite(ms)) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const SOURCE_META_MAP = {
  spotify: { label: 'Spotify', color: '#1DB954' },
  youtube: { label: 'YouTube', color: '#FF0033' },
  soundcloud: { label: 'SoundCloud', color: '#FF5500' },
}
const UNKNOWN_META = { label: 'Track', color: '#8b7bff' }

// Always returns a meta object, even for a missing/unknown source, so a stray
// track can never crash the render.
export const SOURCE_META = new Proxy(SOURCE_META_MAP, {
  get: (target, key) => target[key] || UNKNOWN_META,
})
