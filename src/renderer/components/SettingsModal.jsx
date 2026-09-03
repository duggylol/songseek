import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../state/store'
import { handleIncomingRequest } from '../services/requests'
import { THEMES, DEFAULT_THEME } from '../themes'

/* ---------------- small building blocks ---------------- */

// One setting = one row. Label on the left, control on the right.
function Row({ label, sub, children }) {
  return (
    <div className="row">
      <div className="row-text">
        <div className="row-label">{label}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </label>
  )
}

function Input({ value, onSave, placeholder, width }) {
  const [v, setV] = useState(value || '')
  useEffect(() => setV(value || ''), [value])
  return (
    <input
      type="text"
      value={v}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (value || '') && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
    />
  )
}

// The value is never rendered — the label says what it is, the button copies it.
function CopyButton({ value, label = 'Copy', onCopied }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className={`copy-btn ${done ? 'done' : ''}`}
      disabled={!value}
      onClick={() => {
        navigator.clipboard.writeText(value || '')
        setDone(true)
        onCopied && onCopied()
        setTimeout(() => setDone(false), 1600)
      }}
    >
      {done ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          {label}
        </>
      )}
    </button>
  )
}

function Ext({ href, children }) {
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); window.songseek.openExternal(href) }}>
      {children}
    </a>
  )
}

/* ---------------- tabs ---------------- */

const TABS = [
  {
    id: 'connections', label: 'Connections',
    icon: <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />,
  },
  {
    id: 'requests', label: 'Requests',
    icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  },
  {
    id: 'overlay', label: 'Overlay',
    icon: <><rect x="2" y="4" width="20" height="15" rx="2" /><path d="M2 10h20" /></>,
  },
  {
    id: 'appearance', label: 'Appearance',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18 4.5 4.5 0 0 0 0-9 4.5 4.5 0 0 1 0-9z" /></>,
  },
  {
    id: 'about', label: 'About',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  },
]

/* ---------------- panels ---------------- */

