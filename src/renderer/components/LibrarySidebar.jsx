import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state/store'
import { playPlaylist, stopPlaylist } from '../players/controller'

// Loads the user's playlists into the store. Exported so App can call it on boot.
export async function loadPlaylists() {
  const st = useApp.getState()
  st.setLibrary({ loading: true })
  try {
    const playlists = await window.songseek.library.playlists()
    st.setLibrary({ playlists, loading: false, connected: true })
  } catch (e) {
    st.setLibrary({ loading: false })
    st.toast(e.message.replace(/^Error invoking .*?: /, ''), 'error')
  }
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    // Deterministic-enough shuffle without Math.random dependency concerns.
    const j = Math.floor((Date.now() * (i + 7)) % (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function LikedIcon() {
  return (
    <div className="pl-art liked">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
        <path d="M12 21s-7.5-4.9-10-9.2C.5 8.3 2.3 5 5.5 5c2 0 3.3 1.2 4.5 2.6C11.2 6.2 12.5 5 14.5 5 17.7 5 19.5 8.3 22 11.8 19.5 16.1 12 21 12 21z" />
      </svg>
    </div>
  )
}

export default function LibrarySidebar() {
  const library = useApp((s) => s.library)
  const playlistState = useApp((s) => s.playlist)
  const currentSource = useApp((s) => s.currentSource)
  const setLibrary = useApp((s) => s.setLibrary)
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const [loadingId, setLoadingId] = useState(null)
  const [shuffleOn, setShuffleOn] = useState(true)

  const connect = async () => {
    setBusy(true)
    try {
      const st = await window.songseek.library.connect()
      setLibrary({ connected: st.connected })
      if (st.connected) {
        toast('Spotify library connected', 'success')
        loadPlaylists()
      }
    } catch (e) {
      toast(e.message.replace(/^Error invoking .*?: /, ''), 'error')
    }
    setBusy(false)
  }

  const play = async (pl) => {
    setLoadingId(pl.id)
    try {
      const tracks = await window.songseek.library.tracks(pl.id)
      if (!tracks.length) {
        toast(`"${pl.name}" has no playable tracks`, 'error')
      } else {
        playPlaylist(shuffleOn ? shuffle(tracks) : tracks, 0, { id: pl.id, name: pl.name })
      }
    } catch (e) {
      toast(e.message.replace(/^Error invoking .*?: /, ''), 'error')
    }
    setLoadingId(null)
  }

  return (
    <aside className="library">
      <div className="library-header">
        <h2>Your Library</h2>
        {library.connected && (
          <button
            className={`shuffle-toggle ${shuffleOn ? 'on' : ''}`}
            title={shuffleOn ? 'Shuffle on' : 'Shuffle off'}
            onClick={() => setShuffleOn((v) => !v)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
          </button>
        )}
      </div>

      {!library.connected ? (
        <div className="library-connect">
          <p>See your playlists and liked songs here, and play them straight from SongSeek.</p>
          <button className="btn" disabled={busy} onClick={connect}>
            {busy ? 'Waiting for browser…' : 'Connect your library'}
          </button>
        </div>
      ) : (
        <div className="library-list">
          {library.loading && !library.playlists.length && <div className="library-hint">Loading…</div>}
          {library.playlists.map((pl) => {
            const active = playlistState && playlistState.id === pl.id
            return (
              <button
                key={pl.id}
                className={`pl-item ${active ? 'active' : ''}`}
                onClick={() => play(pl)}
              >
                {pl.kind === 'liked' ? (
                  <LikedIcon />
                ) : pl.artwork ? (
                  <img className="pl-art" src={pl.artwork} alt="" draggable={false} />
                ) : (
                  <div className="pl-art empty" />
                )}
                <div className="pl-info">
                  <div className="pl-name">{pl.name}</div>
                  <div className="pl-sub">
                    {pl.kind === 'liked'
                      ? 'Liked Songs'
                      : `Playlist${pl.trackCount != null ? ` · ${pl.trackCount}` : ''}`}
                  </div>
                </div>
                {loadingId === pl.id ? (
                  <span className="search-spinner" />
                ) : active && currentSource === 'playlist' ? (
                  <span className="pl-eq"><i /><i /><i /></span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {playlistState && (
          <motion.div
            className="library-footer"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <div className="lf-text">
              <span className="lf-label">Backdrop</span>
              <span className="lf-name">{playlistState.name}</span>
            </div>
            <button className="lf-stop" title="Stop playlist" onClick={stopPlaylist}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}
