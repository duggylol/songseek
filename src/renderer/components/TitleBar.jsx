import React from 'react'
import { useApp } from '../state/store'

const isMac = window.songseek.platform === 'darwin'

function StatusPill({ label, ok, onClick }) {
  return (
    <button className="pill no-drag" onClick={onClick} title={`${label}: ${ok ? 'connected' : 'not connected'}`}>
      <span className={`dot ${ok ? 'ok' : ''}`} />
      {label}
    </button>
  )
}

export default function TitleBar() {
  const spotify = useApp((s) => s.spotify)
  const twitch = useApp((s) => s.twitch)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)

  return (
    <header className={`titlebar ${isMac ? 'mac' : ''}`}>
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" opacity=".5" />
          <path d="M9 15.5V8l7-1.6v7.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7.6" cy="15.6" r="1.7" fill="currentColor" />
          <circle cx="14.6" cy="13.9" r="1.7" fill="currentColor" />
        </svg>
        SongSeek
      </div>
      <div className="titlebar-right">
        <StatusPill label="Spotify" ok={spotify.connected && spotify.deviceReady} onClick={() => setSettingsOpen(true)} />
        <StatusPill label="Twitch" ok={twitch.connected} onClick={() => setSettingsOpen(true)} />
        <button className="icon-btn no-drag" onClick={() => setSettingsOpen(true)} title="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
          </svg>
        </button>
        {!isMac && (
          <div className="win-controls no-drag">
            <button onClick={() => window.songseek.win.minimize()} title="Minimize">
              <svg width="11" height="11" viewBox="0 0 11 11"><line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" /></svg>
            </button>
            <button onClick={() => window.songseek.win.maximize()} title="Maximize">
              <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" /></svg>
            </button>
            <button className="close" onClick={() => window.songseek.win.close()} title="Close">
              <svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" /></svg>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
