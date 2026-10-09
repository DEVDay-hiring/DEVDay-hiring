const VOWELS = [
  ['a', 'a\u0251\u0252\u028c\u0250'],
  ['e', 'e\u025b\u00e6\u0259\u025c\u0258'],
  ['i', 'i\u026a\u0268\u1d7byj'],
  ['o', 'o\u0254\u00f8\u0153'],
  ['u', 'u\u028a\u026f\u0289w'],
];
const MODIFIERS = /^[_\u02c8\u02cc\u02d0\u02d1\u02de\u02b2\u02b0\u02b7\u0300-\u036f]*$/u;

export function visemeFor(phoneme) {
  if (/^[bmp]$/.test(phoneme)) return 'closed';
  if (/^[\s^$.,!?;:]+$/.test(phoneme)) return 'neutral';
  return VOWELS.find(([, symbols]) => symbols.includes(phoneme) && phoneme.length > 0)?.[0] || 'neutral';
}

// Durations are the VITS mel-frame counts used for this exact generated utterance.
// Invalid or legacy metadata falls back to amplitude-only animation, never to an audio error.
export function phonemeTimeline(ids, durations, idMap, samples, sampleRate, hopLength) {
  if (!ids?.length || durations?.length !== ids.length || !idMap
    || !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(hopLength) || hopLength <= 0
    || !Number.isInteger(samples) || samples <= 0) return [];
  const symbols = new Map();
  for (const [symbol, values] of Object.entries(idMap)) {
    if (values.length === 1) symbols.set(values[0], symbol);
  }
  const anchors = [];
  let frame = 0;
  for (let i = 0; i < ids.length; i++) {
    const length = durations[i];
    if (!Number.isFinite(length) || length < 0 || !Number.isInteger(length)) return [];
    const start = frame * hopLength / sampleRate;
    frame += length;
    const end = frame * hopLength / sampleRate;
    const symbol = symbols.get(ids[i]);
    if (symbol === undefined) return [];
    if (end > start && !MODIFIERS.test(symbol)) anchors.push({ symbol, start, end });
  }
  if (!anchors.length || Math.abs(frame * hopLength - samples) > hopLength) return [];
  const total = samples / sampleRate;
  const cues = [];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    // Split padding/modifier time between its neighboring phonemes, not into fake silences.
    const start = i ? (anchors[i - 1].end + anchor.start) / 2 : 0;
    const end = Math.min(total, i + 1 < anchors.length ? (anchor.end + anchors[i + 1].start) / 2 : total);
    const letters = [...anchor.symbol].filter(letter => !MODIFIERS.test(letter));
    const shapes = letters.length > 1 && letters.every(letter => visemeFor(letter) !== 'neutral')
      ? letters.map(visemeFor) : [visemeFor(anchor.symbol)];
    for (let j = 0; j < shapes.length; j++) {
      const cue = { shape: shapes[j], start: start + (end - start) * j / shapes.length,
        end: start + (end - start) * (j + 1) / shapes.length };
      const previous = cues.at(-1);
      if (previous?.shape === cue.shape) previous.end = cue.end;
      else if (cue.end > cue.start) cues.push(cue);
    }
  }
  return cues;
}

// Coarticulation: a short, symmetric blend around a phoneme boundary. The audio clock
// determines the result directly, so dropped animation frames cannot accumulate lag.
export function visemeAt(cues, time) {
  if (!cues?.length || !Number.isFinite(time) || time < 0 || time >= cues.at(-1).end) {
    return { from: 'neutral', to: 'neutral', mix: 0 };
  }
  let low = 0, high = cues.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cues[mid].end <= time) low = mid + 1;
    else high = mid;
  }
  const current = cues[low];
  for (const boundary of [low - 1, low]) {
    const left = cues[boundary], right = cues[boundary + 1];
    if (!left || !right) continue;
    const half = Math.min(.035, (left.end - left.start) / 3, (right.end - right.start) / 3);
    const center = (left.end + right.start) / 2;
    if (half > 0 && time >= center - half && time <= center + half) {
      const t = (time - center + half) / (half * 2);
      return { from: left.shape, to: right.shape, mix: t * t * (3 - 2 * t) };
    }
  }
  return { from: current.shape, to: current.shape, mix: 0 };
}
