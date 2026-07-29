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
    // remote control of the user's own Spotify app
    addToQueue: (uri) => ipcRenderer.invoke('spotify:addToQueue', uri),
    next: () => ipcRenderer.invoke('spotify:next'),
    previous: () => ipcRenderer.invoke('spotify:previous'),
    pause: () => ipcRenderer.invoke('spotify:pause'),
    resume: () => ipcRenderer.invoke('spotify:resume'),
    seek: (ms) => ipcRenderer.invoke('spotify:seek', ms),
    setVolume: (pct) => ipcRenderer.invoke('spotify:setVolume', pct),
    playContext: (opts) => ipcRenderer.invoke('spotify:playContext', opts),
    devices: () => ipcRenderer.invoke('spotify:devices'),
    transfer: (id) => ipcRenderer.invoke('spotify:transfer', id),
    refresh: () => ipcRenderer.invoke('spotify:refresh'),
    onState: listen('spotify:state'),
    onQueue: listen('spotify:queue'),
  },
  twitch: {
    connect: () => ipcRenderer.invoke('twitch:connect'),
    disconnect: () => ipcRenderer.invoke('twitch:disconnect'),
    status: () => ipcRenderer.invoke('twitch:status'),
    say: (text) => ipcRenderer.invoke('twitch:say', text),
    onStatus: listen('twitch:status'),
    onRequest: listen('twitch:request'),
    onCommand: listen('twitch:command'),
  },
  appInfo: () => ipcRenderer.invoke('app:info'),
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: listen('update:state'),
  },
  overlay: {
    update: (track) => ipcRenderer.invoke('overlay:update', track),
    show: () => ipcRenderer.invoke('overlay:show'),
    hide: () => ipcRenderer.invoke('overlay:hide'),
  },
  library: {
    status: () => ipcRenderer.invoke('library:status'),
    playlists: () => ipcRenderer.invoke('library:playlists'),
    tracks: (id) => ipcRenderer.invoke('library:tracks', id),
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
