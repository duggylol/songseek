import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state/store'

// First-run setup guide. Walks the user through creating their OWN Spotify (and
// Twitch) app, because the released build ships with no developer credentials.
// Each step pairs short instructions with an animated mock of the real screen so
// it's obvious what to click.

const SPOTIFY_REDIRECT = 'http://127.0.0.1:8888'
const TWITCH_REDIRECT = 'http://localhost:43111'

// Copies without showing the string — the label above it says what it is, so
// there's nothing to mistype or misread.
function Copy({ value, label = 'the redirect URI' }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className={`copy-chip ${done ? 'done' : ''}`}
      onClick={() => {
        navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
      title="Copy to clipboard"
    >
      {label}
      <span>{done ? '✓ copied' : 'copy'}</span>
    </button>
  )
}

// A stylised browser window used for every visual, so the steps feel consistent.
function MockWindow({ url, children, accent = '#1DB954' }) {
  return (
    <div className="mock" style={{ '--mock-accent': accent }}>
      <div className="mock-bar">
        <i /><i /><i />
        <span className="mock-url">{url}</span>
      </div>
      <div className="mock-body">{children}</div>
    </div>
  )
}

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4 },
}

// Step 1 visual: the "Create app" form filling itself in.
function SpotifyAppVisual() {
  return (
    <MockWindow url="developer.spotify.com/dashboard">
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.1 }}>
        <span className="mock-label">App name</span>
        <span className="mock-input typed">SongSeek</span>
      </motion.div>
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.5 }}>
        <span className="mock-label">Redirect URI</span>
        <span className="mock-input typed highlight">{SPOTIFY_REDIRECT}</span>
      </motion.div>
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.9 }}>
        <span className="mock-label">APIs used</span>
        <span className="mock-check">
          <motion.i
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 1.15, type: 'spring', stiffness: 500, damping: 18 }}
          >
            ✓
          </motion.i>
          Web API
        </span>
      </motion.div>
      <motion.div
        className="mock-btn"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: [0.9, 1.04, 1] }}
        transition={{ delay: 1.5, duration: 0.5 }}
      >
        Save
      </motion.div>
    </MockWindow>
  )
}

// Step 2 visual: copying the Client ID off the settings page.
function ClientIdVisual() {
  return (
    <MockWindow url="developer.spotify.com/dashboard → your app → Settings">
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.2 }}>
        <span className="mock-label">Client ID</span>
        <motion.span
          className="mock-input mono highlight"
          animate={{ boxShadow: ['0 0 0 0 rgba(29,185,84,0)', '0 0 0 5px rgba(29,185,84,.25)', '0 0 0 0 rgba(29,185,84,0)'] }}
          transition={{ delay: 0.7, duration: 1.6, repeat: Infinity, repeatDelay: 1 }}
        >
          5359109893384ef2…
        </motion.span>
      </motion.div>
      <motion.div className="mock-note" {...fade} transition={{ delay: 1 }}>
        You only need the Client&nbsp;ID — never the Client Secret.
      </motion.div>
    </MockWindow>
  )
}

function TwitchAppVisual() {
  return (
    <MockWindow url="dev.twitch.tv/console/apps" accent="#9146FF">
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.1 }}>
        <span className="mock-label">Name</span>
        <span className="mock-input typed">SongSeek</span>
      </motion.div>
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.5 }}>
        <span className="mock-label">OAuth Redirect URL</span>
        <span className="mock-input typed highlight">{TWITCH_REDIRECT}</span>
      </motion.div>
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.9 }}>
        <span className="mock-label">Client Type</span>
        <span className="mock-input">Public</span>
      </motion.div>
      <motion.div
        className="mock-btn"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: [0.9, 1.04, 1] }}
        transition={{ delay: 1.4, duration: 0.5 }}
      >
        Create
      </motion.div>
    </MockWindow>
  )
}

function RewardVisual() {
  return (
    <MockWindow url="dashboard.twitch.tv → Viewer Rewards → Channel Points" accent="#9146FF">
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.1 }}>
        <span className="mock-label">Reward name</span>
        <span className="mock-input typed highlight">Song Request</span>
      </motion.div>
      <motion.div className="mock-row" {...fade} transition={{ delay: 0.6 }}>
        <span className="mock-label">Require text</span>
        <motion.span
          className="mock-toggle on"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <motion.i
            initial={{ x: 0 }}
            animate={{ x: 15 }}
            transition={{ delay: 1, type: 'spring', stiffness: 400, damping: 22 }}
          />
        </motion.span>
      </motion.div>
      <motion.div className="mock-note" {...fade} transition={{ delay: 1.3 }}>
        Viewers type the song name when they redeem it.
      </motion.div>
    </MockWindow>
  )
}

