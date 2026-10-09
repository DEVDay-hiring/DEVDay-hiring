import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto((process.env.TEST_URL || 'http://localhost:5174') + '/#conversation');
  await page.locator('.mvp-lipsync').waitFor();
  const frames = await page.evaluate(async () => {
    const { MuseTalkClient } = await import('/src/lipsync/client.ts');
    const OriginalSocket = window.WebSocket, OriginalAudio = window.AudioContext;
    const originalDecode = window.createImageBitmap;
    const sockets = [], decoded = [], active = [];
    let clock = 0.4, holdNext = false, releaseDecode;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const waitFor = async predicate => {
      const end = performance.now() + 2000;
      while (!predicate()) {
        if (performance.now() > end) throw new Error('Video test condition timed out');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    class FakeSocket extends EventTarget {
      constructor() {
        super(); this.bufferedAmount = 0; this.sent = []; this.closed = false;
        sockets.push(this);
        setTimeout(() => { if (!this.closed) this.dispatchEvent(new Event('open')); }, 0);
      }
      send(data) { this.sent.push(data); }
      close() {
        if (this.closed) return;
        this.closed = true;
        this.dispatchEvent(new Event('close')); this.onclose?.();
      }
      receive(data) { this.onmessage?.({ data }); }
    }
    window.WebSocket = FakeSocket;
    window.AudioContext = class { constructor() { throw new Error('Video must not create an audio playback context'); } };
    window.createImageBitmap = async (...args) => {
      const image = await originalDecode(...args);
      decoded.push(image);
      if (holdNext) { holdNext = false; await new Promise(resolve => { releaseDecode = resolve; }); }
      return image;
    };
    const packet = (header, payload) => {
      const json = new TextEncoder().encode(JSON.stringify(header));
      const output = new Uint8Array(4 + json.length + payload.length);
      new DataView(output.buffer).setUint32(0, json.length, false);
      output.set(json, 4); output.set(payload, 4 + json.length);
      return output.buffer;
    };
    const jpeg = async color => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 32, 32);
      return new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'))).arrayBuffer());
    };
    const blue = await jpeg('#1020ee'), green = await jpeg('#10dd20'), red = await jpeg('#ee1020');
    const canvas = document.querySelector('.mvp-lipsync');
    const client = new MuseTalkClient('ws://mock.test/stream', value => active.push(value));
    client.attachCanvas(canvas);
    const send = (socket, index, payload) => socket.receive(packet({ type: 'frame', frame_index: index, pts: index / 25 }, payload));
    try {
      const done = client.play(new Float32Array(88200), 22050, () => true, () => clock);
      await waitFor(() => sockets[0]?.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'end'));
      const socket = sockets[0];
      const bytes = socket.sent.filter(value => value instanceof ArrayBuffer).reduce((sum, value) => sum + value.byteLength, 0);
      check(bytes === 128000, 'PCM must be resampled to 16k and uploaded ahead of playback');
      socket.receive(packet({ type: 'audio', samples: 999 }, new Uint8Array([1])));
      send(socket, 10, blue);
      await waitFor(() => client.session?.lastFrame === 10);
      check(active.at(-1) === true, 'Video must start even if frame zero was dropped');

      clock = 0.8;
      await waitFor(() => active.at(-1) === false);
      const before = decoded.length;
      send(socket, 0, new Uint8Array([1]));
      await new Promise(resolve => setTimeout(resolve, 30));
      check(decoded.length === before, 'Stale JPEG must be discarded before decoding');
      send(socket, 20, green); send(socket, 22, red);
      await waitFor(() => client.session?.lastFrame === 20 && client.session.frames.has(22));
      check(canvas.getContext('2d').getImageData(16, 16, 1, 1).data[1] > 150, 'Future frame must not display early');
      clock = 0.9;
      await waitFor(() => client.session?.lastFrame === 22);

      clock = 1; holdNext = true;
      send(socket, 25, blue);
      await waitFor(() => releaseDecode);
      const held = decoded.at(-1);
      for (let index = 26; index < 200; index++) send(socket, index, green);
      check(client.session.frames.size + client.session.pending.size <= 12, 'Packet and bitmap queues must stay bounded');
      clock = 2; releaseDecode(); releaseDecode = null;
      await waitFor(() => held.width === 0);
      check(client.session.lastFrame === 22, 'A frame becoming stale during decode must not be drawn');

      send(socket, 50, blue);
      socket.receive(JSON.stringify({ type: 'complete' })); socket.close();
      await waitFor(() => client.session?.lastFrame === 50);
      clock = 4; await done;
      check(active.at(-1) === false, 'Video must finish with the audio clock');

      clock = 0;
      const cancelled = client.play(new Float32Array(16000), 16000, () => true, () => clock);
      await waitFor(() => sockets.length === 2);
      holdNext = true; send(sockets[1], 0, red);
      await waitFor(() => releaseDecode);
      const cancelledImage = decoded.at(-1);
      client.stop(); await cancelled;
      const replacement = client.play(new Float32Array(16000), 16000, () => true, () => clock);
      await waitFor(() => sockets.length === 3);
      send(sockets[2], 0, green);
      await waitFor(() => client.session?.lastFrame === 0);
      releaseDecode(); releaseDecode = null;
      await waitFor(() => cancelledImage.width === 0);
      check(active.at(-1) === true, 'Old decoding must not hide a replacement session');
      client.stop(); await replacement;
      check(decoded.every(image => image.width === 0), 'All decoded bitmaps must be released');
      return { resampledBytes: bytes, socketsClosed: sockets.every(socket => socket.closed), active };
    } finally {
      releaseDecode?.(); client.dispose();
      window.WebSocket = OriginalSocket; window.AudioContext = OriginalAudio; window.createImageBitmap = originalDecode;
    }
  });
  assert.equal(frames.resampledBytes, 128000);
  assert.equal(frames.socketsClosed, true);
  assert.deepEqual(errors, []);

  const playback = await page.evaluate(async () => {
    const { PiperSpeech } = await import('/src/piper/speech.ts');
    const OriginalSocket = window.WebSocket, OriginalAudio = window.AudioContext;
    const results = [];
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const packet = (header, payload) => {
      const json = new TextEncoder().encode(JSON.stringify(header));
      const output = new Uint8Array(4 + json.length + payload.length);
      new DataView(output.buffer).setUint32(0, json.length, false);
      output.set(json, 4); output.set(payload, 4 + json.length);
      return output.buffer;
    };
    window.AudioContext = class { constructor() { throw new Error('Video must not replace local Piper audio'); } };
    try {
      for (const mode of ['late', 'error', 'busy', 'silent', 'no-open', 'blocked', 'interrupt']) {
        const sockets = [], notices = [], progress = [], blocked = [], timers = [];
        let started = 0, playbackStarts = 0, plays = 0, playingEvents = 0, midPauses = 0, active = true;
        let startedAt = null, videoAtAudioTime = null, inputRms = null, receivedBytes = 0;
        const audio = document.createElement('audio');
        const originalPlay = audio.play.bind(audio);
        audio.play = () => {
          plays++;
          if (mode === 'blocked' && plays === 1) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
          return originalPlay();
        };
        audio.addEventListener('playing', () => { playingEvents++; });
        audio.addEventListener('pause', () => { if (startedAt !== null && !audio.ended && active) midPauses++; });
        class FakeSocket extends EventTarget {
          constructor() {
            super(); this.sent = []; this.bufferedAmount = 0; this.closed = false; sockets.push(this);
            videoAtAudioTime = audio.currentTime;
            check(!audio.paused, 'Video must only start after audio playback starts');
            if (mode !== 'no-open') timers.push(setTimeout(() => {
              if (this.closed) return;
              this.dispatchEvent(new Event('open'));
              if (mode === 'busy') this.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'Worker busy' }) });
            }, 0));
          }
          send(data) {
            this.sent.push(data);
            if (data instanceof ArrayBuffer) receivedBytes += data.byteLength;
            if (typeof data !== 'string' || JSON.parse(data).type !== 'end') return;
            const bytes = this.sent.filter(value => value instanceof ArrayBuffer);
            let squares = 0, samples = 0;
            for (const chunk of bytes) {
              const view = new DataView(chunk);
              for (let offset = 0; offset < chunk.byteLength; offset += 2) { squares += (view.getInt16(offset, true) / 32768) ** 2; samples++; }
            }
            inputRms = Math.sqrt(squares / samples);
            if (mode === 'late' || mode === 'error') timers.push(setTimeout(() => {
              if (this.closed) return;
              if (mode === 'error') {
                this.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'GPU unavailable' }) });
                this.close();
              } else {
                this.onmessage?.({ data: packet({ type: 'frame', frame_index: 0, pts: 0 }, new Uint8Array([1])) });
                this.onmessage?.({ data: packet({ type: 'audio', samples: 500 }, new Uint8Array([1])) });
                this.onmessage?.({ data: JSON.stringify({ type: 'complete' }) });
                this.close();
              }
            }, 350));
          }
          close() {
            if (this.closed) return;
            this.closed = true;
            this.dispatchEvent(new Event('close')); this.onclose?.();
          }
        }
        window.WebSocket = FakeSocket;
        const voice = new PiperSpeech('musetalk'), noop = () => {};
        voice.attachAudio(audio); voice.attachVideo(document.querySelector('.mvp-lipsync'));
        voice.configure('wasm', { status: noop, notice: value => notices.push(value), backend: noop, progress: noop,
          playbackBlocked: value => blocked.push(value), playbackStarted: () => playbackStarts++, playback: noop, videoActive: noop });
        let timeout;
        try {
          const pcm = Float32Array.from({ length: 17640 }, (_, index) => Math.sin(index / 8) * 0.5);
          const began = performance.now();
          const done = voice.play({ pcm, sampleRate: 22050 }, () => active, () => {
            started++; startedAt = performance.now();
          }, value => progress.push(value));
          if (mode === 'blocked') {
            await sleep(70);
            check(blocked.includes(true) && sockets.length === 0, 'Blocked audio must not submit a video job');
            await voice.resume();
          }
          if (mode === 'interrupt') {
            await sleep(250); active = false; voice.interrupt();
          }
          await Promise.race([done, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Audio waited for video in mode ' + mode)), 2500);
          })]);
          const elapsedMs = performance.now() - began;
          check(started === 1 && playbackStarts === 1 && playingEvents === 1, 'Audio must play exactly once in mode ' + mode);
          check(plays === (mode === 'blocked' ? 2 : 1), 'Video must not restart audio in mode ' + mode);
          check(midPauses === 0, 'Video must not pause audio in mode ' + mode);
          check(sockets.length === 1 && sockets[0].closed, 'Audio completion must cancel unfinished video in mode ' + mode);
          check(audio.src.startsWith('blob:') || mode === 'interrupt', 'Piper must remain the audio source');
          if (mode !== 'interrupt') {
            check(audio.ended && progress.at(-1) === 1, 'Audio must finish independently in mode ' + mode);
            check(startedAt - began < 500, 'Audio start must not wait for GPU');
            check(performance.now() - startedAt < 1600, 'Audio duration must not grow with video latency');
            const wav = new DataView(await (await fetch(audio.src)).arrayBuffer());
            check(wav.getUint32(40, true) / 2 === pcm.length, 'Full original utterance must play without offset/restart');
            if (inputRms !== null) check(inputRms > 0.085 && inputRms < 0.115, 'Existing voice normalization must be retained');
          }
          if (mode === 'error' || mode === 'busy') check(notices.some(value => value.includes('음성은 계속')), 'Video errors must be reported without stopping audio');
          else check(notices.length === 0, 'Late or cancelled video must not report an audio failure');
          results.push({ mode, elapsedMs: Math.round(elapsedMs), plays, started, midPauses, videoAtAudioTime, receivedBytes });
        } finally {
          clearTimeout(timeout); timers.forEach(clearTimeout); voice.dispose();
        }
      }
      return results;
    } finally { window.WebSocket = OriginalSocket; window.AudioContext = OriginalAudio; }
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(playback, null, 2));
  console.log('PASS: audio-first playback, stale-frame dropping, bounded decoding, video failures, autoplay resume and interruption.');
} finally { await browser.close(); }
