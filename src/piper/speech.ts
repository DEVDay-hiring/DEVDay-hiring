import { SpeechQueue } from '../../shared/speech-queue.js'
import { PiperClient, type Result } from './client'

type Hooks = {
  status(status: string): void
  notice(message: string): void
  backend(backend: string): void
  progress(message: string): void
  playbackBlocked(blocked: boolean): void
  playbackStarted(): void
}
const noop = () => {}
const empty: Hooks = { status: noop, notice: noop, backend: noop, progress: noop, playbackBlocked: noop, playbackStarted: noop }

// Realtime handles microphone input and text; this adapter owns all audible output.
export class PiperSpeech {
  private hooks = empty
  private audio: HTMLAudioElement | null = null
  private url?: string
  private cancelPlayback?: () => void
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
    play: (result, current, started) => this.play(result, current, started),
    stopAudio: () => this.stopAudio(),
    status: status => { if (status === 'idle') this.hooks.progress(''); this.hooks.status(status) },
    notice: message => this.hooks.notice(message),
  })
  get busy() { return this.queue.busy }
  attachAudio(node: HTMLAudioElement | null) { if (!node) this.stopAudio(); this.audio = node }
  configure(mode: string, hooks: Hooks) { this.hooks = hooks; this.engine.reset(); this.queue.configure(mode) }
  append(itemId: string, responseId: string, delta: string) { this.queue.append(itemId, responseId, delta) }
  completeItem(itemId: string, responseId: string, text: string) { this.queue.completeItem(itemId, responseId, text) }
  finish(responseId: string) { this.queue.finish(responseId) }
  interrupt() { this.queue.interrupt(); this.hooks.progress(''); this.hooks.playbackBlocked(false) }
  dispose() { this.queue.dispose(); this.hooks = empty }
  async resume() {
    if (!this.audio?.src) return
    try { await this.audio.play(); this.hooks.playbackBlocked(false) }
    catch { this.hooks.playbackBlocked(true) }
  }
  private stopAudio() {
    this.cancelPlayback?.(); this.cancelPlayback = undefined
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load() }
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = undefined
  }
  private play(result: Result, current: () => boolean, started: () => void): Promise<void> {
    this.stopAudio()
    const audio = this.audio
    if (!audio || !current()) return Promise.resolve()
    this.url = URL.createObjectURL(new Blob([wav(result.pcm, result.sampleRate)], { type: 'audio/wav' }))
    audio.srcObject = null; audio.src = this.url; audio.muted = false
    return new Promise((resolve, reject) => {
      let began = false, settled = false
      const cleanup = () => {
        audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); audio.removeEventListener('playing', playing)
        this.cancelPlayback = undefined
      }
      const ended = () => { if (settled) return; settled = true; cleanup(); resolve() }
      const failed = () => { if (settled) return; settled = true; cleanup(); reject(new Error('음성을 재생하지 못했습니다.')) }
      const playing = () => {
        if (!current() || began) return
        began = true; this.hooks.playbackBlocked(false); started(); this.hooks.playbackStarted()
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
