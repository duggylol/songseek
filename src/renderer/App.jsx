import React, { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp, selectCurrent } from './state/store'
import { initPlayers, togglePlay } from './players/controller'
import { handleIncomingRequest, handleChatCommand } from './services/requests'
import TitleBar from './components/TitleBar'
import NowPlaying from './components/NowPlaying'
import QueuePanel from './components/QueuePanel'
import LibrarySidebar, { loadPlaylists } from './components/LibrarySidebar'
import SearchBar from './components/SearchBar'
import SettingsModal from './components/SettingsModal'
import Onboarding from './components/Onboarding'
import Toasts from './components/Toasts'
import { DEFAULT_THEME } from './themes'

function Background() {
  const art = useApp((s) => {
    const c = selectCurrent(s)
    return c && c.artwork
  })
  return (
    <div className="bg">
      <AnimatePresence>
        {art && (
          <motion.div
            key={art}
            className="bg-art"
            style={{ backgroundImage: `url("${art}")` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <div className="bg-vignette" />
      {/* Animated themes paint into this layer; static ones leave it empty.
          It sits above the vignette so the effect isn't washed out by it. */}
      <div className="theme-fx" />
    </div>
  )
}

// Themes are a document-level attribute so every layer — including portals and
// the modal — picks them up from one place.
function useTheme() {
  const theme = useApp((s) => (s.settings && s.settings.theme) || DEFAULT_THEME)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
}

export default function App() {
  const settingsOpen = useApp((s) => s.settingsOpen)
  // Shown until the user finishes (or skips) setup.
  const showSetup = useApp((s) => !!s.settings && !s.settings.setupComplete)
  useTheme()

  useEffect(() => {
    const st = useApp.getState()
    let unsubs = []
    ;(async () => {
      const settings = await window.songseek.settings.get()
      st.setSettings(settings)
      if (Array.isArray(settings.queue) && settings.queue.length) {
        useApp.setState({ queue: settings.queue })
      }
      initPlayers(settings.volume ?? 0.8)

      const sp = await window.songseek.spotify.status()
      st.setSpotify(sp)
      const tw = await window.songseek.twitch.status()
      st.setTwitch(tw)
      const kk = await window.songseek.kick.status()
      st.setKick(kk)
      st.setLibrary({ connected: sp.connected })
      if (sp.connected && !sp.needsReconnect) loadPlaylists()

      // First run shows the setup guide instead of the Settings panel.

      unsubs = [
        window.songseek.twitch.onRequest(handleIncomingRequest),
        window.songseek.twitch.onCommand(handleChatCommand),
        window.songseek.twitch.onStatus((s) => st.setTwitch(s)),
        // Kick uses the exact same request/command handlers as Twitch.
        window.songseek.kick.onRequest(handleIncomingRequest),
        window.songseek.kick.onCommand(handleChatCommand),
        window.songseek.kick.onStatus((s) => {
          st.setKick(s)
          if (s.error) st.toast(s.error, 'error')
        }),
        window.songseek.onUpdateReady(({ version }) =>
          st.toast(`Update ${version} ready — it installs next time you open SongSeek`, 'success')
        ),
        window.songseek.spotify.onStatus((s) => {
          st.setSpotify(s)
          st.setLibrary({ connected: s.connected })
          if (s.connected && !s.needsReconnect) loadPlaylists()
          if (s.error) st.toast(s.error, 'error')
        }),
      ]
    })()

    const onKey = (e) => {
      if (e.code !== 'Space') return
      const tag = document.activeElement && document.activeElement.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      unsubs.forEach((u) => u && u())
    }
  }, [])

  return (
    <div className="app">
      <Background />
      <TitleBar />
      <div className="content">
        <LibrarySidebar />
        <main className="stage">
          <SearchBar />
          <NowPlaying />
        </main>
        <QueuePanel />
      </div>
      <Toasts />
      <AnimatePresence>{settingsOpen && <SettingsModal key="settings" />}</AnimatePresence>
      <AnimatePresence>{showSetup && <Onboarding key="onboarding" />}</AnimatePresence>
    </div>
  )
}