function PlayVisual() {
  return (
    <MockWindow url="Spotify" accent="#1DB954">
      <div className="mock-player">
        <motion.div
          className="mock-art"
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
        <div className="mock-lines">
          <span className="l1" />
          <span className="l2" />
        </div>
        <motion.div
          className="mock-play"
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        >
          ▶
        </motion.div>
      </div>
      <motion.div className="mock-note" {...fade} transition={{ delay: 0.5 }}>
        SongSeek controls Spotify — it must be open and playing.
      </motion.div>
    </MockWindow>
  )
}

export default function Onboarding() {
  const settings = useApp((s) => s.settings) || {}
  const patchSettings = useApp((s) => s.patchSettings)
  const spotify = useApp((s) => s.spotify)
  const twitch = useApp((s) => s.twitch)
  const setSpotify = useApp((s) => s.setSpotify)
  const setTwitch = useApp((s) => s.setTwitch)
  const toast = useApp((s) => s.toast)
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState('')
  const [spotifyId, setSpotifyId] = useState(settings.spotifyUserClientId || '')
  const [twitchId, setTwitchId] = useState(settings.twitchClientId || '')

  useEffect(() => {
    setSpotifyId(settings.spotifyUserClientId || '')
    setTwitchId(settings.twitchClientId || '')
  }, [settings.spotifyUserClientId, settings.twitchClientId])

  const connectSpotify = async () => {
    setBusy('spotify')
    try {
      await patchSettings({ spotifyUserClientId: spotifyId.trim() })
      const st = await window.songseek.spotify.connect()
      setSpotify(st)
      toast('Spotify connected', 'success')
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking .*?: /, ''), 'error')
    }
    setBusy('')
  }

  const connectTwitch = async () => {
    setBusy('twitch')
    try {
      await patchSettings({ twitchClientId: twitchId.trim() })
      const st = await window.songseek.twitch.connect()
      setTwitch(st)
      toast('Twitch connected', 'success')
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking .*?: /, ''), 'error')
    }
    setBusy('')
  }

  const finish = async () => {
    await patchSettings({ setupComplete: true })
    toast('Setup complete — happy streaming!', 'success')
  }

  const steps = [
    {
      key: 'welcome',
      title: 'Welcome to SongSeek',
      lede: "Let's get you set up. It takes about five minutes and you only do it once.",
      visual: <PlayVisual />,
      body: (
        <ul className="need-list">
          <li><b>Spotify Premium</b> — required by Spotify to control playback</li>
          <li><b>A free Spotify developer app</b> — yours, so nothing is shared or rate-limited</li>
          <li><b>A Twitch account</b> — Affiliate/Partner only if you want channel points</li>
        </ul>
      ),
      canNext: true,
    },
    {
      key: 'spotify-app',
      title: 'Create your Spotify app',
      lede: "Spotify requires every app to be registered. Yours takes a minute and is free — it's what lets SongSeek talk to your Spotify.",
      visual: <SpotifyAppVisual />,
      body: (
        <ol className="ob-steps">
          <li>
            Open the <button className="link" onClick={() => window.songseek.openExternal('https://developer.spotify.com/dashboard')}>Spotify Developer Dashboard</button> and click <b>Create app</b> (log in with your normal Spotify account).
          </li>
          <li>Name it anything — <b>SongSeek</b> works.</li>
          <li>In <b>Redirect URIs</b>, paste the SongSeek redirect URI: <Copy value={SPOTIFY_REDIRECT} label="Redirect URI" /></li>
          <li>Tick <b>Web API</b>, agree to the terms, and hit <b>Save</b>.</li>
        </ol>
      ),
      canNext: true,
    },
    {
      key: 'spotify-connect',
      title: 'Connect your Spotify',
      lede: 'Open your new app, go to Settings, and copy its Client ID here.',
      visual: <ClientIdVisual />,
      body: (
        <>
          <label className="ob-field">
            <span>Spotify Client ID</span>
            <input
              value={spotifyId}
              onChange={(e) => setSpotifyId(e.target.value)}
              placeholder="paste it here"
              spellCheck={false}
            />
          </label>
          {spotify.connected && !spotify.needsReconnect ? (
            <p className="ob-ok">✓ Connected{spotify.user ? ` as ${spotify.user.name}` : ''}</p>
          ) : (
            <button className="btn" disabled={!spotifyId.trim() || busy === 'spotify'} onClick={connectSpotify}>
              {busy === 'spotify' ? 'Waiting for your browser…' : 'Connect Spotify'}
            </button>
          )}
        </>
      ),
      canNext: spotify.connected && !spotify.needsReconnect,
      blockedHint: 'Connect Spotify to continue',
    },
    {
      key: 'twitch-app',
      title: 'Create your Twitch app',
      lede: 'Same idea for Twitch, so SongSeek can read your chat and channel point redemptions.',
      visual: <TwitchAppVisual />,
      body: (
        <ol className="ob-steps">
          <li>
            Open the <button className="link" onClick={() => window.songseek.openExternal('https://dev.twitch.tv/console/apps')}>Twitch Developer Console</button> → <b>Register Your Application</b>. (Twitch requires 2FA on your account first.)
          </li>
          <li>Name it anything unique, e.g. <b>SongSeek — yourname</b>.</li>
          <li>Paste the SongSeek redirect URL: <Copy value={TWITCH_REDIRECT} label="OAuth Redirect URL" /></li>
          <li>Category <b>Application Integration</b>, Client Type <b>Public</b>, then <b>Create</b>.</li>
        </ol>
      ),
      canNext: true,
    },
    {
      key: 'twitch-connect',
      title: 'Connect your Twitch',
      lede: 'Open your new Twitch app and copy its Client ID here.',
      visual: <TwitchAppVisual />,
      body: (
        <>
          <label className="ob-field">
            <span>Twitch Client ID</span>
            <input
              value={twitchId}
              onChange={(e) => setTwitchId(e.target.value)}
              placeholder="paste it here"
              spellCheck={false}
            />
          </label>
          {twitch.connected ? (
            <p className="ob-ok">✓ Connected{twitch.user ? ` as ${twitch.user.login}` : ''}</p>
          ) : (
            <button className="btn" disabled={!twitchId.trim() || busy === 'twitch'} onClick={connectTwitch}>
              {busy === 'twitch' ? 'Waiting for your browser…' : 'Connect Twitch'}
            </button>
          )}
        </>
      ),
      canNext: twitch.connected,
      blockedHint: 'Connect Twitch to continue',
    },
    {
      key: 'reward',
      title: 'Add the song request reward',
      lede: 'This is what viewers redeem. Skip it if you\'re not an Affiliate — the !sr chat command works for everyone.',
      visual: <RewardVisual />,
      body: (
        <>
          <ol className="ob-steps">
            <li>On your Twitch dashboard: <b>Viewer Rewards → Channel Points → Manage Rewards</b>.</li>
            <li>Add a custom reward and turn on <b>Require viewer to enter text</b>.</li>
            <li>Give it the same name you set here:</li>
          </ol>
          <label className="ob-field">
            <span>Reward name</span>
            <input
              value={settings.rewardName || ''}
              onChange={(e) => patchSettings({ rewardName: e.target.value })}
              placeholder="Song Request"
            />
          </label>
        </>
      ),
      canNext: true,
    },
    {
      key: 'done',
      title: "You're all set",
      lede: 'Open Spotify, press play, and let chat take over.',
      visual: <PlayVisual />,
      body: (
        <ul className="need-list">
          <li><b>Requests</b> land in Spotify's own queue — your playlist keeps going.</li>
          <li><b>Mods</b> can use <code>!skip</code>, <code>!pause</code>, <code>!play</code>, <code>!clearqueue</code> in chat.</li>
          <li><b>OBS overlay</b> and everything else lives in Settings.</li>
        </ul>
      ),
      canNext: true,
    },
  ]

  const step = steps[i]
  const last = i === steps.length - 1

  return (
    <motion.div className="ob-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="ob"
        initial={{ opacity: 0, y: 26, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      >
        <div className="ob-progress">
          {steps.map((s, n) => (
            <button
              key={s.key}
              className={`ob-dot ${n === i ? 'on' : ''} ${n < i ? 'done' : ''}`}
              onClick={() => n < i && setI(n)}
              aria-label={`Step ${n + 1}`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step.key}
            className="ob-inner"
            initial={{ opacity: 0, x: 22 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -22 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="ob-visual">{step.visual}</div>
            <div className="ob-text">
              <p className="ob-count">Step {i + 1} of {steps.length}</p>
              <h2>{step.title}</h2>
              <p className="ob-lede">{step.lede}</p>
              <div className="ob-body">{step.body}</div>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="ob-actions">
          <button className="ob-skip" onClick={finish}>Skip setup</button>
          <div className="ob-nav">
            {i > 0 && <button className="btn subtle" onClick={() => setI(i - 1)}>Back</button>}
            {last ? (
              <button className="btn" onClick={finish}>Finish</button>
            ) : (
              <button
                className="btn"
                disabled={!step.canNext}
                title={step.canNext ? '' : step.blockedHint || ''}
                onClick={() => setI(i + 1)}
              >
                {step.canNext ? 'Next' : step.blockedHint || 'Next'}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
