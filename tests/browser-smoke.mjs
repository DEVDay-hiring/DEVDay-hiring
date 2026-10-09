import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const live = process.env.LIVE_API === '1';
const base = process.env.TEST_URL || 'http://localhost:3001';
const fixture = process.env.SPEECH_FIXTURE || fileURLToPath(new URL('./fixtures/interrupt.wav', import.meta.url));
fs.mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-networking'] });
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [], consoleErrors = [];
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('503')) consoleErrors.push(msg.text()); });
  // Mock only the readiness flag to exercise session error recovery without a key.
  if (!live) await page.route('**/api/health', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, apiKeyConfigured: true, knowledgeConfigured: false }) }));
  if (fixture) await page.route('**/__test_audio.wav', route => route.fulfill({ path: fixture, contentType: 'audio/wav' }));
  await page.addInitScript(() => {
    // Synthetic input only. Never record the presenter's real microphone.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); const destination = context.createMediaStreamDestination();
      const silent = context.createConstantSource(); silent.offset.value = 0; silent.connect(destination); silent.start();
      window.testMic = { context, destination }; return destination.stream;
    };
    window.testEvents = [];
    const original = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = original.apply(this, args);
      channel.addEventListener('message', ({ data }) => {
        const event = JSON.parse(data); window.testEvents.push(event);
        if (event.type === 'input_audio_buffer.speech_started') setTimeout(() => { window.pausedOnSpeech = document.querySelector('audio')?.paused; }, 0);
      });
      const send = channel.send.bind(channel);
      channel.send = data => { window.testEvents.push({ ...JSON.parse(data), direction: 'client' }); send(data); };
      return channel;
    };
  });
  await page.goto(base);
  const assertImages = () => page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await assertImages();
  assert.equal(requested.some(url => /\/(ConversationScreen|SummaryScreen)-[^/]+\.js/.test(url)), false);
  await page.screenshot({ path: 'test-results/01-onboarding.png' });
  await page.getByRole('button', { name: '시작하기: 인물 선택 화면으로 이동' }).click();
  await assertImages();
  assert.equal(requested.some(url => /\/(ConversationScreen|SummaryScreen)-[^/]+\.js/.test(url)), false);
  const layer = await page.evaluate(() => ({ hero: +getComputedStyle(document.querySelector('.person-hero')).zIndex, profile: +getComputedStyle(document.querySelector('.profile-panel')).zIndex,
    backgroundRight: document.querySelector('.app-background').getBoundingClientRect().right }));
  assert.ok(layer.hero > layer.profile);
  assert.equal(Math.round(layer.backgroundRight), await page.evaluate(() => innerWidth));
  await page.screenshot({ path: 'test-results/02-selection.png' });
  await page.getByRole('button', { name: '이 인물과 대화하기', exact: true }).click();
  await page.getByText('Realtime · 연결 준비됨').waitFor();
  await assertImages();
  const consentWidth = await page.locator('.evaluation-consent input').evaluate(input => input.getBoundingClientRect().width);
  assert.ok(consentWidth > 0 && consentWidth < 30);
  assert.equal(requested.some(url => /\/SummaryScreen-[^/]+\.js/.test(url)), false);
  await page.screenshot({ path: 'test-results/03-ready.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/04-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1512, height: 982 });

  // Exercise a real error path without paying for a session.
  await page.route('**/api/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '테스트 연결 실패: 재시도할 수 있습니다.' }) }));
  await page.getByRole('button', { name: '마이크 켜고 대화 시작', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '테스트 연결 실패' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '마이크 켜고 대화 시작', exact: true }).isEnabled(), true);
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: '오류 안내 닫기' }).click();

  if (live) {
    await page.getByRole('button', { name: '마이크 켜고 대화 시작', exact: true }).click();
    await page.waitForFunction(() => window.testEvents.some(e => e.type === 'response.done' && e.response.status === 'completed') && document.querySelector('audio')?.src.startsWith('blob:'), null, { timeout: 60000 });
    assert.equal(await page.locator('#conversation-input').isEnabled(), true);
    await page.locator('#conversation-input').fill('Hi Trump. I have a question. Why do people call it AI instead of SI?');
    await page.getByRole('button', { name: 'Send ↗' }).click();
    await page.waitForFunction(() => window.testEvents.some(e => e.type === 'response.done' && e.response.metadata?.phase === 'grounded'), null, { timeout: 60000 });
    const answer = await page.evaluate(() => window.testEvents.filter(e => e.type === 'response.done' && e.response.metadata?.phase === 'grounded').at(-1).response.output.flatMap(i => (i.content || []).map(c => c.transcript || c.text || '')).join(' '));
    assert.match(answer, /super\s*intelligence/i);
    assert.doesNotMatch(answer, /\.md|vector store|search_trump_news/i);
    console.log('GROUNDED:', answer);
    await page.screenshot({ path: 'test-results/05-live-conversation.png' });
    await page.getByRole('tab', { name: /참고 기사/ }).click();
    assert.ok(await page.locator('.mvp-source-list article').count());
    await page.screenshot({ path: 'test-results/06-sources.png' });
    await page.getByRole('tab', { name: '대화 기록' }).click();

    if (fixture) {
      await page.locator('#conversation-input').fill('Tell me a long, lively fictional story about learning English. Please speak for about a minute.');
      const before = await page.evaluate(() => window.testEvents.length);
      await page.getByRole('button', { name: 'Send ↗' }).click();
      await page.waitForFunction(n => window.testEvents.slice(n).some(e => e.type === 'response.output_text.delta') && !document.querySelector('audio')?.paused, before, { timeout: 45000 });
      await page.evaluate(async () => {
        const bytes = await (await fetch('/__test_audio.wav')).arrayBuffer();
        const { context, destination } = window.testMic;
        const source = context.createBufferSource(); source.buffer = await context.decodeAudioData(bytes);
        source.connect(destination); await context.resume(); source.start();
      });
      await page.waitForFunction(() => {
        const i = window.testEvents.findIndex(e => e.type === 'conversation.item.input_audio_transcription.completed');
        return i >= 0 && window.testEvents.slice(i).some(e => e.type === 'response.done' && e.response.status === 'completed');
      }, null, { timeout: 60000 });
      const result = await page.evaluate(() => ({ paused: window.pausedOnSpeech,
        clear: window.testEvents.some(e => e.type === 'output_audio_buffer.clear' && e.direction === 'client'),
        speech: window.testEvents.find(e => e.type === 'conversation.item.input_audio_transcription.completed')?.transcript,
        last: window.testEvents.filter(e => e.type === 'response.done' && e.response.status === 'completed').at(-1).response.output.flatMap(i => (i.content || []).map(c => c.transcript || c.text || '')).join(' '),
      }));
      assert.equal(result.paused, true); assert.equal(result.clear, false);
      assert.match(result.speech, /coffee/i); assert.match(result.last, /coffee|espresso|cappuccino|latte/i);
      console.log('BARGE_IN:', result);
    }
    await page.getByRole('button', { name: '마이크 음소거' }).click();
    assert.equal(await page.getByRole('button', { name: '마이크 켜기', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '대화 종료하고 결과 보기' }).click();
    await page.waitForFunction(() => document.querySelector('.assessment-main')?.getAttribute('aria-busy') === 'false', null, { timeout: 110000 });
    assert.equal(await page.locator('.assessment-error').count(), 0);
    assert.equal(await page.locator('.assessment-card').count(), 4);
    if (fixture) {
      await page.getByText('음성 + 텍스트', { exact: true }).waitFor();
      assert.ok(await page.getByRole('meter').count() >= 2);
    }
    await page.screenshot({ path: 'test-results/08-assessment.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/09-assessment-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.getByRole('button', { name: '대화 기록 · 통계' }).click();
    await page.getByRole('heading', { name: '당신의 대화가 쌓였어요' }).waitFor();
    assert.ok(await page.locator('.mvp-review-messages article').count() >= 3);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '대화 기록 저장 ↓' }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.ok(exported.messages.some(m => /AI instead of SI/.test(m.text)));
    assert.ok(exported.sources.length);
    assert.ok(exported.evaluation);
    console.log('EVALUATION:', JSON.stringify(exported.evaluation.dimensions));
    assert.equal(await page.evaluate(() => window.testMic.destination.stream.getTracks().every(t => t.readyState === 'ended')), true);
    await page.screenshot({ path: 'test-results/07-summary.png' });

    // Re-entry must create a fresh session; text-only mode needs no microphone.
    await page.getByRole('button', { name: '다시 대화하기' }).click();
    await page.evaluate(() => { window.testEvents = []; navigator.mediaDevices.getUserMedia = () => { throw new Error('Text-only mode must not request a microphone'); }; });
    await page.getByRole('button', { name: '마이크 없이 텍스트로 시작' }).click();
    await page.waitForFunction(() => window.testEvents.some(e => e.type === 'response.done' && e.response.status === 'completed') && document.querySelector('audio')?.src.startsWith('blob:'), null, { timeout: 60000 });
    assert.equal(await page.locator('#conversation-input').isEnabled(), true);
    await page.getByRole('button', { name: '대화 종료하고 결과 보기' }).click();
  } else {
    await page.getByRole('button', { name: '대화 종료하고 결과 보기' }).click();
    await page.waitForFunction(() => document.querySelector('.assessment-main')?.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.assessment-card').count(), 4);
    assert.equal(await page.getByRole('meter').count(), 0);
    const illustration = await page.locator('.assessment-intro img').evaluate(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, ratio: image.naturalWidth / image.naturalHeight }));
    assert.ok(Math.abs(illustration.width / illustration.height - illustration.ratio) < .02);
    await page.screenshot({ path: 'test-results/08-assessment-empty.png' });
    await page.getByRole('button', { name: '대화 기록 · 통계' }).click();
    assert.equal(await page.getByRole('button', { name: '대화 기록 저장 ↓' }).isDisabled(), true);
    await page.screenshot({ path: 'test-results/07-summary-empty.png' });
  }
  assert.deepEqual(errors, []);
  assert.equal(requested.some(url => /\/api\/v1\/|\.(png|jpg)(\?|$)/i.test(url)), false);
  assert.deepEqual(consoleErrors.filter(s => /Content Security Policy|Refused to|Uncaught/i.test(s)), []);
  console.log(`PASS: UI, mobile, error recovery, summary${live ? ', live retrieval and session restart' : ''}.`);
} finally { await browser.close(); }
