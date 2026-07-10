export function fmtTime(ms) {
  if (!ms || ms < 0 || !isFinite(ms)) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export const SOURCE_META = {
  spotify: { label: 'Spotify', color: '#1DB954' },
  youtube: { label: 'YouTube', color: '#FF0033' },
  soundcloud: { label: 'SoundCloud', color: '#FF5500' },
}
