const { contextBridge, ipcRenderer } = require('electron')

const listen = (channel) => (cb) => {
  const handler = (_e, data) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('songseek', {
  platform: process.platform,
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  spotify: {
    connect: () => ipcRenderer.invoke('spotify:connect'),
    disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
    status: () => ipcRenderer.invoke('spotify:status'),
    onStatus: listen('spotify:status'),
    // playback engine
    play: (uri) => ipcRenderer.invoke('spotify:play', uri),
    pause: () => ipcRenderer.invoke('spotify:pause'),
    resume: () => ipcRenderer.invoke('spotify:resume'),
    seek: (ms) => ipcRenderer.invoke('spotify:seek', ms),
    stop: () => ipcRenderer.invoke('spotify:stopPlayback'),
    onPcm: (cb) => {
      const h = (_e, data) => cb(data)
      ipcRenderer.on('spotify:pcm', h)
      return () => ipcRenderer.removeListener('spotify:pcm', h)
    },
    onPosition: listen('spotify:position'),
    onEnded: listen('spotify:ended'),
  },
  twitch: {
    connect: () => ipcRenderer.invoke('twitch:connect'),
    disconnect: () => ipcRenderer.invoke('twitch:disconnect'),
    status: () => ipcRenderer.invoke('twitch:status'),
    say: (text) => ipcRenderer.invoke('twitch:say', text),
    onStatus: listen('twitch:status'),
    onRequest: listen('twitch:request'),
  },
  search: {
    spotify: (q, limit) => ipcRenderer.invoke('search:spotify', q, limit),
    youtube: (q) => ipcRenderer.invoke('search:youtube', q),
    soundcloud: (q) => ipcRenderer.invoke('search:soundcloud', q),
    resolveSpotify: (id) => ipcRenderer.invoke('resolve:spotify', id),
    resolveYoutube: (id) => ipcRenderer.invoke('resolve:youtube', id),
    resolveYoutubeStream: (id) => ipcRenderer.invoke('resolve:youtubeStream', id),
    resolveSoundcloud: (url) => ipcRenderer.invoke('resolve:soundcloud', url),
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    onMaximized: listen('win:maximized'),
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  onUpdateReady: listen('update:ready'),
})
