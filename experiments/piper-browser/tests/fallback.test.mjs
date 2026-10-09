import test from 'node:test';
import assert from 'node:assert/strict';
import { withCpuFallback, finitePcm } from '../src/fallback.js';

test('GPU inference failure retries once on CPU and preserves the original request', async () => {
  const attempts = [], notices = [];
  const result = await withCpuFallback(async mode => {
    attempts.push(mode);
    if (mode === 'auto') throw Object.assign(new Error('GPU device lost'), { retryOnCpu: true });
    return 'same sentence, CPU audio';
  }, 'auto', error => notices.push(error.message));
  assert.equal(result, 'same sentence, CPU audio');
  assert.deepEqual(attempts, ['auto', 'wasm']);
  assert.deepEqual(notices, ['GPU device lost']);
});

test('download/input errors do not trigger another expensive runtime attempt', async () => {
  let attempts = 0;
  await assert.rejects(withCpuFallback(async () => { attempts++; throw new Error('model download 404'); }, 'auto'), /download 404/);
  assert.equal(attempts, 1);
});

test('CPU failure is terminal, while cancellation never restarts CPU synthesis', async () => {
  const attempts = [];
  await assert.rejects(withCpuFallback(async mode => { attempts.push(mode); throw Object.assign(new Error('out of memory'), { retryOnCpu: true }); }, 'auto'), /out of memory/);
  assert.deepEqual(attempts, ['auto', 'wasm']);
  let count = 0;
  await assert.rejects(withCpuFallback(async () => { count++; throw Object.assign(new DOMException('stopped', 'AbortError'), { retryOnCpu: true }); }, 'auto'), { name: 'AbortError' });
  assert.equal(count, 1);
});

test('invalid or silent output cannot be presented as a successful voice', () => {
  for (const data of [[], [NaN], [Infinity], [0, 0]]) assert.throws(() => finitePcm(Float32Array.from(data)));
  assert.deepEqual([...finitePcm(Float32Array.of(0, 0.3, -0.2))], [0, Math.fround(0.3), Math.fround(-0.2)]);
});
