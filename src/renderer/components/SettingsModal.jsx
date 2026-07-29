import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../state/store'
import { handleIncomingRequest } from '../services/requests'

function TextField({ label, value, onSave, placeholder, hint }) {
  const [v, setV] = useState(value || '')
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (value || '') && onSave(v.trim())}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
      />
      {hint && <em className="hint">{hint}</em>}
    </label>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label}
    </label>
  )
}

function Ext({ href, children }) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        window.songseek.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

function UpdateSection() {
  const [u, setU] = useState({ currentVersion: '', status: 'idle', supported: false })
  const toast = useApp((s) => s.toast)

  useEffect(() => {
    window.songseek.update.state().then(setU)
    return window.songseek.update.onState(setU)
  }, [])

  const line = () => {
    switch (u.status) {
      case 'checking': return 'Checking for updates…'
      case 'downloading': return `Downloading update ${u.version || ''} — ${u.percent || 0}%`
      case 'ready': return `Update ${u.version} ready — it installs when you close SongSeek`
      case 'current': return "You're on the latest version"
      case 'error': return `Update check failed: ${u.error}`
      case 'unsupported': return 'Automatic updates run on Windows; on macOS download new versions manually'
      default: return 'Updates install automatically in the background'
    }
  }

  return (
    <section>
      <h3>About &amp; updates</h3>
      <div className="version-row">
        <span className="version-badge">SongSeek v{u.currentVersion || '—'}</span>
        <span className={`status ${u.status === 'error' ? 'err' : u.status === 'ready' ? 'ok' : ''}`}>{line()}</span>
      </div>
      {u.status === 'downloading' && (
        <div className="progress-bar"><span style={{ width: `${u.percent || 0}%` }} /></div>
      )}
      <div className="connect-row">
        {u.status === 'ready' ? (
          <button className="btn" onClick={() => window.songseek.update.install()}>
            Restart &amp; install now
          </button>
        ) : (
          <button
            className="btn subtle"
            disabled={!u.supported || u.status === 'checking' || u.status === 'downloading'}
            onClick={async () => {
              await window.songseek.update.check()
              toast('Checking for updates…', 'info')
            }}
          >
            Check for updates
          </button>
        )}
        <Ext href="https://github.com/duggylol/songseek/releases">Release notes</Ext>
      </div>
    </section>
  )
}

