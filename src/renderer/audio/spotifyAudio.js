// Renderer-side sink for Spotify PCM coming from the go-librespot daemon (via main).
// Feeds an AudioWorklet and exposes a gain node for volume.

// Worklet source is inlined and loaded via a Blob URL so it works identically in
// dev (http://) and in the packaged app (file://), avoiding origin restrictions.
const WORKLET_SRC = `
class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []
    this.readIndex = 0
    this.playing = true
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.type === 'pcm') {
        const i16 = new Int16Array(m.buffer)
        const f32 = new Float32Array(i16.length)
        for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768
        this.queue.push(f32)
      } else if (m.type === 'flush') {
        this.queue = []; this.readIndex = 0
      } else if (m.type === 'playing') {
        this.playing = m.value
      }
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0]
    const left = out[0]
    const right = out[1] || out[0]
    for (let i = 0; i < left.length; i++) {
      if (!this.playing || this.queue.length === 0) {
        left[i] = 0; if (out[1]) right[i] = 0; continue
      }
      const buf = this.queue[0]
      const base = this.readIndex * 2
      left[i] = buf[base]
      if (out[1]) right[i] = buf[base + 1]
      this.readIndex++
      if (this.readIndex * 2 >= buf.length) { this.queue.shift(); this.readIndex = 0 }
    }
    return true
  }
}
registerProcessor('pcm-player', PCMPlayer)
`

let ctx = null
let node = null
let gain = null
let ready = null

export function initSpotifyAudio(volume = 0.8) {
  if (ready) return ready
  ready = (async () => {
    ctx = new AudioContext({ sampleRate: 44100 })
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    node = new AudioWorkletNode(ctx, 'pcm-player', { outputChannelCount: [2] })
    gain = ctx.createGain()
    gain.gain.value = volume
    node.connect(gain).connect(ctx.destination)

    window.songseek.spotify.onPcm((buf) => {
      if (!node) return
      const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      node.port.postMessage({ type: 'pcm', buffer: ab }, [ab])
    })
  })().catch((e) => {
    console.error('Spotify audio init failed:', e)
  })
  return ready
}

export async function resumeSpotifyAudio() {
  if (ctx && ctx.state === 'suspended') await ctx.resume()
}

export function setSpotifyPlaying(v) {
  if (node) node.port.postMessage({ type: 'playing', value: v })
}

export function flushSpotifyAudio() {
  if (node) node.port.postMessage({ type: 'flush' })
}

export function setSpotifyVolume(v) {
  if (gain) gain.gain.value = v
}
