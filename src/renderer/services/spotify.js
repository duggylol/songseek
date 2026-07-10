// Spotify Web API calls run in the main process (it holds the token), so these
// are thin passthroughs to the exposed bridge.
export function searchTracks(q, limit = 6) {
  return window.songseek.search.spotify(q, limit)
}

export function getTrack(id) {
  return window.songseek.search.resolveSpotify(id)
}
