import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
// Reuse the workspace's existing Chrome test dependency without changing the app.
import { chromium } from '../../../node_modules/playwright/index.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5192';
const sentence = 'Hello! Let us practice English together.';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const summaries = [];
const audioReady = page => page.waitForFunction(() => !document.querySelector('#audio').hidden || !document.querySelector('#failure').hidden, null, { timeout: 150000 });
async function makeAudio(page, label) {
  await page.locator('#run').click(); await audioReady(page);
  assert.equal(await page.locator('#failure').isVisible(), false, await page.locator('#failure').textContent());
  const info = await page.evaluate(async () => {
    const audio = document.querySelector('#audio');
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(bytes);
      const samples = decoded.getChannelData(0);
      return { channels: decoded.numberOfChannels, seconds: decoded.duration, rms: Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) };
    } finally { await context.close(); }
  });
  assert.equal(info.channels, 1); assert.ok(info.seconds > 1 && info.rms > 0.001);
  summaries.push({ label, audio: info, metrics: await page.locator('#metrics').innerText() });
}

try {
  await fs.mkdir('test-results', { recursive: true });
  // Fresh context prevents a cached model from masking a download failure.
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(base);
  assert.equal(requests.some(url => /\.onnx|\.wasm|phonemize\.data/.test(url)), false, 'model loading must be on demand');
  await page.locator('#text').fill(sentence);
  await makeAudio(page, 'GPU first');
  await makeAudio(page, 'GPU warm');
  const log = await page.locator('#log').textContent();
  assert.ok(log.includes('"backend":"webgpu+wasm"') || log.includes('GPU를 사용할 수 없어'));
  await page.screenshot({ path: 'test-results/gpu.png', fullPage: true });
  await page.locator('#mode').selectOption('wasm');
  await makeAudio(page, 'CPU first');
  await makeAudio(page, 'CPU warm');
  assert.match(await page.locator('#metrics').innerText(), /CPU · WASM/);
  await page.screenshot({ path: 'test-results/cpu.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(requests.some(url => /^https?:/.test(url) && !url.startsWith(base)), false);
  await context.close();

  // Force a real GPU module loading failure; fresh CPU worker must recover.
  const fallbackContext = await browser.newContext();
  const fallback = await fallbackContext.newPage();
  await fallback.route('**/ort.webgpu.min-*.js', route => route.abort('failed'));
  await fallback.goto(base); await fallback.locator('#text').fill(sentence);
  await makeAudio(fallback, 'forced GPU failure → CPU');
  assert.match(await fallback.locator('#log').textContent(), /"type":"fallback"/);
  assert.match(await fallback.locator('#metrics').innerText(), /CPU · WASM/);
  await fallbackContext.close();

  const cpuFailureContext = await browser.newContext();
  const cpuFailure = await cpuFailureContext.newPage();
  await cpuFailure.route('**/ort.wasm.min-*.js', route => route.abort('failed'));
  await cpuFailure.goto(base); await cpuFailure.locator('#mode').selectOption('wasm');
  await cpuFailure.locator('#text').fill(sentence); await cpuFailure.locator('#run').click(); await audioReady(cpuFailure);
  assert.match(await cpuFailure.locator('#failure').innerText(), /입력 문장은 유지/);
  assert.equal(await cpuFailure.locator('#text').inputValue(), sentence);
  assert.equal(await cpuFailure.locator('#run').isEnabled(), true);
  await cpuFailureContext.close();

  const failureContext = await browser.newContext();
  const failed = await failureContext.newPage();
  await failed.route('**/*.onnx', route => route.fulfill({ status: 404, body: 'missing model' }));
  await failed.goto(base); await failed.locator('#text').fill(sentence);
  await failed.locator('#run').click(); await audioReady(failed);
  assert.match(await failed.locator('#failure').innerText(), /다운로드 실패.*입력 문장은 유지/);
  assert.equal(await failed.locator('#text').inputValue(), sentence);
  assert.equal(await failed.locator('#run').isEnabled(), true);
  assert.doesNotMatch(await failed.locator('#log').textContent(), /"type":"fallback"/);
  await failed.screenshot({ path: 'test-results/download-failure.png', fullPage: true });
  await failed.unroute('**/*.onnx');
  await failed.route('**/*.onnx', route => new Promise(resolve => setTimeout(async () => { await route.abort(); resolve(); }, 1200)));
  await failed.locator('#run').click(); await failed.locator('#stop').click();
  await failed.getByText('중지했습니다. 다시 실행할 수 있습니다.', { exact: true }).waitFor();
  assert.equal(await failed.locator('#run').isEnabled(), true);
  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.equal(await failed.locator('#audio').isVisible(), false, 'stale work must not restart playback');
  await failureContext.close();

  // A browser without a usable GPU must choose CPU before loading GPU code.
  const cpuBrowser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
  try {
    const cpuPage = await cpuBrowser.newPage();
    await cpuPage.goto(base); await cpuPage.locator('#text').fill(sentence);
    assert.equal(await cpuPage.evaluate(async () => !!(await navigator.gpu?.requestAdapter())), false);
    await makeAudio(cpuPage, 'GPU unavailable → CPU');
    assert.match(await cpuPage.locator('#log').textContent(), /GPU를 사용할 수 없어/);
    assert.match(await cpuPage.locator('#metrics').innerText(), /CPU · WASM/);
  } finally { await cpuBrowser.close(); }

  await fs.writeFile('test-results/measurements.json', JSON.stringify(summaries, null, 2));
  console.log(JSON.stringify(summaries, null, 2));
  console.log('PASS: real GPU/CPU PCM, warm runs, GPU failure recovery, missing model, cancellation, lazy load, local-only inference, mobile.');
} finally { await browser.close(); }