export default function SettingsModal() {
  const settings = useApp((s) => s.settings) || {}
  const patchSettings = useApp((s) => s.patchSettings)
  const spotify = useApp((s) => s.spotify)
  const twitch = useApp((s) => s.twitch)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const setSpotify = useApp((s) => s.setSpotify)
  const setTwitch = useApp((s) => s.setTwitch)
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState('')
  const [sim, setSim] = useState('')
  const [overlayUrl, setOverlayUrl] = useState('http://127.0.0.1:43112/overlay')

  useEffect(() => {
    window.songseek.appInfo().then((i) => i.overlayUrl && setOverlayUrl(i.overlayUrl))
  }, [])

  const connectSpotify = async () => {
    setBusy('spotify')
    try {
      const st = await window.songseek.spotify.connect()
      setSpotify(st)
      toast('Spotify connected — keep the Spotify app open and playing.', 'success')
    } catch (e) {
      toast(e.message.replace(/^Error invoking .*?: /, ''), 'error')
    }
    setBusy('')
  }

  const connectTwitch = async () => {
    setBusy('twitch')
    try {
      const st = await window.songseek.twitch.connect()
      setTwitch(st)
      toast(`Twitch connected as ${st.user ? st.user.login : ''}`, 'success')
    } catch (e) {
      toast(e.message.replace(/^Error invoking .*?: /, ''), 'error')
    }
    setBusy('')
  }

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => e.target === e.currentTarget && setSettingsOpen(false)}
    >
      <motion.div
        className="modal"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>

        <section>
          <h3>
            <span className="dot-lg" style={{ background: '#1DB954' }} /> Spotify
          </h3>
          <p className="section-desc">
            SongSeek <b>controls your Spotify app</b> — it doesn't play audio itself. Keep Spotify open and
            playing; requests go into its queue, so whatever playlist you're on carries on afterwards.
            Spotify <b>Premium</b> is required. Your login is stored only on this computer.
          </p>
          <div className="connect-row">
            {spotify.connected ? (
              <>
                <span className={`status ${spotify.needsReconnect ? 'err' : 'ok'}`}>
                  {spotify.needsReconnect
                    ? 'Reconnect to allow playback control'
                    : `Connected${spotify.user ? ` as ${spotify.user.name}` : ''}${
                        spotify.hasDevice ? ` · controlling ${spotify.deviceName || 'Spotify'}` : ' · open Spotify to control it'
                      }`}
                </span>
                {spotify.needsReconnect && (
                  <button className="btn" disabled={busy === 'spotify'} onClick={connectSpotify}>
                    {busy === 'spotify' ? 'Waiting for browser…' : 'Reconnect'}
                  </button>
                )}
                <button className="btn subtle" onClick={() => window.songseek.spotify.disconnect().then(setSpotify)}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn" disabled={busy === 'spotify'} onClick={connectSpotify}>
                {busy === 'spotify' ? 'Waiting for browser…' : 'Connect Spotify'}
              </button>
            )}
          </div>
        </section>

        <section>
          <h3>
            <span className="dot-lg" style={{ background: '#9146FF' }} /> Twitch
          </h3>
          {settings._bundled && settings._bundled.twitch ? (
            <p className="section-desc">
              Just click connect and log in with your Twitch account. Channel points need
              Affiliate/Partner — the chat command works for everyone.
            </p>
          ) : (
            <>
              <p className="section-desc">
                Register a <b>Public</b> app in the{' '}
                <Ext href="https://dev.twitch.tv/console/apps">Twitch Developer Console</Ext> with OAuth Redirect URL{' '}
                <code>http://localhost:43111</code>, then paste its Client ID. Channel points need Affiliate/Partner.
              </p>
              <TextField
                label="Client ID"
                value={settings.twitchClientId}
                placeholder="e.g. gp762n…"
                onSave={(v) => patchSettings({ twitchClientId: v })}
              />
            </>
          )}
          <div className="connect-row">
            {twitch.connected ? (
              <>
                <span className="status ok">Connected{twitch.user ? ` as ${twitch.user.login}` : ''}</span>
                <button className="btn subtle" onClick={() => window.songseek.twitch.disconnect().then(setTwitch)}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn" disabled={busy === 'twitch' || !settings.twitchClientId} onClick={connectTwitch}>
                {busy === 'twitch' ? 'Waiting for browser…' : 'Connect Twitch'}
              </button>
            )}
          </div>
          {twitch.error && <div className="status err">{twitch.error}</div>}

          <TextField
            label="Channel point reward name"
            value={settings.rewardName}
            placeholder="Song Request"
            hint="Must exactly match the reward title on your channel (create it with 'Require viewer to enter text' enabled)."
            onSave={(v) => patchSettings({ rewardName: v })}
          />
          <div className="field-row">
            <Toggle
              label="Also accept a chat command"
              checked={settings.chatCommandEnabled}
              onChange={(v) => patchSettings({ chatCommandEnabled: v })}
            />
            {settings.chatCommandEnabled && (
              <TextField label="" value={settings.chatCommand} placeholder="!sr" onSave={(v) => patchSettings({ chatCommand: v })} />
            )}
          </div>
          <Toggle
            label="Announce queue updates in chat"
            checked={settings.chatAnnounce}
            onChange={(v) => patchSettings({ chatAnnounce: v })}
          />
          <Toggle
            label="Mods can control playback in chat (!skip, !pause, !play, !clearqueue — plus !song for everyone)"
            checked={settings.modCommandsEnabled}
            onChange={(v) => patchSettings({ modCommandsEnabled: v })}
          />
        </section>

        <section>
          <h3>
            <span className="dot-lg" style={{ background: '#8b7bff' }} /> Stream overlay (OBS)
          </h3>
          <p className="section-desc">
            Add this link as a <b>Browser Source</b> in OBS (suggested size 800×160). A "now playing" card slides
            in whenever a song starts and whenever someone uses <code>!song</code> in chat, then slides away.
          </p>
          <div className="sim-row">
            <input readOnly value={overlayUrl} onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(overlayUrl)
                toast('Overlay link copied', 'success')
              }}
            >
              Copy
            </button>
          </div>
        </section>

        <UpdateSection />

        <section>
          <h3>Test</h3>
          <p className="section-desc">Simulate an incoming request without Twitch (song name or link):</p>
          <div className="sim-row">
            <input
              value={sim}
              placeholder="e.g. daft punk around the world"
              onChange={(e) => setSim(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && sim.trim()) {
                  handleIncomingRequest({ user: 'TestViewer', input: sim.trim(), via: 'test' })
                  setSim('')
                }
              }}
            />
            <button
              className="btn"
              disabled={!sim.trim()}
              onClick={() => {
                handleIncomingRequest({ user: 'TestViewer', input: sim.trim(), via: 'test' })
                setSim('')
              }}
            >
              Send
            </button>
          </div>
        </section>
      </motion.div>
    </motion.div>
  )
}
