import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state/store'
import { searchTracks } from '../services/spotify'
import { enqueue, playNow } from '../players/controller'
import { fmtTime, SOURCE_META } from '../utils'

export default function SearchBar() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const seqRef = useRef(0)
  const toast = useApp((s) => s.toast)

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults(null)
      setBusy(false)
      return
    }
    setBusy(true)
    const seq = ++seqRef.current
    const t = setTimeout(async () => {
      const [spotify, youtube, soundcloud] = await Promise.all([
        searchTracks(query, 4).catch(() => []),
        window.songseek.search.youtube(query).then((r) => r.slice(0, 4)).catch(() => []),
        window.songseek.search.soundcloud(query).then((r) => r.slice(0, 4)).catch(() => []),
      ])
      if (seq !== seqRef.current) return
      setResults({ spotify, youtube, soundcloud })
      setBusy(false)
      setOpen(true)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const add = (track, now = false) => {
    if (now) playNow({ ...track, requestedBy: 'You' })
    else {
      enqueue({ ...track, requestedBy: 'You' })
      toast(`Queued “${track.title}”`, 'success')
    }
    setOpen(false)
    setQ('')
  }

  const sections = ['spotify', 'youtube', 'soundcloud']
  const hasAny = results && sections.some((k) => results[k].length > 0)

  return (
    <div className="search" ref={boxRef}>
      <div className="search-input">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          placeholder="Search Spotify, YouTube & SoundCloud…"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && results) {
              const first = sections.map((k) => results[k][0]).find(Boolean)
              if (first) add(first)
            }
          }}
        />
        {busy && <span className="search-spinner" />}
      </div>

      <AnimatePresence>
        {open && results && (
          <motion.div
            className="search-results"
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            {!hasAny && <div className="search-none">No results</div>}
            {sections.map((key) =>
              results[key].length === 0 ? null : (
                <div key={key} className="search-section">
                  <div className="search-section-label" style={{ color: SOURCE_META[key].color }}>
                    {SOURCE_META[key].label}
                  </div>
                  {results[key].map((t) => (
                    <div key={`${key}-${t.sourceId}`} className="search-row" onClick={() => add(t)}>
                      {t.artwork ? <img src={t.artwork} alt="" draggable={false} /> : <div className="q-art-empty" />}
                      <div className="search-row-info">
                        <div className="q-title">{t.title}</div>
                        <div className="q-sub">{t.artist}</div>
                      </div>
                      <span className="q-time">{t.durationMs ? fmtTime(t.durationMs) : ''}</span>
                      <button
                        className="search-play"
                        title="Play now"
                        onClick={(e) => {
                          e.stopPropagation()
                          add(t, true)
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
