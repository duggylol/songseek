import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state/store'

const ICONS = {
  success: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M12 7v7M12 17.5v.5" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 11v6M12 7.5v.5" />
    </svg>
  ),
}

export default function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            className={`toast ${t.kind}`}
            layout
            // Slide in from off-screen right, and back out the same way.
            initial={{ opacity: 0, x: 340, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 340, scale: 0.96, transition: { duration: 0.28, ease: [0.5, 0, 0.75, 0] } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={() => dismiss(t.id)}
            title="Dismiss"
          >
            <span className="toast-ico">{ICONS[t.kind] || ICONS.info}</span>
            <span className="toast-text">{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
