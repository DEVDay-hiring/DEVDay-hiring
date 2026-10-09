import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiApp } from '../server/app.mjs';
import { allowedOriginsFromEnv } from '../server/origins.mjs';
import { getHealth } from '../shared/health.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const send = (base, path, body, origin) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
});

test('Vercel origins include this project production, preview, branch and explicit alias only', () => {
  const origins = allowedOriginsFromEnv({ VERCEL: '1', VERCEL_URL: 'preview.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'production.vercel.app', VERCEL_BRANCH_URL: 'branch.vercel.app', APP_ORIGIN: 'https://custom.example' }, 3001);
  assert.deepEqual([...origins].sort(), ['https://branch.vercel.app', 'https://custom.example', 'https://preview.vercel.app', 'https://production.vercel.app']);
  assert.equal(origins.has('https://unrelated.vercel.app'), false);
  assert.equal(origins.has('http://localhost:3001'), false);
  assert.equal(allowedOriginsFromEnv({ APP_ORIGIN: 'javascript:invalid' }, 5174).has('javascript:invalid'), false);
});

test('shared API starts without dist files or credentials; health is JSON and uncached', async () => {
  await withServer(createApiApp({ env: {} }), async base => {
    const response = await fetch(base + '/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const health = await response.json();
    assert.equal(health.apiKeyConfigured, false); assert.equal(health.knowledgeConfigured, false);
    assert.equal(Object.hasOwn(health, 'apiKey'), false);
  });
});

test('deployed origin reaches session/search/evaluation and unrelated origin is rejected', async () => {
  const origin = 'https://frontend-web-pied-six.vercel.app';
  await withServer(createApiApp({ env: { VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'frontend-web-pied-six.vercel.app' } }), async base => {
    assert.equal((await send(base, '/api/session', { sdp: 'invalid' }, origin)).status, 503);
    assert.equal((await send(base, '/api/knowledge/search', { query: 'AI' }, origin)).status, 503);
    const evaluated = await send(base, '/api/evaluation', { messages: [] }, origin);
    assert.equal(evaluated.status, 200);
    assert.ok(Object.values((await evaluated.json()).dimensions).every(item => item.score === null));
    for (const path of ['/api/session', '/api/knowledge/search', '/api/evaluation']) {
      assert.equal((await send(base, path, {}, 'https://unrelated.vercel.app')).status, 403);
    }
    assert.equal((await fetch(base + '/api/unknown')).status, 404);
  });
});

test('each Vercel function exports a working API handler without opening a local port', async () => {
  for (const [file, path] of [['health', '/api/health'], ['session', '/api/session'], ['evaluation', '/api/evaluation'], ['knowledge/search', '/api/knowledge/search']]) {
    const { default: handler } = await import(`../api/${file}.js`);
    assert.equal(typeof handler, 'function');
    await withServer(handler, async base => {
      const response = path === '/api/health' ? await fetch(base + path) : await send(base, path, {}, 'https://unrelated.invalid');
      assert.equal(response.status, path === '/api/health' ? 200 : 403);
      assert.ok(response.headers.get('content-type').includes('application/json'));
    });
  }
});

test('health 404 and static HTML return a deployment error before JSON parsing or microphone access', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('NOT_FOUND', { status: 404 });
    await assert.rejects(getHealth(), /API가 배포되지 않았습니다/);
    globalThis.fetch = async () => new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(getHealth(), /배포 라우팅/);
    globalThis.fetch = async () => Response.json({ ok: true });
    await assert.rejects(getHealth(), /상태 응답/);
    globalThis.fetch = async () => Response.json({ ok: true, apiKeyConfigured: false });
    assert.equal((await getHealth()).apiKeyConfigured, false);
  } finally { globalThis.fetch = original; }
});

test('Realtime session preserves STT and RAG but requests text without OpenAI TTS', async () => {
  const realFetch = globalThis.fetch; let session;
  globalThis.fetch = (url, options) => {
    if (String(url).startsWith('https://api.openai.com/')) {
      session = JSON.parse(options.body.get('session'));
      return Promise.resolve(new Response('mock SDP', { status: 201 }));
    }
    return realFetch(url, options);
  };
  try {
    await withServer(createApiApp({ env: { OPENAI_API_KEY: 'test-only', APP_ORIGIN: 'https://app.example' } }), async base => {
      const response = await send(base, '/api/session', { sdp: 'v=0\r\nm=audio\r\nm=application\r\n' }, 'https://app.example');
      assert.equal(response.status, 201);
      assert.deepEqual(session.output_modalities, ['text']); assert.equal(session.audio.output, undefined);
      assert.equal(session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
      assert.equal(session.audio.input.turn_detection.create_response, false);
      assert.equal(session.tools[0].name, 'search_trump_news');
    });
  } finally { globalThis.fetch = realFetch; }
});
