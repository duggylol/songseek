// Turn raw chat/redemption text into a structured request.
export function parseRequest(text) {
  const t = (text || '').trim()
  if (!t) return null

  const spotifyUri = t.match(/spotify:track:([A-Za-z0-9]{22})/)
  if (spotifyUri) return { type: 'spotify', id: spotifyUri[1] }

  const spotifyUrl = t.match(/open\.spotify\.com\/(?:intl-[\w-]+\/)?track\/([A-Za-z0-9]{22})/)
  if (spotifyUrl) return { type: 'spotify', id: spotifyUrl[1] }

  const yt = t.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?[^\s]*?v=|shorts\/|live\/|embed\/))([\w-]{11})/
  )
  if (yt) return { type: 'youtube', id: yt[1] }

  const sc = t.match(/https?:\/\/(?:www\.|on\.|m\.)?soundcloud\.com\/[^\s]+/)
  if (sc) return { type: 'soundcloud', url: sc[0].replace(/[),.\]]+$/, '') }

  return { type: 'query', q: t }
}
