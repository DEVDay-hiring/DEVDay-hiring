import closed from '../assets/photo-trump/closed.webp'
import small from '../assets/photo-trump/small.webp'
import open from '../assets/photo-trump/open.webp'

export const photoFrames = [closed, small, open] as const
const FPS = 25
const STATES = ['closed', 'small', 'open'] as const

// Energy-driven mouth poses, not phoneme recognition. No audio is changed or delayed.
export function mouthCues(pcm: Float32Array, sampleRate: number): Uint8Array {
  if (!pcm.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid speech PCM')
  const cues = new Uint8Array(Math.ceil(pcm.length / sampleRate * FPS))
  let level = 0, state = 0
  for (let frame = 0; frame < cues.length; frame++) {
    const start = Math.floor(frame * sampleRate / FPS)
    const end = Math.min(pcm.length, Math.floor((frame + 1) * sampleRate / FPS))
    let squares = 0
    for (let index = start; index < end; index++) squares += pcm[index] * pcm[index]
    const rms = Math.sqrt(squares / Math.max(1, end - start))
    level = rms < 0.008 ? 0 : level + (rms - level) * (rms > level ? 0.7 : 0.45)
    state = level < 0.018 ? 0 : level > 0.095 || (state === 2 && level > 0.07) ? 2 : 1
    cues[frame] = state
  }
  return cues
}

type Session = {
  closed: boolean
  raf: number
  pose: number
  resolve: () => void
  reject: (error: Error) => void
}

export class PhotoLipSync {
  private canvas: HTMLCanvasElement | null = null
  private images: Promise<HTMLImageElement[]> | null = null
  private session: Session | null = null

  constructor(private onVideoActive: (active: boolean) => void) {}

  attachCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) this.stop()
    this.canvas = canvas
    if (canvas) void this.prepare().catch(() => {})
  }

  private prepare() {
    if (!this.images) {
      this.images = Promise.all(photoFrames.map(async src => {
        const image = new Image()
        image.src = src
        await image.decode()
        return image
      })).then(images => {
        if (images.some(image => image.naturalWidth !== images[0].naturalWidth || image.naturalHeight !== images[0].naturalHeight)) {
          throw new Error('Mouth images must have matching dimensions')
        }
        return images
      }).catch(error => { this.images = null; throw error })
    }
    return this.images
  }

  play(pcm: Float32Array, sampleRate: number, current: () => boolean,
    playbackTime: () => number | null): Promise<void> {
    this.stop()
    if (!this.canvas) return Promise.reject(new Error('입 모양 화면이 준비되지 않았습니다.'))
    if (!current()) return Promise.resolve()
    const session: Session = { closed: false, raf: 0, pose: -1, resolve: () => {}, reject: () => {} }
    this.session = session
    const done = new Promise<void>((resolve, reject) => { session.resolve = resolve; session.reject = reject })
    void this.prepare().then(images => {
      if (session.closed) return
      const cues = mouthCues(pcm, sampleRate)
      const duration = pcm.length / sampleRate
      const tick = () => {
        if (session.closed) return
        try {
          if (!current()) { this.finish(session); return }
          const time = playbackTime()
          if (time !== null && time >= duration) { this.finish(session); return }
          const pose = time === null ? 0 : cues[Math.max(0, Math.min(cues.length - 1, Math.floor(time * FPS)))]
          if (pose !== session.pose && this.canvas) {
            const image = images[pose]
            if (this.canvas.width !== image.naturalWidth || this.canvas.height !== image.naturalHeight) {
              this.canvas.width = image.naturalWidth; this.canvas.height = image.naturalHeight
            }
            const context = this.canvas.getContext('2d')
            if (!context) throw new Error('Canvas unavailable')
            context.drawImage(image, 0, 0)
            this.canvas.dataset.mouthState = STATES[pose]
            if (session.pose === -1) this.onVideoActive(true)
            session.pose = pose
          }
          session.raf = requestAnimationFrame(tick)
        } catch (error) { this.fail(session, error) }
      }
      tick()
    }).catch(error => this.fail(session, error))
    return done
  }

  private cleanup(session: Session) {
    session.closed = true
    cancelAnimationFrame(session.raf)
    if (this.session === session) this.session = null
    if (this.canvas) delete this.canvas.dataset.mouthState
    if (session.pose !== -1) this.onVideoActive(false)
  }

  private finish(session: Session) {
    if (session.closed) return
    this.cleanup(session)
    session.resolve()
  }

  private fail(session: Session, error: unknown) {
    if (session.closed) return
    this.cleanup(session)
    session.reject(error instanceof Error ? error : new Error(String(error)))
  }

  stop() { if (this.session) this.finish(this.session) }
  dispose() { this.stop() }
}
