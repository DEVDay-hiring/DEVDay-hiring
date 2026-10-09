import { chromium } from 'playwright';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import express from 'express';
import { installSyntheticPeer } from './synthetic-peer.mjs';

// Exercise the built React screen without live API calls, microphone access or model downloads.
const server = createServer(express().use(express.static('dist')));
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/piper/**', route => route.abort());
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ status: 201, contentType: 'application/sdp', body: 'synthetic SDP' });
    const data = path === '/api/health' ? { ok: true, apiKeyConfigured: true, knowledgeConfigured: true }
      : { resultCount: 1, results: [{ filename: 'AI.md', text: 'SI means Super Intelligence.', score: .9 }] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await installSyntheticPeer(page, { duplicateEvents: true, toolPreamble: true });
  await page.goto(`http://127.0.0.1:${server.address().port}/#conversation`);
  await page.getByRole('button', { name: '마이크 없이 텍스트로 시작' }).click();
  await page.locator('#conversation-input:enabled').waitFor();
  assert.equal(await page.locator('.mvp-message.assistant').count(), 0, 'wait for the learner instead of greeting first');
  assert.equal(await page.evaluate(() => window.syntheticEvents.filter(event => event.type === 'response.create').length), 0);

  await page.evaluate(() => {
    const emit = event => window.syntheticPeer.channel.emit(event);
    emit({ type: 'input_audio_buffer.speech_started', item_id: 'echo' });
    emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'echo' });
    emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'echo', transcript: "English conversation practice. Terms may include Trump. Preserve the speaker's actual wording, including Korean when spoken." });
  });
  await page.getByRole('alert').filter({ hasText: '정확히 인식하지 못했어요' }).waitFor();
  assert.equal(await page.locator('.mvp-message.user').count(), 0);

  for (const [text, expected] of [
    ['I enjoy learning English.', 'That sounds interesting.'],
    ['What is SI?', 'The uploaded reference discusses'],
  ]) {
    await page.locator('#conversation-input').fill(text);
    await page.getByRole('button', { name: 'Send ↗' }).click();
    await page.locator('.mvp-message.assistant').filter({ hasText: expected }).waitFor();
  }
  assert.equal(await page.locator('.mvp-message.user').count(), 2);
  assert.equal(await page.locator('.mvp-message.assistant').count(), 2, 'one answer per question without an unsolicited welcome');
  assert.equal(await page.getByText('Lookup preamble:', { exact: false }).count(), 0);
  assert.equal(await page.getByText('English conversation practice.', { exact: false }).count(), 0);
  const requests = await page.evaluate(() => window.syntheticEvents.filter(event => event.type === 'response.create').length);
  assert.equal(requests, 3, 'direct answer, silent search pass, grounded answer');
  assert.deepEqual(errors, []);
  console.log('PASS: built conversation UI ignores prompt echoes and duplicate events, and displays only one final answer per question.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
