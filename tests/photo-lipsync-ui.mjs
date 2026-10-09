import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installSyntheticPeer } from './synthetic-peer.mjs';

const base = process.env.TEST_URL || 'http://localhost:5174';
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  await mkdir('test-results', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ status: 201, contentType: 'application/sdp', body: 'synthetic SDP' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, apiKeyConfigured: true, knowledgeConfigured: true }) });
  });
  await installSyntheticPeer(page);
  await page.goto(base + '/#conversation');
  await page.locator('.mvp-lipsync').waitFor();
  const poses = await page.evaluate(async () => {
    const { PhotoLipSync, mouthCues } = await import('/src/lipsync/photo.ts');
    const { lipSyncMode } = await import('/src/lipsync/mode.ts');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const waitFor = async predicate => {
      const deadline = performance.now() + 3000;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Photo condition timed out');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    check(lipSyncMode === 'photo', 'Run the photo test with default/photo mode');
    const rate = 22050;
    const pcm = Float32Array.from({ length: rate * 2 }, (_, i) => {
      const t = i / rate;
      return Math.sin(i / 8) * (t < .4 || t >= 1.6 ? 0 : t < 1 ? .06 : .25);
    });
    for (const invalid of [0, -1, NaN]) {
      let rejected = false;
      try { mouthCues(pcm, invalid); } catch { rejected = true; }
      check(rejected, 'Invalid sample rate must be rejected');
    }
    check(mouthCues(pcm, rate).length === 50, 'Cues must cover the utterance at 25fps');
    const canvas = document.querySelector('.mvp-lipsync'), active = [];
    const client = new PhotoLipSync(value => active.push(value));
    let clock = 0, current = true;
    client.attachCanvas(canvas);
    try {
      const done = client.play(pcm, rate, () => current, () => clock);
      await waitFor(() => canvas.dataset.mouthState === 'closed');
      check(canvas.width === 880 && canvas.height === 660, 'Source photo dimensions must be preserved');
      const pixels = () => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const closed = pixels();
      check(closed.some((value, i) => i % 4 !== 3 && value > 100), 'Photo canvas must not be blank');
      clock = .7;
      await waitFor(() => canvas.dataset.mouthState === 'small');
      const small = pixels();
      clock = 1.3;
      await waitFor(() => canvas.dataset.mouthState === 'open');
      const open = pixels();
      const compare = (left, right) => {
        let mouth = 0, background = 0;
        for (let i = 0; i < left.length; i += 4) {
          if (left[i] === right[i] && left[i + 1] === right[i + 1] && left[i + 2] === right[i + 2]) continue;
          const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
          if (x >= 360 && x <= 510 && y >= 285 && y <= 385) mouth++;
          else background++;
        }
        check(mouth > 100, 'Mouth states must have visibly different pixels');
        check(background === 0, 'Head and background must be identical across poses');
        return mouth;
      };
      const changedPixels = [compare(closed, small), compare(small, open)];
      clock = null;
      await waitFor(() => canvas.dataset.mouthState === 'closed');
      clock = 1.3;
      await waitFor(() => canvas.dataset.mouthState === 'open');
      clock = 1.8;
      await waitFor(() => canvas.dataset.mouthState === 'closed');
      clock = 2; await done;
      check(active.at(-1) === false && !canvas.dataset.mouthState, 'End must restore the static portrait');

      // Image decoding may finish after a turn has already been replaced.
      const prepare = client.prepare.bind(client);
      let release;
      client.prepare = () => new Promise(resolve => { release = async () => resolve(await prepare()); });
      clock = .7;
      const old = client.play(pcm, rate, () => current, () => clock);
      client.stop(); await old;
      client.prepare = prepare;
      const replacement = client.play(pcm, rate, () => current, () => clock);
      await waitFor(() => canvas.dataset.mouthState === 'small');
      const events = active.length;
      await release(); await new Promise(resolve => setTimeout(resolve, 50));
      check(active.length === events && canvas.dataset.mouthState === 'small', 'Old image loading must not affect the new turn');
      current = false; await replacement;
      check(active.at(-1) === false, 'Interruption must stop the mouth animation');
      return { changedPixels, backgroundChangedPixels: 0, states: ['closed', 'small', 'open'] };
    } finally { client.dispose(); }
  });
  console.log(JSON.stringify(poses));

  const playback = await page.evaluate(async () => {
    const { PiperSpeech } = await import('/src/piper/speech.ts');
    const OriginalSocket = window.WebSocket, OriginalAudio = window.AudioContext;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const results = [];
    let sockets = 0, contexts = 0;
    window.WebSocket = class { constructor() { sockets++; throw new Error('Photo mode must not connect to a GPU server'); } };
    window.AudioContext = class { constructor() { contexts++; throw new Error('Photo mode must not replace audio playback'); } };
    try {
      for (const scenario of ['normal', 'slow-images', 'missing-image', 'blocked', 'interrupt', 'off']) {
        const audio = document.createElement('audio'), canvas = document.createElement('canvas');
        const voice = new PiperSpeech(scenario === 'off' ? 'off' : 'photo');
        const notices = [], active = [], blocked = [], seen = new Set();
        let plays = 0, starts = 0, midPauses = 0, current = true, release;
        const nativePlay = audio.play.bind(audio);
        audio.play = () => {
          plays++;
          if (scenario === 'blocked' && plays === 1) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
          return nativePlay();
        };
        audio.addEventListener('pause', () => { if (starts && !audio.ended && current) midPauses++; });
        const prepare = voice.video.prepare.bind(voice.video);
        if (scenario === 'slow-images') {
          const gate = new Promise(resolve => { release = resolve; });
          voice.video.prepare = async () => { await gate; return prepare(); };
        }
        if (scenario === 'missing-image') voice.video.prepare = () => Promise.reject(new Error('Image unavailable'));
        voice.attachAudio(audio); voice.attachVideo(canvas);
        const noop = () => {};
        voice.configure('wasm', { status: noop, notice: value => notices.push(value), backend: noop, progress: noop,
          playbackBlocked: value => blocked.push(value), playbackStarted: noop, playback: noop, videoActive: value => active.push(value) });
        const watch = setInterval(() => { if (canvas.dataset.mouthState) seen.add(canvas.dataset.mouthState); }, 10);
        let timeout;
        try {
          const pcm = Float32Array.from({ length: 26460 }, (_, i) => {
            const t = i / 22050;
            return Math.sin(i / 8) * (t < .24 || t >= .96 ? 0 : t < .56 ? .07 : .24);
          });
          const start = performance.now();
          const done = voice.play({ pcm, sampleRate: 22050 }, () => current, () => { starts++; }, noop);
          if (scenario === 'blocked') {
            await sleep(100);
            check(blocked.includes(true) && active.length === 0, 'Images must not animate before audio starts');
            await voice.resume();
          }
          if (scenario === 'interrupt') { await sleep(400); current = false; voice.interrupt(); }
          await Promise.race([done, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Audio waited for images: ' + scenario)), 2500);
          })]);
          const elapsedMs = Math.round(performance.now() - start);
          check(starts === 1 && plays === (scenario === 'blocked' ? 2 : 1), 'Audio must start exactly once: ' + scenario);
          check(midPauses === 0, 'Images must never pause audio: ' + scenario);
          if (scenario !== 'interrupt') {
            check(audio.ended, 'Entire audio must play: ' + scenario);
            const wav = new DataView(await (await fetch(audio.src)).arrayBuffer());
            check(wav.getUint32(40, true) / 2 === pcm.length, 'Full original utterance must remain intact');
          }
          if (scenario === 'normal' || scenario === 'blocked') check(seen.size === 3, 'Audio must animate all three mouth poses');
          if (scenario === 'missing-image') check(notices.some(value => value.includes('음성은 계속')), 'Image failure must be reported without stopping speech');
          else check(notices.length === 0, 'Unexpected photo error: ' + scenario);
          if (release) { release(); await sleep(100); }
          if (['slow-images', 'missing-image', 'off'].includes(scenario)) check(!active.includes(true), 'Unavailable/disabled images must remain static');
          else check(active.at(-1) === false, 'Completed audio must restore the static portrait');
          results.push({ scenario, elapsedMs, plays, midPauses, states: [...seen] });
        } finally { release?.(); clearTimeout(timeout); clearInterval(watch); voice.dispose(); }
      }
      check(sockets === 0 && contexts === 0, 'Photo mode must be local and share the original audio clock');
      return results;
    } finally { window.WebSocket = OriginalSocket; window.AudioContext = OriginalAudio; }
  });
  console.log(JSON.stringify(playback, null, 2));

  // Only Realtime is mocked. Use the actual Piper model and real browser audio for both viewports.
  await page.evaluate(async () => {
    const { PiperClient } = await import('/src/piper/client.ts');
    const synthesize = PiperClient.prototype.synthesize;
    PiperClient.prototype.synthesize = function(text) { return synthesize.call(this, text, 'wasm'); };
    window.photoTestSockets = 0;
    window.WebSocket = class { constructor() { window.photoTestSockets++; throw new Error('Photo mode opened a WebSocket'); } };
    window.photoTestStates = [];
    const canvas = document.querySelector('.mvp-lipsync');
    new MutationObserver(() => {
      if (canvas.dataset.mouthState) window.photoTestStates.push(canvas.dataset.mouthState);
    }).observe(canvas, { attributes: true, attributeFilter: ['data-mouth-state'] });
  });
  await page.getByRole('button', { name: '마이크 없이 텍스트로 시작' }).click();
  for (const [label, viewport] of [['desktop', { width: 1512, height: 982 }], ['mobile', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    if (label === 'mobile') {
      await page.locator('#conversation-input').fill('I enjoy learning English.');
      await page.getByRole('button', { name: 'Send ↗' }).click();
    }
    await page.waitForFunction(() => document.querySelector('.mvp-video.has-lipsync')
      && document.querySelector('.mvp-lipsync').dataset.mouthState === 'open'
      && document.querySelector('audio').currentTime > 0, null, { timeout: 120000 });
    await page.locator('.mvp-video').scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const video = document.querySelector('.mvp-video').getBoundingClientRect();
      const canvas = document.querySelector('.mvp-lipsync'), image = document.querySelector('.mvp-photo-portrait');
      const canvasRect = canvas.getBoundingClientRect(), imageRect = image.getBoundingClientRect();
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return { overflow: document.documentElement.scrollWidth > innerWidth, width: video.width, height: video.height,
        matchingFrames: Math.abs(canvasRect.width - imageRect.width) < 1 && Math.abs(canvasRect.height - imageRect.height) < 1
          && Math.abs(canvasRect.left - imageRect.left) < 1 && Math.abs(canvasRect.top - imageRect.top) < 1,
        nonblank: pixels.some((value, i) => i % 4 !== 3 && value > 100), sockets: window.photoTestSockets };
    });
    assert.equal(geometry.overflow, false, label + ': horizontal overflow');
    assert.equal(geometry.matchingFrames, true, label + ': static/animated portrait shifted');
    assert.equal(geometry.nonblank, true, label + ': blank canvas');
    assert.equal(geometry.sockets, 0, label + ': GPU connection attempted');
    await page.screenshot({ path: `test-results/photo-lipsync-${label}.png`, fullPage: true });
    console.log(JSON.stringify({ viewport: label, ...geometry }));
  }
  const states = await page.evaluate(() => [...new Set(window.photoTestStates)]);
  assert.deepEqual(states.sort(), ['closed', 'open', 'small']);
  await page.evaluate(() => window.syntheticPeer.channel.emit({ type: 'input_audio_buffer.speech_started', item_id: 'interrupt' }));
  await page.waitForFunction(() => !document.querySelector('.mvp-video.has-lipsync') && document.querySelector('audio').paused);
  assert.deepEqual(errors, []);
  console.log('PASS: photo poses, fixed-background pixels, current audio clock, independent playback, load failure, autoplay, interruption and real Piper desktop/mobile.');
} finally { await browser.close(); }