function ConnectionsPanel({ ctx }) {
  const { settings, patchSettings, spotify, setSpotify, twitch, setTwitch, kick, setKick, toast } = ctx
  const [busy, setBusy] = useState('')
  const [diag, setDiag] = useState('')
  const [kickChannel, setKickChannel] = useState('')

  const connectKick = async () => {
    const ch = kickChannel.trim()
    if (!ch) return
    setBusy('kick')
    try {
      const st = await window.songseek.kick.connect(ch)
      setKick({ connected: true, user: st, error: null })
      toast(`Kick connected to ${st.username || st.slug}`, 'success')
    } catch (e) {
      toast(e.message.replace(/^Error invoking .*?: /, ''), 'error')
    }
    setBusy('')
  }

  const connectSpotify = async () => {
    setBusy('spotify')
    try {
      setSpotify(await window.songseek.spotify.connect())
      toast('Spotify connected — keep the Spotify app open.', 'success')
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

  const spotifyState = !spotify.connected
    ? { badge: 'Not connected', cls: 'off' }
    : spotify.needsReconnect
      ? { badge: 'Action needed', cls: '' }
      : { badge: 'Connected', cls: 'ok' }

  return (
    <>
      <h3>Accounts</h3>

      <div className="card">
        <div className="card-head">
          <span className="dot-lg" style={{ background: '#1DB954' }} />
          <span className="card-title">Spotify</span>
          <span className={`badge ${spotifyState.cls}`}>{spotifyState.badge}</span>
        </div>
        <p className="card-note">
          {spotify.connected && !spotify.needsReconnect
            ? `${spotify.user ? spotify.user.name : 'Signed in'}${spotify.hasDevice ? ` · controlling ${spotify.deviceName || 'Spotify'}` : ' · open Spotify to control it'}`
            : 'Requests go into your Spotify queue, so your playlist keeps going. Premium required.'}
        </p>
        <div className="card-actions">
          {spotify.connected ? (
            <>
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
          <button
            className="btn subtle"
            onClick={async () => {
              setDiag('Testing…')
              try { setDiag(await window.songseek.spotify.diagnose()) } catch (e) { setDiag(String(e.message || e)) }
            }}
          >
            Test connection
          </button>
        </div>
        {diag && <pre className="diag">{diag}</pre>}

        <details className="advanced">
          <summary>Use your own Spotify app</summary>
          <ol className="steps-mini">
            <li>Open the <Ext href="https://developer.spotify.com/dashboard">Spotify Developer Dashboard</Ext> → <b>Create app</b>.</li>
            <li>Add the redirect URI below, tick <b>Web API</b>, save.</li>
            <li>Paste the app's Client ID here.</li>
          </ol>
          <Row label="Redirect URI" sub="Paste this into your Spotify app">
            <CopyButton value="http://127.0.0.1:8888" onCopied={() => toast('Redirect URI copied', 'success')} />
          </Row>
          <Row label="Your Client ID" sub="Leave empty to use the built-in app">
            <Input
              value={settings.spotifyUserClientId}
              placeholder="paste here"
              onSave={async (v) => {
                if (v === (settings.spotifyUserClientId || '')) return
                await window.songseek.spotify.disconnect().then(setSpotify).catch(() => {})
                await patchSettings({ spotifyUserClientId: v })
                toast(v ? 'Saved — now click Connect Spotify' : 'Back to the built-in Spotify app', 'success')
              }}
            />
          </Row>
        </details>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="dot-lg" style={{ background: '#9146FF' }} />
          <span className="card-title">Twitch</span>
          <span className={`badge ${twitch.connected ? 'ok' : 'off'}`}>
            {twitch.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <p className="card-note">
          {twitch.connected
            ? `Listening to ${twitch.user ? twitch.user.login : 'your channel'}'s chat and redemptions.`
            : 'Channel points need Affiliate or Partner — the chat command works on any channel.'}
        </p>
        <div className="card-actions">
          {twitch.connected ? (
            <button className="btn subtle" onClick={() => window.songseek.twitch.disconnect().then(setTwitch)}>
              Disconnect
            </button>
          ) : (
            <button className="btn" disabled={busy === 'twitch' || !settings.twitchClientId} onClick={connectTwitch}>
              {busy === 'twitch' ? 'Waiting for browser…' : 'Connect Twitch'}
            </button>
          )}
        </div>
        {twitch.error && <p className="card-note status err">{twitch.error}</p>}

        {!(settings._bundled && settings._bundled.twitch) && (
          <details className="advanced" open={!settings.twitchClientId}>
            <summary>Twitch app setup</summary>
            <ol className="steps-mini">
              <li>Register a <b>Public</b> app in the <Ext href="https://dev.twitch.tv/console/apps">Twitch Developer Console</Ext>.</li>
              <li>Use the redirect URL below, then paste the Client ID.</li>
            </ol>
            <Row label="OAuth Redirect URL" sub="Paste this into your Twitch app">
              <CopyButton value="http://localhost:43111" onCopied={() => toast('Redirect URL copied', 'success')} />
            </Row>
            <Row label="Client ID">
              <Input value={settings.twitchClientId} placeholder="paste here" onSave={(v) => patchSettings({ twitchClientId: v })} />
            </Row>
          </details>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <span className="dot-lg" style={{ background: '#53fc18' }} />
          <span className="card-title">Kick</span>
          <span className={`badge ${kick.connected ? 'ok' : 'off'}`}>
            {kick.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <p className="card-note">
          {kick.connected
            ? `Listening to ${kick.user ? (kick.user.username || kick.user.slug) : 'your channel'}'s chat.`
            : 'Just enter your channel name — no login needed. The chat command and mod commands work like Twitch.'}
        </p>
        {kick.connected ? (
          <div className="card-actions">
            <button className="btn subtle" onClick={() => window.songseek.kick.disconnect().then((s) => setKick(s))}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="card-actions">
            <div className="row-control" style={{ flex: 1 }}>
              <input
                type="text"
                placeholder="your Kick channel name"
                value={kickChannel}
                style={{ width: 200 }}
                onChange={(e) => setKickChannel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectKick()}
              />
            </div>
            <button className="btn" disabled={busy === 'kick' || !kickChannel.trim()} onClick={connectKick}>
              {busy === 'kick' ? 'Connecting…' : 'Connect Kick'}
            </button>
          </div>
        )}
        {kick.error && <p className="card-note status err">{kick.error}</p>}
        <p className="card-note" style={{ opacity: 0.7 }}>
          Kick has no channel-point rewards here, and chat confirmations aren't posted back (Kick needs a login
          to post). Requests via the chat command work fully.
        </p>
      </div>
    </>
  )
}

function RequestsPanel({ ctx }) {
  const { settings, patchSettings } = ctx
  const allOff =
    settings.allowSpotify === false && settings.allowYoutube === false && settings.allowSoundcloud === false

  return (
    <>
      <h3>How viewers request</h3>
      <div className="card">
        <Row label="Channel point reward" sub="Must match the reward title on your channel exactly">
          <Input value={settings.rewardName} placeholder="Song Request" onSave={(v) => patchSettings({ rewardName: v })} width={150} />
        </Row>
        <Row label="Chat command" sub="Works without Affiliate">
          {settings.chatCommandEnabled && (
            <Input value={settings.chatCommand} placeholder="!sr" onSave={(v) => patchSettings({ chatCommand: v })} width={78} />
          )}
          <Toggle checked={settings.chatCommandEnabled} onChange={(v) => patchSettings({ chatCommandEnabled: v })} />
        </Row>
        <Row label="Announce in chat" sub="Confirm each request as it's queued">
          <Toggle checked={settings.chatAnnounce} onChange={(v) => patchSettings({ chatAnnounce: v })} />
        </Row>
        <Row label="Mod commands" sub="!skip !pause !play !clearqueue — and !song for everyone">
          <Toggle checked={settings.modCommandsEnabled} onChange={(v) => patchSettings({ modCommandsEnabled: v })} />
        </Row>
      </div>

      <h3>Allowed sources</h3>
      <div className="card">
        <Row label="Spotify" sub="Queued in your Spotify app">
          <Toggle checked={settings.allowSpotify !== false} onChange={(v) => patchSettings({ allowSpotify: v })} />
        </Row>
        <Row label="YouTube" sub="Plays in SongSeek, matched to Spotify's volume">
          <Toggle checked={settings.allowYoutube !== false} onChange={(v) => patchSettings({ allowYoutube: v })} />
        </Row>
        <Row label="SoundCloud" sub="Plays in SongSeek, matched to Spotify's volume">
          <Toggle checked={settings.allowSoundcloud !== false} onChange={(v) => patchSettings({ allowSoundcloud: v })} />
        </Row>
        {allOff && <div className="note">All sources are off — no requests can be taken.</div>}
      </div>
    </>
  )
}

function OverlayPanel({ ctx }) {
  const { toast } = ctx
  const [info, setInfo] = useState({ overlayUrl: '', overlayFile: '', overlayPortMoved: false })

  useEffect(() => { window.songseek.appInfo().then(setInfo) }, [])

  return (
    <>
      <h3>OBS browser source</h3>
      <div className="card">
        <p className="card-note" style={{ marginTop: 0 }}>
          Add a <b>Browser Source</b> in OBS at roughly 800×160. A now-playing card slides in on every song and
          on <code>!song</code>.
        </p>
        <Row label="Overlay file" sub="Recommended — tick “Local file” in OBS and pick it">
          <CopyButton value={info.overlayFile} label="Copy path" onCopied={() => toast('Overlay file path copied', 'success')} />
        </Row>
        <Row label="Overlay link" sub="Only works while SongSeek is running">
          <CopyButton value={info.overlayUrl} label="Copy link" onCopied={() => toast('Overlay link copied', 'success')} />
        </Row>
        {info.overlayPortMoved && (
          <div className="note">
            Another program took SongSeek's usual port, so the link changed. Re-copy it, or switch to the file —
            that one never moves.
          </div>
        )}
      </div>
    </>
  )
}

function AppearancePanel({ ctx }) {
  const { settings, patchSettings } = ctx
  const current = settings.theme || DEFAULT_THEME

  return (
    <>
      <h3>Theme</h3>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-card ${current === t.id ? 'on' : ''}`}
            onClick={() => patchSettings({ theme: t.id })}
          >
            <div className="theme-prev" style={{ background: t.prev.bg }}>
              {t.prev.fx && <span className={`theme-prev-fx fx-${t.prev.fx}`} />}
              <span className="theme-prev-ui">
                <b style={{ background: t.prev.accent }} />
                <i style={{ background: t.prev.bar }} />
                <i style={{ background: t.prev.accent, flex: '0 0 22px' }} />
              </span>
              {current === t.id && (
                <span className="theme-check">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
              )}
            </div>
            <div className="theme-meta">
              <span className="theme-name">{t.name}</span>
              {t.animated && <span className="theme-anim">Animated</span>}
            </div>
          </button>
        ))}
      </div>
      <p className="card-note">Animated themes use transform-only effects, so they stay light while you stream.</p>
    </>
  )
}

function AboutPanel({ ctx }) {
  const { toast, patchSettings, setSettingsOpen } = ctx
  const [u, setU] = useState({ currentVersion: '', status: 'idle', supported: false })
  const [sim, setSim] = useState('')

  useEffect(() => {
    window.songseek.update.state().then(setU)
    return window.songseek.update.onState(setU)
  }, [])

  const line = () => {
    switch (u.status) {
      case 'checking': return 'Checking…'
      case 'downloading': return `Downloading ${u.version || ''} — ${u.percent || 0}%`
      case 'ready': return `${u.version} ready — installs next time you open SongSeek`
      case 'current': return "You're up to date"
      case 'error': return `Check failed: ${u.error}`
      case 'unsupported': return 'Automatic on Windows; download manually on macOS'
      default: return 'Updates install on startup, before SongSeek opens'
    }
  }

  const send = () => {
    if (!sim.trim()) return
    handleIncomingRequest({ user: 'TestViewer', input: sim.trim(), via: 'test' })
    setSim('')
  }

  return (
    <>
      <h3>Version</h3>
      <div className="card">
        <div className="version-row">
          <span className="version-badge">v{u.currentVersion || '—'}</span>
          <span className={`status ${u.status === 'error' ? 'err' : u.status === 'ready' ? 'ok' : ''}`}>{line()}</span>
        </div>
        {u.status === 'downloading' && (
          <div className="progress-bar"><span style={{ width: `${u.percent || 0}%` }} /></div>
        )}
        <div className="card-actions">
          {u.status === 'ready' ? (
            <button className="btn" onClick={() => window.songseek.update.install()}>Restart &amp; install</button>
          ) : (
            <button
              className="btn subtle"
              disabled={!u.supported || u.status === 'checking' || u.status === 'downloading'}
              onClick={async () => { await window.songseek.update.check(); toast('Checking for updates…', 'info') }}
            >
              Check for updates
            </button>
          )}
          <button
            className="btn subtle"
            onClick={async () => { await patchSettings({ setupComplete: false }); setSettingsOpen(false) }}
          >
            Run setup guide
          </button>
          <Ext href="https://github.com/duggylol/songseek/releases">Release notes</Ext>
        </div>
      </div>

      <h3>Test a request</h3>
      <div className="card">
        <p className="card-note" style={{ marginTop: 0 }}>Queue something as if a viewer asked for it.</p>
        <div className="sim-row">
          <input
            value={sim}
            placeholder="song name or link"
            onChange={(e) => setSim(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="btn" disabled={!sim.trim()} onClick={send}>Send</button>
        </div>
      </div>
    </>
  )
}

const PANELS = {
  connections: ConnectionsPanel,
  requests: RequestsPanel,
  overlay: OverlayPanel,
  appearance: AppearancePanel,
  about: AboutPanel,
}

/* ---------------- shell ---------------- */

export default function SettingsModal() {
  const settings = useApp((s) => s.settings) || {}
  const patchSettings = useApp((s) => s.patchSettings)
  const spotify = useApp((s) => s.spotify)
  const twitch = useApp((s) => s.twitch)
  const kick = useApp((s) => s.kick)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const setSpotify = useApp((s) => s.setSpotify)
  const setTwitch = useApp((s) => s.setTwitch)
  const setKick = useApp((s) => s.setKick)
  const toast = useApp((s) => s.toast)
  const [tab, setTab] = useState('connections')

  // A dot on the tab that actually needs attention, so nothing has to be
  // explained in prose. Chat platforms are optional (connect either or both),
  // so only flag Spotify, which playback genuinely needs.
  const needsAttention = {
    connections: !spotify.connected || spotify.needsReconnect,
  }

  const ctx = { settings, patchSettings, spotify, setSpotify, twitch, setTwitch, kick, setKick, toast, setSettingsOpen }
  const Panel = PANELS[tab]

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
        initial={{ opacity: 0, y: 22, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>

        <div className="set-body">
          <nav className="set-rail">
            {TABS.map((t) => (
              <button key={t.id} className={`set-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
                <span className="set-tab-inner">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    {t.icon}
                  </svg>
                  {t.label}
                  {needsAttention[t.id] && <span className="set-tab-warn" />}
                </span>
              </button>
            ))}
          </nav>

          {/* The keyed div remounts per tab and replays a CSS fade-in. This is
              deliberately plain CSS rather than a nested motion component:
              motion children mounting inside the modal blocked AnimatePresence
              from ever finishing the modal's exit, so Settings stayed on screen
              after being closed. */}
          <div className="set-panel">
            <div className="set-panel-in" key={tab}>
              <Panel ctx={ctx} />
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
