import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { installSyntheticPeer } from './synthetic-peer.mjs';

// Mock only Realtime transport/RAG. Piper phonemization, ONNX execution and
// browser audio decoding/playback all use the actual local Trump model.
const base = process.env.TEST_URL || 'http://localhost:3001';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
async function setup(mode = 'auto', configure = async () => {}) {
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [], downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\.onnx|\.wasm|phonemize\.data/.test(request.url())) downloads.push(request.url()); });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ status: 201, contentType: 'application/sdp', body: 'synthetic SDP' });
    const data = path === '/api/health' ? { apiKeyConfigured: true, knowledgeConfigured: true }
      : { resultCount: 1, results: [{ filename: 'AI.md', text: 'AI and Super Intelligence.', score: .9 }] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await installSyntheticPeer(page);
  await page.addInitScript(() => {
    window.piperEvents = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => {
        if (['backend', 'fallback', 'result'].includes(data.type)) window.piperEvents.push({ type: data.type, backend: data.backend });
      }); }
    };
  });
  await configure(page);
  await page.goto(base + '/#conversation');
  assert.equal(downloads.length, 0, 'model must not load before conversation starts');
  await page.getByLabel('Piper 트럼프 음성').selectOption(mode);
  await page.getByRole('button', { name: '마이크 없이 텍스트로 시작' }).click();
  await page.locator('.mvp-message.assistant').filter({ hasText: 'Hello!' }).waitFor();
  return { context, page, errors, downloads };
}
async function audio(page, label) {
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return (audio?.src.startsWith('blob:') && !audio.paused && audio.currentTime > 0) || document.querySelector('.mvp-voice-notice')?.textContent.includes('텍스트로 계속');
  }, null, { timeout: 120000 });
  assert.equal(await page.locator('.mvp-voice-notice').filter({ hasText: '텍스트로 계속' }).count(), 0, await page.locator('.mvp-voice-notice').allTextContents());
  const decoded = await page.evaluate(async () => {
    const audio = document.querySelector('audio'), ctx = new AudioContext();
    try {
      const data = await ctx.decodeAudioData(await (await fetch(audio.src)).arrayBuffer());
      const samples = data.getChannelData(0);
      return { channels: data.numberOfChannels, seconds: data.duration, rms: Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length), remoteStream: audio.srcObject !== null };
    } finally { await ctx.close(); }
  });
  assert.equal(decoded.channels, 1); assert.ok(decoded.seconds > .1 && decoded.rms > .001); assert.equal(decoded.remoteStream, false);
  console.log(`Verified audio: ${label}`);
  results.push({ label, ...decoded, backend: await page.evaluate(() => window.piperEvents.filter(e => e.type === 'result').at(-1)?.backend) });
}
async function send(page, text) {
  await page.locator('#conversation-input').fill(text); await page.getByRole('button', { name: 'Send ↗' }).click();
}
try {
  await fs.mkdir('test-results', { recursive: true });
  const gpu = await setup(); await audio(gpu.page, 'GPU conversation greeting');
  assert.ok(gpu.downloads.length > 0);
  await gpu.page.evaluate(() => window.syntheticPeer.channel.emit({ type: 'input_audio_buffer.speech_started', item_id: 'u' }));
  assert.equal(await gpu.page.evaluate(() => document.querySelector('audio').paused), true);
  await gpu.page.waitForTimeout(150);
  assert.equal(await gpu.page.evaluate(() => document.querySelector('audio').paused), true, 'cancelled sentence must not restart');
  assert.match(await gpu.page.locator('.mvp-message.assistant').first().innerText(), /발화 중단/);
  await gpu.page.evaluate(() => {
    window.syntheticPeer.channel.emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'u' });
    window.syntheticPeer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u', transcript: 'Hello again' });
  });
  await audio(gpu.page, 'new turn after voice interruption');
  await send(gpu.page, 'Why do people call it AI instead of SI?');
  await gpu.page.locator('.mvp-message.assistant').filter({ hasText: 'The uploaded reference discusses' }).waitFor();
  await audio(gpu.page, 'grounded RAG answer');
  await gpu.page.getByRole('tab', { name: /참고 기사/ }).click(); await gpu.page.getByRole('heading', { name: 'AI.md' }).waitFor();
  const events = await gpu.page.evaluate(() => window.syntheticEvents);
  assert.ok(events.some(e => e.item?.type === 'function_call_output'));
  assert.ok(events.filter(e => e.type === 'response.create').every(e => e.response.output_modalities[0] === 'text'));
  assert.equal(events.some(e => e.type === 'output_audio_buffer.clear'), false);
  await gpu.page.screenshot({ path: 'test-results/piper-conversation.png', fullPage: true });
  assert.deepEqual(gpu.errors, []); await gpu.context.close();

  const cpu = await setup('wasm'); await audio(cpu.page, 'CPU conversation'); assert.deepEqual(cpu.errors, []); await cpu.context.close();
  const recovery = await setup('auto', page => page.route('**/ort.webgpu.min*', route => route.abort('failed')));
  await audio(recovery.page, 'forced GPU failure → CPU conversation');
  await recovery.page.getByText('GPU 실행이 실패해 CPU로 다시 시도합니다.', { exact: true }).waitFor();
  assert.deepEqual(recovery.errors, []); await recovery.context.close();

  for (const [label, mode, pattern] of [['missing model', 'auto', '**/*.onnx'], ['CPU failure', 'wasm', '**/ort.wasm.min*']]) {
    const failed = await setup(mode, page => page.route(pattern, route => route.abort('failed')));
    await failed.page.getByText('음성을 사용할 수 없어 텍스트로 계속합니다. 자막을 확인하세요.', { exact: true }).waitFor({ timeout: 120000 });
    assert.equal(await failed.page.locator('#conversation-input').isEnabled(), true);
    await send(failed.page, 'I like learning English.');
    await failed.page.locator('.mvp-message.assistant').filter({ hasText: 'That sounds interesting.' }).waitFor();
    assert.equal(await failed.page.evaluate(() => document.querySelector('audio').paused), true);
    assert.deepEqual(failed.errors, []); results.push({ label, captionsContinue: true }); await failed.context.close();
  }
  const blocked = await setup('wasm', page => page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play; let first = true;
    HTMLMediaElement.prototype.play = function() { if (first && this.src.startsWith('blob:')) { first = false; this.autoplay = false; return Promise.reject(new DOMException('blocked', 'NotAllowedError')); } return play.call(this); };
  }));
  await blocked.page.getByRole('button', { name: '소리를 켜려면 클릭하세요' }).waitFor({ timeout: 120000 });
  await blocked.page.getByRole('button', { name: '소리를 켜려면 클릭하세요' }).click();
  await audio(blocked.page, 'autoplay blocked → user resumes'); assert.deepEqual(blocked.errors, []); await blocked.context.close();
  const off = await setup('off'); await send(off.page, 'Hello');
  await off.page.locator('.mvp-message.assistant').filter({ hasText: 'That sounds interesting.' }).waitFor();
  assert.equal(off.downloads.length, 0); assert.deepEqual(off.errors, []); await off.context.close();
  await fs.writeFile('test-results/piper-conversation.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log('PASS: actual conversation Piper PCM/playback, CPU, GPU failure recovery, barge-in, grounded RAG, text fallback, speech off, lazy loading.');
} finally { await browser.close(); }
