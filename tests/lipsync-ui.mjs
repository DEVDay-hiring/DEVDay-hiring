import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto((process.env.TEST_URL || 'http://localhost:5174') + '/#conversation');
  await page.locator('.mvp-lipsync').waitFor();
  const result = await page.evaluate(async () => {
    const { MuseTalkClient } = await import('/src/lipsync/client.ts');
    const OriginalSocket = window.WebSocket;
    const sockets = [];
    class FakeSocket extends EventTarget {
      constructor(url) {
        super(); this.url = url; this.bufferedAmount = 0; this.sent = []; this.closed = false;
        sockets.push(this);
        setTimeout(() => {
          if (!this.closed) this.dispatchEvent(new Event('open'));
        }, 0);
      }
      send(data) {
        this.sent.push(data);
        const total = this.sent.filter(item => item instanceof ArrayBuffer).reduce((sum, item) => sum + item.byteLength, 0);
        if (data instanceof ArrayBuffer && total >= 12800 && !this.firstChunkSent) {
          this.firstChunkSent = true; void this.respond(0);
        }
        if (typeof data === 'string' && JSON.parse(data).type === 'end') {
          setTimeout(() => { if (!this.closed) void this.respond(1); }, 450);
        }
      }
      close() {
        if (this.closed) return;
        this.closed = true;
        this.dispatchEvent(new Event('close'));
        this.onclose?.();
      }
      async respond(sequence) {
        const bytes = this.sent.filter(data => data instanceof ArrayBuffer);
        const audio = new Uint8Array(bytes.reduce((count, data) => count + data.byteLength, 0));
        let offset = 0;
        for (const data of bytes) { audio.set(new Uint8Array(data), offset); offset += data.byteLength; }
        const packet = (header, payload) => {
          const json = new TextEncoder().encode(JSON.stringify(header));
          const output = new Uint8Array(4 + json.length + payload.length);
          new DataView(output.buffer).setUint32(0, json.length, false);
          output.set(json, 4); output.set(payload, 4 + json.length);
          return output.buffer;
        };
        const frame = document.createElement('canvas'); frame.width = 32; frame.height = 32;
        const drawing = frame.getContext('2d'); drawing.fillStyle = '#e02020'; drawing.fillRect(0, 0, 32, 32);
        const jpeg = new Uint8Array(await (await new Promise(resolve => frame.toBlob(resolve, 'image/jpeg'))).arrayBuffer());
        const section = audio.slice(sequence * 12800, (sequence + 1) * 12800);
        this.onmessage?.({ data: packet({ type: 'audio', pts: sequence * 0.4, samples: section.byteLength / 2 }, section) });
        for (let i = 0; i < 10; i++) {
          this.onmessage?.({ data: packet({ type: 'frame', pts: sequence * 0.4 + i / 25, frame_index: sequence * 10 + i }, jpeg) });
        }
        if (sequence === 1) {
          this.onmessage?.({ data: JSON.stringify({ type: 'complete' }) });
          this.close();
        }
      }
    }
    window.WebSocket = FakeSocket;
    const stage = document.querySelector('.mvp-video');
    const canvas = document.querySelector('.mvp-lipsync');
    const active = [], progress = [], audioStates = [];
    const client = new MuseTalkClient('ws://mock.test/stream', value => {
      active.push(value); stage.classList.toggle('has-lipsync', value);
    });
    client.attachCanvas(canvas);
    try {
      await client.resume();
      const context = client.context;
      context.onstatechange = () => audioStates.push(context.state);
      const samples = Float32Array.from({ length: 17640 }, (_, i) => Math.sin(i / 8) * 0.2);
      let starts = 0;
      await Promise.race([
        client.play(samples, 22050, () => true, () => { starts++; }, value => progress.push(value)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('MuseTalk playback timed out')), 8000)),
      ]);
      const pixel = [...canvas.getContext('2d').getImageData(16, 16, 1, 1).data];
      const first = sockets[0];
      const firstBytes = first.sent.filter(data => data instanceof ArrayBuffer).reduce((sum, data) => sum + data.byteLength, 0);
      const pending = client.play(new Float32Array(32000), 16000, () => true, () => {}, () => {});
      await new Promise(resolve => setTimeout(resolve, 100));
      client.stop(); await pending;
      return { active, starts, progress: progress.at(-1), pixel, firstBytes, audioStates,
        start: JSON.parse(first.sent[0]), firstClosed: first.closed, interruptedClosed: sockets[1].closed,
        visibleAfter: stage.classList.contains('has-lipsync') };
    } finally { client.dispose(); window.WebSocket = OriginalSocket; }
  });
  assert.deepEqual(result.active.slice(0, 2), [true, false]);
  assert.equal(result.starts, 1);
  assert.equal(result.progress, 1);
  assert.ok(result.pixel[0] > 150 && result.pixel[1] < 100);
  assert.equal(result.firstBytes, 25600);
  assert.ok(result.audioStates.includes('suspended') && result.audioStates.includes('running'));
  assert.deepEqual(result.start, { type: 'start', format: 'pcm_s16le', sample_rate: 16000, channels: 1 });
  assert.equal(result.firstClosed, true);
  assert.equal(result.interruptedClosed, true);
  assert.equal(result.visibleAfter, false);
  assert.deepEqual(errors, []);
  const fallback = await page.evaluate(async () => {
    const { PiperSpeech } = await import('/src/piper/speech.ts');
    const OriginalSocket = window.WebSocket;
    window.WebSocket = class extends EventTarget {
      constructor() { super(); setTimeout(() => this.dispatchEvent(new Event('error')), 0); }
      close() { this.dispatchEvent(new Event('close')); this.onclose?.(); }
    };
    const voice = new PiperSpeech();
    const audio = document.createElement('audio');
    const notices = [], noop = () => {};
    voice.attachAudio(audio);
    voice.attachVideo(document.querySelector('.mvp-lipsync'));
    voice.configure('wasm', { status: noop, notice: message => notices.push(message), backend: noop,
      progress: noop, playbackBlocked: noop, playbackStarted: noop, playback: noop, videoActive: noop });
    try {
      const pcm = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 8) * 0.2);
      let started = 0;
      await voice.play({ pcm, sampleRate: 16000 }, () => true, () => started++, noop);
      return { started, blob: audio.src.startsWith('blob:'), notice: notices.at(-1) };
    } finally { voice.dispose(); window.WebSocket = OriginalSocket; }
  });
  assert.equal(fallback.started, 1);
  assert.equal(fallback.blob, true);
  assert.match(fallback.notice, /MuseTalk 영상 연결에 실패/);
  const partialFallback = await page.evaluate(async () => {
    const { PiperSpeech } = await import('/src/piper/speech.ts');
    const voice = new PiperSpeech();
    const audio = document.createElement('audio');
    const notices = [], progress = [], noop = () => {};
    let starts = 0, playbackStarts = 0, normalizedRms = 0;
    voice.attachAudio(audio);
    voice.attachVideo(document.querySelector('.mvp-lipsync'));
    voice.configure('wasm', { status: noop, notice: message => notices.push(message), backend: noop,
      progress: noop, playbackBlocked: noop, playbackStarted: () => playbackStarts++, playback: noop, videoActive: noop });
    voice.museTalk.play = async (pcm, _sampleRate, _current, started, reportProgress) => {
      normalizedRms = Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
      started(); reportProgress(0.5);
      throw new Error('Stream interrupted halfway');
    };
    try {
      const pcm = Float32Array.from({ length: 12800 }, (_, i) => Math.sin(i / 8) * 0.5);
      await voice.play({ pcm, sampleRate: 16000 }, () => true, () => starts++, value => progress.push(value));
      const wav = new DataView(await (await fetch(audio.src)).arrayBuffer());
      let sumSquares = 0;
      for (let offset = 44; offset < wav.byteLength; offset += 2) sumSquares += (wav.getInt16(offset, true) / 32768) ** 2;
      return { starts, playbackStarts, normalizedRms, progress, notice: notices.at(-1),
        remainingSamples: wav.getUint32(40, true) / 2, fallbackRms: Math.sqrt(sumSquares / ((wav.byteLength - 44) / 2)) };
    } finally { voice.dispose(); }
  });
  assert.equal(partialFallback.starts, 1);
  assert.equal(partialFallback.playbackStarts, 1);
  assert.equal(partialFallback.remainingSamples, 6400);
  assert.ok(partialFallback.normalizedRms > 0.09 && partialFallback.normalizedRms < 0.11);
  assert.ok(Math.abs(partialFallback.normalizedRms - partialFallback.fallbackRms) < 0.002);
  assert.equal(partialFallback.progress.at(-1), 1);
  assert.ok(partialFallback.progress.length > 4, 'fallback captions should keep updating during playback');
  assert.ok(partialFallback.progress.every((value, index, values) => index === 0 || value >= values[index - 1]));
  assert.match(partialFallback.notice, /MuseTalk 영상 연결에 실패/);
  assert.deepEqual(errors, []);
  console.log('PASS: MuseTalk PCM/JPEG playback, delayed chunks, interruption, normalized audio and partial Piper fallback.');
} finally { await browser.close(); }
