import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto((process.env.TEST_URL || 'http://localhost:5174') + '/#conversation');
  const results = await page.evaluate(async () => {
    const { PiperClient } = await import('/src/piper/client.ts');
    const results = [];
    for (const mode of ['wasm', 'auto']) {
      const voice = new PiperClient(() => {});
      try {
        const result = await voice.synthesize('Ah, hey, see, go, blue. My voice sounds natural.', mode);
        results.push({ mode, samples: result.pcm.length, sampleRate: result.sampleRate,
          seconds: result.pcm.length / result.sampleRate, backend: result.backend,
          rms: Math.sqrt(result.pcm.reduce((sum, value) => sum + value * value, 0) / result.pcm.length),
          inferenceMs: result.inferenceMs, cues: result.visemes });
      } finally { voice.stop(); }
    }
    return results;
  });
  for (const result of results) {
    assert.ok(result.rms > .001 && result.seconds > 1, 'Real Piper PCM must remain audible');
    assert.ok(result.cues.length > 10, 'Model must return its actual phoneme durations');
    assert.equal(result.cues[0].start, 0);
    assert.ok(Math.abs(result.cues.at(-1).end - result.seconds) < 1 / result.sampleRate, 'Visemes must cover exactly the generated audio');
    const shapes = new Set(result.cues.map(cue => cue.shape));
    for (const shape of ['a', 'e', 'i', 'o', 'u', 'closed']) assert.ok(shapes.has(shape), 'Missing phonetic shape: ' + shape);
    for (let i = 0; i < result.cues.length; i++) {
      const cue = result.cues[i];
      assert.ok(cue.end > cue.start && Number.isFinite(cue.end));
      if (i) assert.ok(Math.abs(cue.start - result.cues[i - 1].end) < 1e-9, 'Cues must be contiguous');
    }
    console.log(JSON.stringify({ mode: result.mode, backend: result.backend, seconds: result.seconds,
      inferenceMs: Math.round(result.inferenceMs), cueCount: result.cues.length, shapes: [...shapes] }));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: real CPU/automatic Piper audio with sample-aligned phoneme durations and all five vowel shapes.');
} finally { await browser.close(); }
