import { SpeechQueue } from '../../shared/speech-queue.js'
import { PiperClient, type Result } from './client'
import { MuseTalkClient } from '../lipsync/client'

type Hooks = {
  status(status: string): void
  notice(message: string): void
  backend(backend: string): void
  progress(message: string): void
  playbackBlocked(blocked: boolean): void
  playbackStarted(): void
  playback(cue: SpeechCue | null): void
  videoActive(active: boolean): void
}
const noop = () => {}
const empty: Hooks = { status: noop, notice: noop, backend: noop, progress: noop, playbackBlocked: noop, playbackStarted: noop, playback: noop, videoActive: noop }
export type SpeechCue = { itemId: string; responseId: string; text: string; start: number; end: number; progress: number; completed: { itemId: string; start: number; end: number }[] }

// Realtime handles microphone input and text; this adapter owns all audible output.
export class PiperSpeech {
  private hooks = empty
  private audio: HTMLAudioElement | null = null
  private url?: string
  private cancelPlayback?: () => void
  private museTalk = new MuseTalkClient(
    import.meta.env.VITE_MUSETALK_WS_URL?.trim() || (import.meta.env.DEV ? 'ws://127.0.0.1:8765/stream' : ''),
    active => this.hooks.videoActive(active),
  )
  private museTalkEnabled = Boolean(import.meta.env.VITE_MUSETALK_WS_URL?.trim() || import.meta.env.DEV)
  private engine = new PiperClient(event => {
    if (event.type === 'backend') { this.hooks.backend(event.backend); if (event.fallbackReason) this.hooks.notice(event.fallbackReason) }
    if (event.type === 'fallback') this.hooks.notice(event.message)
    if (event.type === 'progress') {
      const labels: Record<string, string> = { phonemizer: '발음을 준비하고 있어요', load: '음성 모델을 준비하고 있어요', inference: '문장을 음성으로 만들고 있어요' }
      this.hooks.progress(event.stage === 'download' ? `음성 파일 다운로드${event.total ? ` ${Math.min(100, Math.round(event.loaded / event.total * 100))}%` : ''}` : labels[event.stage] || '')
    }
    if (event.type === 'result') this.hooks.progress('')
  })
  private queue = new SpeechQueue({
    engine: this.engine,
    play: (result, current, started, progress) => this.play(result, current, started, progress),
    stopAudio: () => this.stopAudio(),
    playback: cue => this.hooks.playback(cue),
    status: status => { if (status === 'idle') this.hooks.progress(''); this.hooks.status(status) },
    notice: message => this.hooks.notice(message),
  })
  get busy() { return this.queue.busy }
  attachAudio(node: HTMLAudioElement | null) { if (!node) this.stopAudio(); this.audio = node }
  attachVideo(node: HTMLCanvasElement | null) { this.museTalk.attachCanvas(node) }
  configure(mode: string, hooks: Hooks) { this.hooks = hooks; this.museTalkEnabled = mode !== 'off' && Boolean(import.meta.env.VITE_MUSETALK_WS_URL?.trim() || import.meta.env.DEV); this.engine.reset(); this.queue.configure(mode) }
  append(itemId: string, responseId: string, delta: string) { this.queue.append(itemId, responseId, delta) }
  completeItem(itemId: string, responseId: string, text: string) { this.queue.completeItem(itemId, responseId, text) }
  finish(responseId: string) { this.queue.finish(responseId) }
  interrupt() { this.queue.interrupt(); this.hooks.progress(''); this.hooks.playbackBlocked(false) }
  dispose() { this.queue.dispose(); this.museTalk.dispose(); this.hooks = empty }
  async resume() {
    if (this.museTalkEnabled) {
      try { await this.museTalk.resume(); this.hooks.playbackBlocked(false) }
      catch { this.hooks.playbackBlocked(true) }
    }
    if (!this.audio?.src) return
    try { await this.audio.play(); this.hooks.playbackBlocked(false) }
    catch { this.hooks.playbackBlocked(true) }
  }
  private stopAudio() {
    this.museTalk.stop()
    this.cancelPlayback?.(); this.cancelPlayback = undefined
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load() }
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = undefined
  }
  private async play(result: Result, current: () => boolean, started: () => void, reportProgress: (progress: number) => void): Promise<void> {
    this.stopAudio()
    result = { ...result, pcm: normalizeSpeech(result.pcm) }
    let began = false, progress = 0
    const begin = () => {
      if (!current() || began) return
      began = true; this.hooks.playbackBlocked(false); started(); this.hooks.playbackStarted(); reportProgress(0)
    }
    const updateProgress = (value: number) => { progress = value; reportProgress(value) }
    if (this.museTalkEnabled && current()) {
      try {
        await this.museTalk.play(result.pcm, result.sampleRate, current, begin, updateProgress)
        return
      } catch {
        if (!current()) return
        this.museTalkEnabled = false
        this.hooks.notice('MuseTalk 영상 연결에 실패해 음성으로 대화를 이어갑니다.')
      }
    }
    if (!current()) return
    await this.playAudio(result, current, begin, updateProgress, progress)
  }
  private playAudio(result: Result, current: () => boolean, started: () => void, reportProgress: (progress: number) => void, from = 0): Promise<void> {
    const audio = this.audio
    if (!audio || !current()) return Promise.resolve()
    const offset = Math.min(result.pcm.length - 1, Math.floor(result.pcm.length * Math.max(0, Math.min(1, from))))
    this.url = URL.createObjectURL(new Blob([wav(result.pcm.subarray(offset), result.sampleRate)], { type: 'audio/wav' }))
    audio.srcObject = null; audio.src = this.url; audio.muted = false
    return new Promise((resolve, reject) => {
      let began = false, settled = false
      let progressFrame = 0
      const cleanup = () => {
        cancelAnimationFrame(progressFrame)
        audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); audio.removeEventListener('playing', playing)
        this.cancelPlayback = undefined
      }
      const ended = () => { if (settled) return; settled = true; reportProgress(1); cleanup(); resolve() }
      const failed = () => { if (settled) return; settled = true; cleanup(); reject(new Error('음성을 재생하지 못했습니다.')) }
      const updateProgress = () => {
        if (!current() || audio.paused || audio.ended) return
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          const leadSeconds = 0.06
          reportProgress(Math.max(0, Math.min(1, from + (1 - from) * (audio.currentTime + leadSeconds) / audio.duration)))
        }
        progressFrame = requestAnimationFrame(updateProgress)
      }
      const playing = () => {
        if (!current() || began) return
        began = true; this.hooks.playbackBlocked(false); started(); reportProgress(from)
        progressFrame = requestAnimationFrame(updateProgress)
      }
      this.cancelPlayback = ended
      audio.addEventListener('ended', ended); audio.addEventListener('error', failed); audio.addEventListener('playing', playing)
      void audio.play().catch(error => {
        if (!current()) { ended(); return }
        if (error.name === 'NotAllowedError') this.hooks.playbackBlocked(true)
        else failed()
      })
    })
  }
}

function normalizeSpeech(pcm: Float32Array): Float32Array {
  const silenceFloor = 0.01
  const targetRms = 0.1 // -20 dBFS over active speech samples
  const maxGain = 4
  const peakLimit = 0.92
  let sumSquares = 0
  let activeSamples = 0
  let peak = 0

  for (const sample of pcm) {
    const amplitude = Math.abs(sample)
    peak = Math.max(peak, amplitude)
    if (amplitude >= silenceFloor) {
      sumSquares += sample * sample
      activeSamples++
    }
  }
  if (!activeSamples || peak === 0) return pcm

  const rms = Math.sqrt(sumSquares / activeSamples)
  const gain = Math.min(targetRms / rms, maxGain, peakLimit / peak)
  return Float32Array.from(pcm, sample => sample * gain)
}

function wav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true)
  pcm.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767), true))
  return buffer
}
