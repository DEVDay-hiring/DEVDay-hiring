import closed from '../assets/photo-podium/closed.webp'
import small from '../assets/photo-podium/small.webp'
import open from '../assets/photo-podium/open.webp'
import aSmall from '../assets/photo-podium/a-small.webp'
import aOpen from '../assets/photo-podium/a-open.webp'
import eSmall from '../assets/photo-podium/e-small.webp'
import eOpen from '../assets/photo-podium/e-open.webp'
import iSmall from '../assets/photo-podium/i-small.webp'
import iOpen from '../assets/photo-podium/i-open.webp'
import oSmall from '../assets/photo-podium/o-small.webp'
import oOpen from '../assets/photo-podium/o-open.webp'
import uSmall from '../assets/photo-podium/u-small.webp'
import uOpen from '../assets/photo-podium/u-open.webp'
import { visemeAt, type Viseme, type VisemeCue } from '../../shared/visemes.js'

export const photoFrames = [closed, small, open] as const
type Vowel = Exclude<Viseme, 'closed' | 'neutral'>
export type PhotoAvatar = {
  frames: readonly [string, string, string]
  mouth: readonly [number, number, number, number]
  patches?: boolean
  vowels?: Partial<Record<Vowel, readonly [string, string]>>
}
export const photoAvatar: PhotoAvatar = {
  frames: photoFrames,
  mouth: [338, 111, 67, 51],
  patches: true,
  vowels: { a: [aSmall, aOpen], e: [eSmall, eOpen], i: [iSmall, iOpen], o: [oSmall, oOpen], u: [uSmall, uOpen] },
}
const FPS = 25
const STATES = ['closed', 'small', 'open'] as const

// Aperture comes from energy; the independent phoneme timeline controls lip shape.
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
  signature: string
  resolve: () => void
  reject: (error: Error) => void
}

export class PhotoLipSync {
  private canvas: HTMLCanvasElement | null = null
  private images: Promise<HTMLImageElement[]> | null = null
  private vowelImages = new Map<string, HTMLImageElement>()
  private loadingVowels = false
  private session: Session | null = null

  constructor(private onVideoActive: (active: boolean) => void, private avatar: PhotoAvatar = photoAvatar) {}

  attachCanvas(canvas: HTMLCanvasElement | null) {
    if (canvas !== this.canvas) this.stop()
    this.canvas = canvas
    if (canvas) void this.prepare().catch(() => {})
  }

  private prepare() {
    if (!this.images) {
      this.images = Promise.all(this.avatar.frames.map(async src => {
        const image = new Image()
        image.src = src
        await image.decode()
        return image
      })).then(images => {
        if (images.slice(1).some(image => !this.validMouthImage(image, images[0]))) {
          throw new Error('Mouth image dimensions do not match the avatar')
        }
        this.prepareVowels(images[0])
        return images
      }).catch(error => { this.images = null; throw error })
    }
    return this.images
  }

  private validMouthImage(image: HTMLImageElement, base: HTMLImageElement) {
    const width = this.avatar.patches ? this.avatar.mouth[2] : base.naturalWidth
    const height = this.avatar.patches ? this.avatar.mouth[3] : base.naturalHeight
    return image.naturalWidth === width && image.naturalHeight === height
  }

  private prepareVowels(base: HTMLImageElement) {
    if (this.loadingVowels) return
    this.loadingVowels = true
    for (const [shape, frames] of Object.entries(this.avatar.vowels || {})) {
      frames.forEach((src, index) => {
        const image = new Image()
        image.src = src
        void image.decode().then(() => {
          if (this.validMouthImage(image, base)) {
            this.vowelImages.set(`${shape}-${index + 1}`, image)
          }
        }).catch(() => { /* One missing vowel keeps the generic mouth and uninterrupted audio. */ })
      })
    }
  }

  play(pcm: Float32Array, sampleRate: number, current: () => boolean,
    playbackTime: () => number | null, visemes: VisemeCue[] = []): Promise<void> {
    this.stop()
    if (!this.canvas) return Promise.reject(new Error('입 모양 화면이 준비되지 않았습니다.'))
    if (!current()) return Promise.resolve()
    const session: Session = { closed: false, raf: 0, pose: -1, signature: '', resolve: () => {}, reject: () => {} }
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
          const position = Math.max(0, (time || 0) * FPS)
          const frame = Math.min(cues.length - 1, Math.floor(position))
          const aperture = time === null ? 0 : cues[frame] + (cues[Math.min(frame + 1, cues.length - 1)] - cues[frame]) * (position - frame)
          const phoneme = time === null ? { from: 'closed' as const, to: 'closed' as const, mix: 0 } : visemeAt(visemes, time)
          const weights = new Map<string, number>()
          const add = (key: string, weight: number) => {
            const resolved = key === 'closed' || key.startsWith('neutral-') || this.vowelImages.has(key) ? key : `neutral-${key.at(-1)}`
            if (weight > .001) weights.set(resolved, (weights.get(resolved) || 0) + weight)
          }
          const mouth = (shape: Viseme, weight: number) => {
            const amount = shape === 'closed' ? 0 : aperture
            add('closed', Math.max(0, 1 - amount) * weight)
            add(`${shape}-1`, (amount <= 1 ? amount : 2 - amount) * weight)
            add(`${shape}-2`, Math.max(0, amount - 1) * weight)
          }
          mouth(phoneme.from, 1 - phoneme.mix); mouth(phoneme.to, phoneme.mix)
          const layers = [...weights.entries()]
          const signature = layers.map(([key, weight]) => `${key}:${Math.round(weight * 100)}`).join(',')
          if (signature !== session.signature && this.canvas) {
            if (this.canvas.width !== images[0].naturalWidth || this.canvas.height !== images[0].naturalHeight) {
              this.canvas.width = images[0].naturalWidth; this.canvas.height = images[0].naturalHeight
            }
            const context = this.canvas.getContext('2d')
            if (!context) throw new Error('Canvas unavailable')
            const [x, y, width, height] = this.avatar.mouth
            context.globalAlpha = 1
            if (session.pose === -1) context.drawImage(images[0], 0, 0)
            let sum = 0
            // Blend only the mouth patch. Background pixels never participate in a crossfade.
            for (const [key, weight] of layers) {
              const image = this.vowelImages.get(key) || images[key === 'closed' ? 0 : Number(key.at(-1))]
              sum += weight; context.globalAlpha = weight / sum
              const isPatch = this.avatar.patches && key !== 'closed'
              context.drawImage(image, isPatch ? 0 : x, isPatch ? 0 : y, width, height, x, y, width, height)
            }
            context.globalAlpha = 1
            const dominant = layers.reduce((best, layer) => layer[1] > best[1] ? layer : best)[0]
            const pose = dominant === 'closed' ? 0 : Number(dominant.at(-1))
            this.canvas.dataset.mouthState = STATES[pose]
            this.canvas.dataset.viseme = dominant === 'closed' ? 'closed' : dominant.split('-')[0]
            if (session.pose === -1) this.onVideoActive(true)
            session.pose = pose
            session.signature = signature
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
    if (this.canvas) { delete this.canvas.dataset.mouthState; delete this.canvas.dataset.viseme }
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
