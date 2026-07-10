import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state/store'
import { attachYouTube, togglePlay, next, prev, seek, setVolume } from '../players/controller'
import { fmtTime, SOURCE_META } from '../utils'

function ProgressBar() {
  const playback = useApp((s) => s.playback)
  const barRef = useRef(null)
  const [dragPos, setDragPos] = useState(null)

  const duration = playback.durationMs || 0
  const position = dragPos != null ? dragPos : Math.min(playback.positionMs, duration)
  const pct = duration ? (position / duration) * 100 : 0

  const posFromEvent = (e) => {
    const rect = barRef.current.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const onPointerDown = (e) => {
    if (!duration) return
    barRef.current.setPointerCapture(e.pointerId)
    setDragPos(posFromEvent(e))
  }
  const onPointerMove = (e) => {
    if (dragPos == null) return
    setDragPos(posFromEvent(e))
  }
  const onPointerUp = (e) => {
    if (dragPos == null) return
    seek(posFromEvent(e))
    setDragPos(null)
  }

  return (
    <div className="progress-row">
      <span className="time">{fmtTime(position)}</span>
      <div
        ref={barRef}
        className={`progress ${dragPos != null ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
          <div className="progress-thumb" style={{ left: `${pct}%` }} />
        </div>
      </div>
      <span className="time">{fmtTime(duration)}</span>
    </div>
  )
}

function Controls() {
  const playing = useApp((s) => s.playback.playing)
  const hasTrack = useApp((s) => !!s.current || s.queue.length > 0)
  const settings = useApp((s) => s.settings)
  const patchSettings = useApp((s) => s.patchSettings)
  const volume = (settings && settings.volume) ?? 0.8

  return (
    <div className="controls-row">
      <div className="controls-spacer" />
      <div className="controls">
        <motion.button className="ctrl" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={prev} title="Previous">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 5h2.2v14H6zM20 5v14L9.5 12z" />
          </svg>
        </motion.button>
        <motion.button
          className={`ctrl play ${!hasTrack ? 'disabled' : ''}`}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.9 }}
          onClick={togglePlay}
          title={playing ? 'Pause' : 'Play'}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={playing ? 'pause' : 'play'}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.12 }}
            >
              {playing ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 4h3.6v16H7zM13.4 4H17v16h-3.6z" />
                </svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}>
                  <path d="M7 4l13 8-13 8z" />
                </svg>
              )}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <motion.button className="ctrl" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={next} title="Skip">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.8 5H18v14h-2.2zM4 5l10.5 7L4 19z" />
          </svg>
        </motion.button>
      </div>
      <div className="volume">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.4 6a9 9 0 0 1 0 12" strokeLinecap="round" />
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setVolume(v)
            patchSettings({ volume: v })
          }}
        />
      </div>
    </div>
  )
}

export default function NowPlaying() {
  const current = useApp((s) => s.current)
  const ytRef = useRef(null)

  useEffect(() => {
    attachYouTube(ytRef.current)
  }, [])

  const isYt = current && current.source === 'youtube'
  const meta = current && SOURCE_META[current.source]

  return (
    <div className="now-playing">
      <div className="artwork">
        <AnimatePresence mode="popLayout">
          {current && !isYt && current.artwork && (
            <motion.img
              key={current.id}
              src={current.artwork}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          {!current && (
            <motion.div
              key="empty"
              className="artwork-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".35">
                <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>
        <div className={`yt-slot ${isYt ? 'visible' : ''}`} ref={ytRef} />
      </div>

      <div className="track-info">
        <AnimatePresence mode="wait">
          <motion.div
            key={current ? current.id : 'none'}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <h1 className="track-title" title={current ? current.title : ''}>
              {current ? current.title : 'Nothing playing'}
            </h1>
            <p className="track-artist">
              {current ? current.artist : 'Queue a song or wait for a request'}
            </p>
            {current && (
              <div className="track-meta">
                <span className="source-badge" style={{ '--src': meta.color }}>
                  {meta.label}
                </span>
                {current.requestedBy && (
                  <span className="requester">requested by {current.requestedBy}</span>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <ProgressBar />
      <Controls />
    </div>
  )
}
