const SAMPLE_RATE = 16000
const FPS = 25
const SEND_BYTES = 3200
const MAX_LATE_FRAMES = 2
const MAX_QUEUED_FRAMES = 12

type Session = {
  socket: WebSocket | null
  frames: Map<number, ImageBitmap>
  pending: Map<number, ArrayBuffer>
  decoding: boolean
  duration: number
  lastFrame: number
  visible: boolean
  complete: boolean
  closed: boolean
  raf: number
  timeout: ReturnType<typeof setTimeout> | null
  resolve: () => void
  reject: (error: Error) => void
  current: () => boolean
  playbackTime: () => number | null
}

export class MuseTalkClient {
  private canvas: HTMLCanvasElement | null = null
  private session: Session | null = null

  constructor(private url: string, private onVideoActive: (active: boolean) => void) {}

  attachCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) this.stop()
    this.canvas = canvas
  }

  // Audio owns the clock. Video never starts, pauses, or restarts audio playback.
  play(pcm: Float32Array, sampleRate: number, current: () => boolean,
    playbackTime: () => number | null): Promise<void> {
    this.stop()
    if (!this.canvas) return Promise.reject(new Error('MuseTalk 영상 화면이 준비되지 않았습니다.'))
    if (!current()) return Promise.resolve()
    const session: Session = {
      socket: null, frames: new Map(), pending: new Map(), decoding: false,
      duration: pcm.length / sampleRate, lastFrame: -1, visible: false,
      complete: false, closed: false, raf: 0, timeout: null,
      resolve: () => {}, reject: () => {}, current, playbackTime,
    }
    this.session = session
    const done = new Promise<void>((resolve, reject) => { session.resolve = resolve; session.reject = reject })
    session.raf = requestAnimationFrame(() => this.tick(session))
    void this.run(session, pcm, sampleRate).catch(error => this.fail(session, error))
    return done
  }

  stop() {
    if (this.session) this.finish(this.session)
  }

  dispose() { this.stop() }

  private show(session: Session, visible: boolean) {
    if (session.visible === visible) return
    session.visible = visible
    this.onVideoActive(visible)
  }

  private cleanup(session: Session) {
    if (session.closed) return
    session.closed = true
    if (this.session === session) this.session = null
    if (session.timeout) clearTimeout(session.timeout)
    cancelAnimationFrame(session.raf)
    session.socket?.close()
    for (const frame of session.frames.values()) frame.close()
    session.frames.clear()
    session.pending.clear()
    this.show(session, false)
  }

  private finish(session: Session) {
    if (session.closed) return
    this.cleanup(session)
    session.resolve()
  }

  private fail(session: Session, reason: unknown) {
    if (session.closed) return
    this.cleanup(session)
    session.reject(reason instanceof Error ? reason : new Error(String(reason)))
  }

  private async run(session: Session, pcm: Float32Array, sampleRate: number) {
    const bytes = await toPcm16(pcm, sampleRate)
    if (session.closed || !session.current()) return
    const socket = new WebSocket(this.url)
    session.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.onmessage = event => {
      try { this.receive(session, event.data) }
      catch (error) { this.fail(session, error) }
    }
    socket.onclose = () => {
      if (!session.closed && !session.complete) this.fail(session, new Error('MuseTalk 연결이 종료되었습니다.'))
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
    // Piper has already produced this PCM; upload ahead instead of pacing it behind audio.
    for (let offset = 0; offset < bytes.byteLength; offset += SEND_BYTES) {
      while (!session.closed && socket.bufferedAmount > 65536) await delay(10)
      if (session.closed || !session.current()) return
      socket.send(bytes.slice(offset, offset + SEND_BYTES))
    }
    if (!session.closed) socket.send(JSON.stringify({ type: 'end' }))
  }

  private minimumFrame(session: Session) {
    return Math.max(0, Math.ceil((session.playbackTime() ?? 0) * FPS - MAX_LATE_FRAMES))
  }

  private prune(session: Session) {
    const minimum = Math.max(this.minimumFrame(session), session.lastFrame + 1)
    for (const [index, frame] of session.frames) {
      if (index < minimum) { frame.close(); session.frames.delete(index) }
    }
    for (const index of session.pending.keys()) if (index < minimum) session.pending.delete(index)
    // Bound compressed packets and decoded bitmaps, keeping the nearest future frames.
    while (session.frames.size + session.pending.size > MAX_QUEUED_FRAMES) {
      const furthest = Math.max(...session.frames.keys(), ...session.pending.keys())
      session.frames.get(furthest)?.close()
      session.frames.delete(furthest)
      session.pending.delete(furthest)
    }
  }

  private receive(session: Session, data: string | ArrayBuffer) {
    if (session.closed) return
    if (!session.current()) { this.finish(session); return }
    if (typeof data === 'string') {
      const message = JSON.parse(data)
      if (message.type === 'error') throw new Error(message.message || 'MuseTalk 영상 생성 실패')
      if (message.type === 'complete') {
        session.complete = true
        if (session.timeout) clearTimeout(session.timeout)
        session.timeout = null
      }
      return
    }
    if (data.byteLength < 4) throw new Error('MuseTalk 패킷이 손상되었습니다.')
    const headerSize = new DataView(data).getUint32(0, false)
    if (headerSize > data.byteLength - 4) throw new Error('MuseTalk 패킷이 손상되었습니다.')
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, headerSize)))
    if (header.type !== 'frame') return // Server audio is ignored; Piper plays locally once.
    const index = header.frame_index
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('MuseTalk 프레임 번호가 올바르지 않습니다.')
    if (index < this.minimumFrame(session) || index <= session.lastFrame || session.frames.has(index)) return
    session.pending.set(index, data.slice(4 + headerSize))
    this.prune(session)
    void this.decode(session)
  }

  private async decode(session: Session) {
    if (session.decoding) return
    session.decoding = true
    try {
      while (!session.closed && session.pending.size) {
        const index = Math.min(...session.pending.keys())
        const payload = session.pending.get(index)!
        session.pending.delete(index)
        if (index < this.minimumFrame(session) || index <= session.lastFrame) continue
        const frame = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
        if (session.closed || !session.current() || index < this.minimumFrame(session) || index <= session.lastFrame) {
          frame.close()
          continue
        }
        session.frames.get(index)?.close()
        session.frames.set(index, frame)
        this.prune(session)
      }
    } catch (error) { this.fail(session, error) }
    finally { session.decoding = false }
  }

  private tick(session: Session) {
    if (session.closed) return
    if (!session.current()) { this.finish(session); return }
    try {
      const pts = session.playbackTime()
      if (pts !== null) {
        if (pts >= session.duration) { this.finish(session); return }
        this.prune(session)
        const index = Math.floor(pts * FPS)
        const available = [...session.frames.keys()].filter(value => value <= index)
        if (available.length && this.canvas) {
          const newest = Math.max(...available)
          const frame = session.frames.get(newest)!
          if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
            this.canvas.width = frame.width; this.canvas.height = frame.height
          }
          this.canvas.getContext('2d')?.drawImage(frame, 0, 0)
          session.lastFrame = newest
          this.show(session, true)
          this.prune(session)
        }
        if (session.lastFrame < this.minimumFrame(session)) this.show(session, false)
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
