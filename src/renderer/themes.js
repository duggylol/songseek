// Theme catalogue. `prev` drives the little live preview in Settings, so a new
// theme needs no extra CSS there — the swatch is built from these colours.
export const THEMES = [
  {
    id: 'midnight',
    name: 'Midnight',
    animated: false,
    prev: { bg: 'linear-gradient(150deg,#12121c,#0a0a0f)', accent: '#8b7bff', bar: 'rgba(255,255,255,0.22)' },
  },
  {
    id: 'verdant',
    name: 'Verdant',
    animated: false,
    prev: { bg: 'linear-gradient(150deg,#16211a,#0b0f0c)', accent: '#1ed760', bar: 'rgba(255,255,255,0.20)' },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    animated: true,
    prev: {
      bg: 'linear-gradient(150deg,#0b1a2c,#050b16)',
      accent: '#3fe0c8',
      bar: 'rgba(255,255,255,0.20)',
      fx: 'aurora',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    animated: true,
    prev: {
      bg: 'linear-gradient(150deg,#2a150d,#120a07)',
      accent: '#ff8a4c',
      bar: 'rgba(255,255,255,0.20)',
      fx: 'ember',
    },
  },
  {
    id: 'mono',
    name: 'Mono',
    animated: false,
    prev: { bg: 'linear-gradient(150deg,#1a1a1a,#0b0b0b)', accent: '#ffffff', bar: 'rgba(255,255,255,0.22)' },
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    animated: true,
    prev: {
      bg: 'linear-gradient(150deg,#1d0d3f,#0c0620)',
      accent: '#ff4ecd',
      bar: 'rgba(0,229,255,0.45)',
      fx: 'synthwave',
    },
  },
]

export const DEFAULT_THEME = 'midnight'

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0]
