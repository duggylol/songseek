import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state/store'
import { removeFromQueue, playFromQueue, clearQueue } from '../players/controller'
import { fmtTime, SOURCE_META } from '../utils'

function QueueItem({ track, index }) {
  const meta = SOURCE_META[track.source]
  return (
    <motion.div
      layout
      className="q-item"
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <span className="q-index">{index + 1}</span>
      <div className="q-art">
        {track.artwork ? <img src={track.artwork} alt="" draggable={false} /> : <div className="q-art-empty" />}
        <span className="q-source-dot" style={{ background: meta.color }} title={meta.label} />
      </div>
      <div className="q-info">
        <div className="q-title" title={track.title}>{track.title}</div>
        <div className="q-sub">
          {track.artist}
          {track.requestedBy ? ` · ${track.requestedBy}` : ''}
        </div>
      </div>
      <div className="q-right">
        <span className="q-time">{track.durationMs ? fmtTime(track.durationMs) : ''}</span>
        <div className="q-actions">
          <button title="Play now" onClick={() => playFromQueue(track.id)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>
          </button>
          <button title="Remove" onClick={() => removeFromQueue(track.id)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>
      </div>
    </motion.div>
  )
}

export default function QueuePanel() {
  const queue = useApp((s) => s.queue)

  return (
    <aside className="queue-panel">
      <div className="queue-header">
        <h2>
          Up Next {queue.length > 0 && <span className="count">{queue.length}</span>}
        </h2>
        {queue.length > 0 && (
          <button className="link-btn" onClick={clearQueue}>
            Clear
          </button>
        )}
      </div>
      <div className="queue-list">
        <AnimatePresence initial={false}>
          {queue.map((t, i) => (
            <QueueItem key={t.id} track={t} index={i} />
          ))}
        </AnimatePresence>
        {queue.length === 0 && (
          <div className="queue-empty">
            <p>Queue is empty</p>
            <span>Waiting for song requests…</span>
          </div>
        )}
      </div>
    </aside>
  )
}
