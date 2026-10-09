const SAMPLE_RATE = 16000
const FPS = 25
const SEND_BYTES = 3200

type AudioChunk = { pts: number; duration: number; buffer: AudioBuffer; scheduled: boolean }
type Packet = { type: 'audio' | 'frame'; pts: number; samples?: number; frame_index?: number }
type Session = {
  socket: WebSocket | null
  frames: Map<number, ImageBitmap>
  chunks: AudioChunk[]
  sources: AudioBufferSourceNode[]
  base: number | null
  audioEnd: number
  duration: number
  lastFrame: number
  complete: boolean
  closed: boolean
  buffering: boolean
  started: boolean
  lastProgressAt: number
  raf: number
  timeout: ReturnType<typeof setTimeout> | null
  resolve: () => void
  reject: (error: Error) => void
  current: () => boolean
  onStart: () => void
  onProgress: (progress: number) => void
}

export class MuseTalkClient {
  private canvas: HTMLCanvasElement | null = null
  private context: AudioContext | null = null
  private session: Session | null = null

  constructor(private url: string, private onVideoActive: (active: boolean) => void) {}

  attachCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) this.stop()
    this.canvas = canvas
  }

  async resume() {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    await this.context.resume()
  }

  play(pcm: Float32Array, sampleRate: number, current: () => boolean,
    onStart: () => void, onProgress: (progress: number) => void): Promise<void> {
    this.stop()
    if (!this.canvas) return Promise.reject(new Error('MuseTalk 영상 화면이 준비되지 않았습니다.'))
    if (!current()) return Promise.resolve()
    const session: Session = {
      socket: null, frames: new Map(), chunks: [], sources: [], base: null, audioEnd: 0, duration: pcm.length / sampleRate,
      lastFrame: -1, complete: false, closed: false, buffering: false, started: false, lastProgressAt: 0,
      raf: 0, timeout: null, resolve: () => {}, reject: () => {}, current, onStart, onProgress,
    }
    this.session = session
    const done = new Promise<void>((resolve, reject) => { session.resolve = resolve; session.reject = reject })
    void this.run(session, pcm, sampleRate).catch(error => this.fail(session, error))
    return done
  }

  stop() {
    const session = this.session
    if (!session || session.closed) return
    this.cleanup(session)
    session.resolve()
  }

  dispose() {
    this.stop()
    if (this.context) void this.context.close()
    this.context = null
  }

  private cleanup(session: Session) {
    if (session.closed) return
    session.closed = true
    if (this.session === session) this.session = null
    if (session.timeout) clearTimeout(session.timeout)
    cancelAnimationFrame(session.raf)
    session.socket?.close()
    for (const source of session.sources) { try { source.stop() } catch { /* Already ended. */ } source.disconnect() }
    for (const frame of session.frames.values()) frame.close()
    session.frames.clear()
    this.onVideoActive(false)
  }

  private fail(session: Session, reason: unknown) {
    if (session.closed) return
    const error = reason instanceof Error ? reason : new Error(String(reason))
    this.cleanup(session)
    session.reject(error)
  }

  private async run(session: Session, pcm: Float32Array, sampleRate: number) {
    const bytes = await toPcm16(pcm, sampleRate)
    if (session.closed || !session.current()) return
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    void this.context.resume().catch(error => this.fail(session, error))
    const socket = new WebSocket(this.url)
    session.socket = socket
    socket.binaryType = 'arraybuffer'
    let receiving = Promise.resolve()
    socket.onmessage = event => {
      receiving = receiving.then(() => this.receive(session, event.data)).catch(error => this.fail(session, error))
    }
    socket.onclose = () => {
      // JPEG decoding may still be queued when the server closes after complete.
      receiving = receiving.then(() => {
        if (!session.closed && !session.complete) this.fail(session, new Error('MuseTalk 연결이 종료되었습니다.'))
      }).catch(error => this.fail(session, error))
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MuseTalk 서버 연결 시간이 초과되었습니다.')), 5000)
      const clear = () => clearTimeout(timeout)
      socket.addEventListener('open', () => { clear(); resolve() }, { once: true })
      socket.addEventListener('error', () => { clear(); reject(new Error('MuseTalk 서버에 연결하지 못했습니다.')) }, { once: true })
      socket.addEventListener('close', () => { clear(); reject(new Error('MuseTalk 서버에 연결하지 못했습니다.')) }, { once: true })
    })
    if (session.closed || !session.current()) return
    socket.send(JSON.stringify({ type: 'start', format: 'pcm_s16le', sample_rate: SAMPLE_RATE, channels: 1 }))
    session.timeout = setTimeout(() => this.fail(session, new Error('MuseTalk 영상 생성 시간이 초과되었습니다.')), 45000)
    session.raf = requestAnimationFrame(() => this.tick(session))
    const sentAt = performance.now()
    for (let offset = 0; offset < bytes.byteLength; offset += SEND_BYTES) {
      while (!session.closed && socket.bufferedAmount > 65536) await delay(10)
      if (session.closed || !session.current()) return
      socket.send(bytes.slice(offset, offset + SEND_BYTES))
      await delay(Math.max(0, sentAt + (offset + SEND_BYTES) / 32 - performance.now()))
    }
    if (!session.closed) socket.send(JSON.stringify({ type: 'end' }))
  }

  private async receive(session: Session, data: string | ArrayBuffer) {
    if (session.closed) return
    if (typeof data === 'string') {
      const message = JSON.parse(data)
      if (message.type === 'error') throw new Error(message.message || 'MuseTalk 영상 생성 실패')
      if (message.type === 'complete') {
        session.complete = true
        if (session.timeout) clearTimeout(session.timeout)
        session.timeout = null
        this.maybeBeginOrResume(session)
      }
      return
    }
    if (data.byteLength < 4) throw new Error('MuseTalk 패킷이 손상되었습니다.')
    const headerSize = new DataView(data).getUint32(0, false)
    if (headerSize > data.byteLength - 4) throw new Error('MuseTalk 패킷이 손상되었습니다.')
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, headerSize))) as Packet
    const payload = data.slice(4 + headerSize)
    if (header.type === 'audio') {
      const context = this.context!
      if (header.samples == null || payload.byteLength !== header.samples * 2) throw new Error('MuseTalk 음성 패킷이 손상되었습니다.')
      const buffer = context.createBuffer(1, header.samples, SAMPLE_RATE)
      const output = buffer.getChannelData(0), view = new DataView(payload)
      for (let i = 0; i < output.length; i++) output[i] = view.getInt16(i * 2, true) / 32768
      const chunk = { pts: header.pts, duration: header.samples / SAMPLE_RATE, buffer, scheduled: false }
      session.chunks.push(chunk)
      session.audioEnd = Math.max(session.audioEnd, chunk.pts + chunk.duration)
      this.scheduleAudio(session, chunk)
    } else if (header.type === 'frame') {
      while (!session.closed && session.frames.size >= 50) await delay(10)
      if (session.closed) return
      const frame = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
      if (session.closed) { frame.close(); return }
      session.frames.set(header.frame_index!, frame)
    }
    this.maybeBeginOrResume(session)
  }

  private audioCovers(session: Session, pts: number) {
    return session.chunks.some(chunk => chunk.pts <= pts + 0.001 && chunk.pts + chunk.duration > pts)
  }

  private scheduleAudio(session: Session, chunk: AudioChunk) {
    if (chunk.scheduled || session.base === null || session.closed) return
    const context = this.context!
    const source = context.createBufferSource()
    source.buffer = chunk.buffer
    source.connect(context.destination)
    const at = session.base + chunk.pts
    if (at < context.currentTime - 0.06) throw new Error('MuseTalk 음성 패킷이 재생 시각보다 늦게 도착했습니다.')
    source.start(Math.max(at, context.currentTime + 0.01))
    session.sources.push(source)
    chunk.scheduled = true
  }

  private maybeBeginOrResume(session: Session) {
    if (session.closed || !this.context) return
    if (session.base === null && session.frames.has(0) && this.audioCovers(session, 0)) {
      session.base = this.context.currentTime + 0.24
      for (const chunk of session.chunks) this.scheduleAudio(session, chunk)
    }
    if (session.buffering && session.base !== null) {
      const pts = Math.max(0, this.context.currentTime - session.base)
      if ((session.complete && pts >= session.audioEnd)
        || (session.frames.has(Math.floor(pts * FPS)) && this.audioCovers(session, pts))) {
        session.buffering = false
        void this.context.resume().catch(error => this.fail(session, error))
      }
    }
  }

  private tick(session: Session) {
    if (session.closed || !this.context || !session.current()) return
    try {
      const context = this.context
      if (session.base !== null && context.state === 'running') {
        const pts = context.currentTime - session.base
        if (pts >= 0 && !session.started) { session.started = true; session.onStart() }
        if (session.started && performance.now() - session.lastProgressAt > 80) {
          session.lastProgressAt = performance.now()
          session.onProgress(Math.min(1, Math.max(0, pts / session.duration)))
        }
        if (session.complete && pts >= session.audioEnd) {
          session.onProgress(1)
          this.cleanup(session)
          session.resolve()
          return
        }
        if (pts >= 0 && !session.buffering) {
          const index = Math.floor(pts * FPS)
          for (const [oldIndex, frame] of session.frames) {
            if (oldIndex < index) { frame.close(); session.frames.delete(oldIndex) }
          }
          const frame = session.frames.get(index)
          if (!frame || !this.audioCovers(session, pts)) {
            session.buffering = true
            void context.suspend().then(() => this.maybeBeginOrResume(session)).catch(error => this.fail(session, error))
          } else if (frame && index !== session.lastFrame && this.canvas) {
            if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
              this.canvas.width = frame.width; this.canvas.height = frame.height
            }
            this.canvas.getContext('2d')?.drawImage(frame, 0, 0)
            session.lastFrame = index
            if (index === 0) this.onVideoActive(true)
          }
        }
      }
      session.raf = requestAnimationFrame(() => this.tick(session))
    } catch (error) { this.fail(session, error) }
  }
}

async function toPcm16(pcm: Float32Array, sampleRate: number): Promise<ArrayBuffer> {
  if (!pcm.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Piper 음성 형식이 올바르지 않습니다.')
  let samples = pcm
  if (sampleRate !== SAMPLE_RATE) {
    const offline = new OfflineAudioContext(1, Math.ceil(pcm.length * SAMPLE_RATE / sampleRate), SAMPLE_RATE)
    const buffer = offline.createBuffer(1, pcm.length, sampleRate)
    buffer.getChannelData(0).set(pcm)
    const source = offline.createBufferSource()
    source.buffer = buffer; source.connect(offline.destination); source.start()
    samples = (await offline.startRendering()).getChannelData(0)
  }
  const output = new ArrayBuffer(samples.length * 2), view = new DataView(output)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return output
}

function delay(ms: number) { return new Promise<void>(resolve => setTimeout(resolve, ms)) }
