import { installSyntheticPeer } from './synthetic-peer.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the actual UI and turn controller with a synthetic peer and mocked APIs.
// No external connection, real microphone or paid request is made.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const excerpt = { filename: 'practice-news.md', score: .9, text: 'An uploaded reference about AI and Super Intelligence.' };
  let evaluated;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/health') return json({ apiKeyConfigured: true, knowledgeConfigured: true });
    if (path === '/api/session') return route.fulfill({ status: 201, contentType: 'application/sdp', body: 'synthetic answer' });
    if (path === '/api/knowledge/search') return json({ query: 'AI SI', resultCount: 1, results: [excerpt] });
    if (path === '/api/evaluation') {
      evaluated = route.request().postDataJSON();
      const dimension = score => ({ score, confidence: 'low', reason: '모의 평가 근거', strength: '', improvement: '이유를 덧붙여 말해보세요.', evidence: [], exercise: 'Explain why.' });
      return json({ summary: '모의 대화의 영어 표현을 확인했습니다.', dimensions: { pronunciation: dimension(null), fluency: dimension(null), accuracy: dimension(75), complexity: dimension(68) },
        corrections: [], nextPractice: '취미를 설명해보세요.', sample: { wordCount: 30, audioSeconds: 0, limited: false, mode: 'text' }, model: 'mock', version: 'test' });
    }
    throw new Error(`Unexpected API: ${path}`);
  });
  await installSyntheticPeer(page);
  await page.goto((process.env.TEST_URL || 'http://localhost:3001') + '/#conversation');
  await page.getByLabel('Piper 트럼프 음성').selectOption('off');
  await page.getByRole('button', { name: '마이크 없이 텍스트로 시작' }).click();
  await page.locator('.mvp-message.assistant').filter({ hasText: 'Hello!' }).waitFor();
  const ownText = 'I enjoy learning English because I want to talk with people from different countries and share my ideas.';
  await page.locator('#conversation-input').fill(ownText);
  await page.getByRole('button', { name: 'Send ↗' }).click();
  await page.locator('.mvp-message.assistant').filter({ hasText: 'That sounds interesting.' }).waitFor();
  await page.locator('#conversation-input').fill('Why do people call it AI instead of SI?');
  await page.getByRole('button', { name: 'Send ↗' }).click();
  await page.locator('.mvp-message.assistant').filter({ hasText: 'The uploaded reference discusses' }).waitFor();
  await page.getByRole('tab', { name: /참고 기사/ }).click();
  await page.getByRole('heading', { name: excerpt.filename }).waitFor();
  await page.getByRole('button', { name: '대화 종료하고 결과 보기' }).click();
  await page.getByText('모의 대화의 영어 표현을 확인했습니다.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('meter').count(), 2);
  assert.equal(evaluated.audio, null);
  assert.ok(evaluated.messages.some(message => message.text === ownText));
  assert.ok(evaluated.messages.every(message => message.role === 'user'));
  await page.getByRole('button', { name: '대화 기록 · 통계' }).click();
  assert.equal(await page.locator('.mvp-review-messages .user').count(), 2);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '대화 기록 저장 ↓' }).click();
  const exported = JSON.parse(fs.readFileSync(await (await downloading).path(), 'utf8'));
  assert.ok(exported.messages.some(message => message.text === ownText));
  assert.equal(exported.sources[0].filename, excerpt.filename);
  assert.equal(exported.evaluation.dimensions.accuracy.score, 75);
  assert.equal(Object.hasOwn(exported, 'audio'), false);
  assert.equal(await page.evaluate(() => window.syntheticPeer.connectionState), 'closed');
  await page.getByRole('button', { name: '다시 대화하기' }).click();
  assert.equal(await page.locator('.mvp-message').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: text conversation, streaming captions, RAG sources, real record passed to evaluation, JSON export, connection cleanup, fresh retry.');
} finally { await browser.close(); }
