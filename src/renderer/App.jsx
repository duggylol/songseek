import React, { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from './state/store'
import { initPlayers, togglePlay } from './players/controller'
import { handleIncomingRequest, handleChatCommand } from './services/requests'
import TitleBar from './components/TitleBar'
import NowPlaying from './components/NowPlaying'
import QueuePanel from './components/QueuePanel'
import LibrarySidebar, { loadPlaylists } from './components/LibrarySidebar'
import SearchBar from './components/SearchBar'
import SettingsModal from './components/SettingsModal'
import Toasts from './components/Toasts'

function Background() {
  const art = useApp((s) => s.current && s.current.artwork)
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
    </div>
  )
}

export default function App() {
  const settingsOpen = useApp((s) => s.settingsOpen)

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
      const lib = await window.songseek.library.status()
      st.setLibrary({ connected: lib.connected })
      if (lib.connected) loadPlaylists()

      // First-run experience: guide the user into Settings until at least one service is connected.
      if (!sp.connected && !tw.connected) st.setSettingsOpen(true)

      unsubs = [
        window.songseek.twitch.onRequest(handleIncomingRequest),
        window.songseek.twitch.onCommand(handleChatCommand),
        window.songseek.twitch.onStatus((s) => st.setTwitch(s)),
        window.songseek.onUpdateReady(({ version }) =>
          st.toast(`Update ${version} downloaded — it installs when you close SongSeek`, 'success')
        ),
        window.songseek.spotify.onStatus((s) => {
          st.setSpotify(s)
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
    </div>
  )
}
