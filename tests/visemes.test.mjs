import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import proto from '../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx.js';
import { withPhonemeDurations, DURATION_OUTPUT } from '../scripts/piper-durations.mjs';
import { phonemeTimeline, visemeAt, visemeFor } from '../shared/visemes.js';

test('vowels use phonemes, not spelling; bilabials close the lips', () => {
  for (const [shape, phonemes] of [['a', ['a', '\u0251', '\u028c']], ['e', ['e', '\u00e6', '\u025b', '\u0259']],
    ['i', ['i', '\u026a', 'j']], ['o', ['o', '\u0254']], ['u', ['u', '\u028a', 'w']], ['closed', ['b', 'm', 'p']]]) {
    for (const phoneme of phonemes) assert.equal(visemeFor(phoneme), shape, phoneme);
  }
  assert.equal(visemeFor(''), 'neutral');
  assert.equal(visemeFor('s'), 'neutral');
});

test('duration timeline preserves sample timing and absorbs padding without inventing pauses', () => {
  const map = { '^': [1], _: [0], a: [2], i: [3], $: [4] };
  const ids = [1, 0, 2, 0, 3, 0, 4], durations = [1, 1, 6, 2, 4, 1, 1];
  const cues = phonemeTimeline(ids, durations, map, 16 * 256, 22050, 256);
  assert.equal(cues[0].start, 0);
  assert.equal(cues.at(-1).end, 16 * 256 / 22050);
  assert.deepEqual(cues.map(cue => cue.shape), ['neutral', 'a', 'i', 'neutral']);
  assert.ok(Math.abs(cues[1].end - 9 * 256 / 22050) < 1e-9);
  assert.equal(cues[1].end, cues[2].start);
  assert.equal(visemeAt(cues, 6 * 256 / 22050).from, 'a');
});

test('combined diphthongs keep both mouth shapes in their real phoneme interval', () => {
  const cues = phonemeTimeline([10], [20], { 'a\u026a': [10] }, 5120, 22050, 256);
  assert.deepEqual(cues.map(cue => cue.shape), ['a', 'i']);
  assert.equal(cues[0].end, cues[1].start);
  assert.equal(cues[1].end, 5120 / 22050);
});

test('visual metadata failure never requires changing or stopping audio', () => {
  const map = { a: [1] };
  for (const durations of [undefined, [], [NaN], [-1], [1.5], [Infinity], [20]]) {
    assert.deepEqual(phonemeTimeline([1], durations, map, 256, 22050, 256), []);
  }
  assert.deepEqual(phonemeTimeline([99], [1], map, 256, 22050, 256), []);
  assert.deepEqual(phonemeTimeline([1], [1], map, 256, 0, 256), []);
  assert.deepEqual(phonemeTimeline([1], [1], map, 256, 22050, 0), []);
});

test('coarticulation crossfades around a boundary and jumps directly to the current clock', () => {
  const cues = [{ shape: 'a', start: 0, end: .5 }, { shape: 'u', start: .5, end: 1 }, { shape: 'i', start: 1, end: 1.5 }];
  assert.deepEqual(visemeAt(cues, .2), { from: 'a', to: 'a', mix: 0 });
  const blend = visemeAt(cues, .5);
  assert.equal(blend.from, 'a'); assert.equal(blend.to, 'u');
  assert.ok(Math.abs(blend.mix - .5) < 1e-9);
  assert.deepEqual(visemeAt(cues, 1.3), { from: 'i', to: 'i', mix: 0 });
  assert.equal(visemeAt(cues, 1.5).from, 'neutral');
  assert.equal(visemeAt([], .2).from, 'neutral');
});

test('duration export preserves original model weights and audio graph exactly', () => {
  const source = readFileSync(new URL('../piper_trump_inference/en_US-trump_ai_demo-medium.onnx', import.meta.url));
  const original = proto.onnx.ModelProto.decode(source);
  const prepared = withPhonemeDurations(source);
  const model = proto.onnx.ModelProto.decode(prepared);
  assert.equal(model.graph.output.at(-1).name, DURATION_OUTPUT);
  assert.equal(model.graph.node.at(-1).opType, 'Identity');
  assert.equal(withPhonemeDurations(prepared), prepared, 'Adding output must be idempotent');
  model.graph.output.pop(); model.graph.node.pop();
  const hash = value => createHash('sha256').update(proto.onnx.ModelProto.encode(value).finish()).digest('hex');
  assert.equal(hash(model), hash(original), 'All original nodes, outputs, initializers and metadata must stay unchanged');
  original.graph.node = original.graph.node.filter(node => node.opType !== 'Ceil');
  assert.throws(() => withPhonemeDurations(proto.onnx.ModelProto.encode(original).finish()), /identified safely/);
});
