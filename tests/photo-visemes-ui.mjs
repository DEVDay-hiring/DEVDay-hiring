import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto((process.env.TEST_URL || 'http://localhost:5174') + '/#conversation');
  const result = await page.evaluate(async () => {
    const { PhotoLipSync } = await import('/src/lipsync/photo.ts');
    const check = (value, message) => { if (!value) throw new Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async condition => {
      const end = performance.now() + 2000;
      while (!condition()) { if (performance.now() > end) throw new Error('Viseme test timed out'); await sleep(10); }
    };
    // Colored mouth patches make the choice and blending of every supplied asset measurable.
    const fixture = color => {
      const image = document.createElement('canvas'); image.width = 80; image.height = 60;
      const context = image.getContext('2d');
      context.fillStyle = '#efdfcf'; context.fillRect(0, 0, 80, 60);
      context.fillStyle = color; context.fillRect(30, 35, 20, 10);
      return image.toDataURL('image/png');
    };
    const shapes = ['a', 'e', 'i', 'o', 'u'];
    const colors = ['#ee2020', '#20ee20', '#2020ee', '#eeee20', '#ee20ee'];
    const avatar = { frames: [fixture('#101010'), fixture('#555555'), fixture('#aaaaaa')], mouth: [30, 35, 20, 10],
      vowels: Object.fromEntries(shapes.map((shape, i) => [shape, [fixture('#333333'), fixture(colors[i])]])) };
    const canvas = document.createElement('canvas'), active = [];
    const client = new PhotoLipSync(value => active.push(value), avatar);
    const rate = 22050;
    const pcm = Float32Array.from({ length: rate * 4 }, (_, i) => Math.sin(i / 8) * (i / rate < 3 ? .3 : 0));
    const cues = shapes.map((shape, i) => ({ shape, start: i * .5, end: (i + 1) * .5 }));
    cues.push({ shape: 'closed', start: 2.5, end: 3 }, { shape: 'a', start: 3, end: 4 });
    let clock = .25;
    client.attachCanvas(canvas);
    try {
      await client.prepare();
      await waitFor(() => client.vowelImages.size === 10);
      const done = client.play(pcm, rate, () => true, () => clock, cues);
      const seen = [];
      const pixel = (x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
      for (let i = 0; i < shapes.length; i++) {
        clock = i * .5 + .25;
        await waitFor(() => canvas.dataset.viseme === shapes[i] && canvas.dataset.mouthState === 'open');
        const actual = pixel(40, 40);
        const expected = colors[i].slice(1).match(/../g).map(hex => parseInt(hex, 16));
        check(expected.every((value, channel) => actual[channel] === value), 'Wrong vowel image rendered: ' + shapes[i]);
        check(pixel(0, 0).join(',') === '239,223,207,255', 'Background must remain fixed');
        seen.push(canvas.dataset.viseme);
      }
      clock = .5;
      await waitFor(() => {
        const blended = pixel(40, 40);
        return blended[0] > 80 && blended[1] > 80 && blended[2] < 50;
      });
      const blend = pixel(40, 40);
      check(blend[0] > 80 && blend[1] > 80 && blend[2] < 50, 'Boundary must blend a/e instead of flashing a third mouth');
      clock = 2.75;
      await waitFor(() => canvas.dataset.mouthState === 'closed');
      check(pixel(40, 40)[0] === 16, 'Voiced m/b/p must still close the lips');
      clock = 3.5;
      await waitFor(() => canvas.dataset.mouthState === 'closed');
      check(pixel(40, 40)[0] === 16, 'Silence must override a vowel');
      clock = null;
      await waitFor(() => canvas.dataset.mouthState === 'closed');
      check(canvas.dataset.mouthState === 'closed', 'Pause must close the mouth');
      clock = 1.75;
      await waitFor(() => canvas.dataset.viseme === 'o');
      clock = 4; await done;
      check(active.at(-1) === false && !canvas.dataset.viseme, 'End must clear visual state');

      // One vowel asset failure falls back to neutral frames without losing the rest of the avatar.
      const fallback = new PhotoLipSync(() => {}, { ...avatar, vowels: { a: ['data:image/png;base64,broken', 'data:image/png;base64,broken'] } });
      fallback.attachCanvas(canvas); clock = .25;
      const fallbackDone = fallback.play(pcm, rate, () => true, () => clock, cues);
      await waitFor(() => canvas.dataset.mouthState === 'open');
      check(canvas.dataset.viseme === 'neutral', 'Missing vowel must use the generic mouth');
      fallback.stop(); await fallbackDone; fallback.dispose();
      return { seen, blendedMouthPixel: blend, backgroundFixed: true, missingVowelFallback: true };
    } finally { client.dispose(); }
  });
  assert.deepEqual(result.seen, ['a', 'e', 'i', 'o', 'u']);
  console.log(JSON.stringify(result));
  console.log('PASS: five vowel assets, aperture, coarticulation, bilabial closure, silence, pause and missing-vowel fallback.');
} finally { await browser.close(); }
