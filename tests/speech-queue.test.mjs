import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechQueue, speechChunks } from '../shared/speech-queue.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(engine = { synthesize: async text => text }) {
  const spoken = [], states = [], notices = [];
  const q = new SpeechQueue({ engine, play: async (text, current, started) => { if (current()) { started(); spoken.push(text); } }, stopAudio: () => {}, status: value => states.push(value), notice: value => notices.push(value) });
  return { q, spoken, states, notices };
}
test('sentences stream before completion, final tails wait for completed response, done events do not repeat speech', async () => {
  const { q, spoken } = setup();
  q.append('a', 'r', 'Hello! What would'); await tick();
  assert.deepEqual(spoken, ['Hello!']);
  q.completeItem('a', 'r', 'Hello! What would you like?'); await tick();
  assert.deepEqual(spoken, ['Hello!']);
  q.finish('r'); await tick();
  q.completeItem('a', 'r', 'Hello! What would you like?'); q.finish('r'); await tick();
  assert.deepEqual(spoken, ['Hello!', 'What would you like?']); q.dispose();
});
test('barge-in discards unfinished text and late synthesis, new turn still speaks', async () => {
  let finishOld; const { q, spoken } = setup({ synthesize: text => text.startsWith('Old') ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(text) });
  q.append('old', 'r1', 'Old sentence. Unfinished'); assert.equal(q.busy, true);
  q.interrupt(); q.append('new', 'r2', 'New sentence. '); await tick();
  finishOld('Old sentence.'); await tick();
  assert.deepEqual(spoken, ['New sentence.']); assert.equal(q.busy, false); q.dispose();
});
test('interrupt stops current playback immediately and discards queued sentences', async () => {
  let resolvePlayback, stopCount = 0; const spoken = [];
  const q = new SpeechQueue({ engine: { synthesize: async text => text }, play: text => { spoken.push(text); return new Promise(resolve => { resolvePlayback = resolve; }); }, stopAudio: () => { stopCount++; resolvePlayback?.(); } });
  q.append('a', 'r', 'First sentence. Second sentence. '); await tick(); q.interrupt(); await tick();
  assert.equal(stopCount, 1); assert.deepEqual(spoken, ['First sentence.']); assert.equal(q.busy, false); q.dispose();
});
test('inference failure disables only speech, keeps text available, reconnect can retry', async () => {
  const { q, notices, spoken } = setup({ synthesize: async () => { throw new Error('CPU failed'); } });
  q.append('a', 'r', 'Hello. '); await tick();
  assert.equal(q.disabled, true); assert.match(notices[0], /텍스트로 계속/);
  q.append('b', 'r2', 'No more. '); assert.deepEqual(spoken, []);
  q.configure('auto'); assert.equal(q.disabled, false); q.dispose();
});
test('speech excludes Korean, bounds long sentences and does not truncate long tokens', async () => {
  const { q, notices, spoken } = setup(); q.append('a', 'r', '안녕하세요. Hello! '); await tick();
  assert.deepEqual(spoken, ['Hello!']); assert.match(notices[0], /한국어/);
  const long = 'x'.repeat(1000); const { chunks, consumed } = speechChunks(long, true);
  assert.equal(chunks.join(''), long); assert.equal(consumed, 1000); assert.ok(chunks.every(chunk => chunk.length <= 380));
  assert.deepEqual(speechChunks('Ask Dr. Smith to explain. ', true).chunks, ['Ask Dr. Smith to explain.']); q.dispose();
});
