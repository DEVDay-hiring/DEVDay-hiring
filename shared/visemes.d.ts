export type Viseme = 'neutral' | 'closed' | 'a' | 'e' | 'i' | 'o' | 'u'
export type VisemeCue = { shape: Viseme; start: number; end: number }
export function visemeFor(phoneme: string): Viseme
export function phonemeTimeline(ids: number[], durations: ArrayLike<number> | undefined,
  idMap: Record<string, number[]>, samples: number, sampleRate: number, hopLength: number): VisemeCue[]
export function visemeAt(cues: VisemeCue[], time: number): { from: Viseme; to: Viseme; mix: number }
