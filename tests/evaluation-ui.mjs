import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  let requests = 0;
  await page.route('**/api/evaluation', route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '테스트: 일시적인 평가 API 실패' }) });
    return route.continue();
  });
  await page.goto((process.env.TEST_URL || 'http://localhost:3001') + '/#conversation');
  await page.getByRole('button', { name: '대화 종료하고 결과 보기' }).click();
  await page.getByRole('alert').filter({ hasText: '일시적인 평가 API 실패' }).waitFor();
  assert.equal(await page.getByRole('meter').count(), 0);
  await page.getByRole('button', { name: '대화 기록 · 통계' }).click();
  await page.getByRole('heading', { name: '첫 대화를 시작해 볼까요?' }).waitFor();
  await page.getByRole('button', { name: '영어 실력 평가', exact: true }).click();
  assert.equal(requests, 1);
  await page.getByRole('button', { name: '평가 다시 시도' }).click();
  await page.locator('.assessment-error').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.assessment-main')?.getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('.assessment-error').count(), 0);
  assert.equal(requests, 2); assert.equal(await page.locator('.assessment-card').count(), 4);
  assert.equal(await page.getByRole('meter').count(), 0);
  await page.reload();
  await page.getByText('아직 평가할 대화가 없습니다.', { exact: true }).waitFor();
  assert.equal(requests, 2);
  console.log('PASS: failed evaluation remains unscored, recap available, manual retry succeeds, refresh does not invent data.');
} finally { await browser.close(); }
