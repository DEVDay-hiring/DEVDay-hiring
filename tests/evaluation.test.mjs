import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEvaluation, normalizeReport, evaluate, DIMENSIONS } from '../evaluation.mjs';
import { encodeWav, selectSpeech } from '../shared/speech-capture.js';

const text = 'I enjoy studying computer science because I can build useful tools and solve problems for people.';
const input = () => prepareEvaluation({ messages: [{ id: 'local-1', role: 'user', text }] });
const raw = () => ({ summary: '표본 기반 피드백', dimensions: Object.fromEntries(DIMENSIONS.map(k => [k,
  { score: 75, confidence: 'high', reason: '근거', strength: '장점', improvement: '연습', evidence: ['예시'], exercise: 'Try again.' }])),
  corrections: [{ original: 'invented phrase', improved: 'Made up.' }, { original: 'I enjoy studying computer science', improved: 'I love studying computer science.', explanation: '표현 제안' }], nextPractice: '다음 연습' });
test('only genuine learner turns count, not assistant, prompted or partial text', () => {
  const result = prepareEvaluation({ messages: [{ role: 'assistant', text }, { role: 'user', text, prompted: true }, { role: 'user', text, partial: true }, { id: 'local-1', role: 'user', text }] });
  assert.equal(result.messages.length, 1); assert.equal(result.messages[0].mode, 'typed');
});
test('text never receives fabricated pronunciation or fluency, corrections must be grounded', () => {
  const report = normalizeReport(raw(), input(), 'test');
  assert.equal(report.dimensions.pronunciation.score, null); assert.equal(report.dimensions.fluency.score, null);
  assert.equal(report.dimensions.accuracy.score, 75); assert.equal(report.dimensions.accuracy.confidence, 'low');
  assert.equal(report.corrections.length, 1);
});
test('reject malformed audio, oversized recordings and malformed model scores', () => {
  assert.throws(() => prepareEvaluation({ messages: [], audio: { data: 'garbage' } }));
  assert.throws(() => prepareEvaluation({ messages: [], audio: { data: Buffer.from(encodeWav(new Float32Array(16000 * 91), 16000)).toString('base64') } }));
  const bad = raw(); bad.dimensions.complexity.score = 105;
  assert.throws(() => normalizeReport(bad, input(), 'test'));
  delete bad.dimensions.complexity; assert.throws(() => normalizeReport(bad, input(), 'test'));
});
test('empty/short data avoids API calls and returns four explicitly unavailable metrics', async () => {
  const result = await evaluate(prepareEvaluation({ messages: [{ role: 'user', text: 'Hello' }] }), { fetchImpl: () => { throw Error('must not call'); } });
  assert.equal(Object.values(result.dimensions).every(d => d.score === null), true);
});
test('audio duration is derived from PCM bytes rather than client claims', () => {
  const audio = { data: Buffer.from(encodeWav(new Float32Array(16000 * 4), 16000)).toString('base64'), seconds: 1000 };
  const parsed = prepareEvaluation({ messages: [], audio });
  assert.equal(parsed.audio.seconds, 4); assert.equal(parsed.eligible, true);
});
test('VAD selections exclude between-turn audio, avoid overlaps and cap at 90 seconds', () => {
  const samples = Float32Array.from({ length: 2000 }, (_, i) => i);
  const result = selectSpeech(samples, 10, [{ id: 'a', start: 1, end: 3 }, { id: 'b', start: 2, end: 5 }, { id: 'c', start: 10, end: 180 }]);
  assert.equal(result.samples.length, 900); assert.equal(result.samples[0], 10);
  assert.equal(result.samples[39], 49); assert.equal(result.samples[40], 100); assert.equal(result.limited, true);
});
test('API request uses local audio only, disables storage, preserves nullable scores', async () => {
  let body;
  const result = await evaluate(input(), { apiKey: 'test', fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw()) } }] }) };
  } });
  assert.equal(body.store, false); assert.deepEqual(body.modalities, ['text']);
  assert.equal(body.model, 'gpt-4.1-mini');
  assert.equal(result.dimensions.fluency.score, null);
});
test('fractional VAD boundaries do not falsely claim the audio sample was truncated', () => {
  const result = selectSpeech(new Float32Array(16000), 16000, [{ id: 'a', start: .1, end: .90001 }]);
  assert.equal(result.limited, false);
});
