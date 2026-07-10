const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const DEFAULTS = {
  spotifySearchClientId: '',
  spotifySearchClientSecret: '',
  twitchClientId: '',
  rewardName: 'Song Request',
  chatCommandEnabled: true,
  chatCommand: '!sr',
  chatAnnounce: true,
  volume: 0.8,
  spotifyTokens: null,
  spotifyUser: null,
  twitchTokens: null,
  twitchUser: null,
  queue: [],
}

// Credentials bundled at build time (app-config.json). Spotify id+secret power
// catalog *search* (app-only, no user login, no allowlist); the Twitch client id
// powers one-click Twitch login. Users never create developer apps themselves.
const BUNDLED_KEYS = ['spotifySearchClientId', 'spotifySearchClientSecret', 'twitchClientId']

function bundledConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app-config.json'), 'utf8'))
    return {
      spotifySearchClientId: raw.spotifyClientId || '',
      spotifySearchClientSecret: raw.spotifyClientSecret || '',
      twitchClientId: raw.twitchClientId || '',
    }
  } catch {
    return {}
  }
}

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'songseek.json')
    const bundled = bundledConfig()
    this.data = { ...DEFAULTS, ...bundled }
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')))
    } catch {
      /* first run */
    }
    // Bundled values always win — they come from the build, not user input.
    for (const key of BUNDLED_KEYS) {
      if (bundled[key]) this.data[key] = bundled[key]
    }
    this.bundled = bundled
  }

  get(key) {
    return this.data[key]
  }

  set(key, value) {
    this.data[key] = value
    this.save()
  }

  merge(patch) {
    Object.assign(this.data, patch)
    this.save()
  }

  all() {
    const d = { ...this.data }
    // Never expose the secret to the renderer.
    delete d.spotifySearchClientSecret
    return {
      ...d,
      _bundled: {
        spotifySearch: !!(this.bundled.spotifySearchClientId && this.bundled.spotifySearchClientSecret),
        twitch: !!this.bundled.twitchClientId,
      },
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch (e) {
      console.error('[store] failed to save settings:', e)
    }
  }
}

module.exports = Store
