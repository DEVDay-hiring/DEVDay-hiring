import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeClient } from '../shared/realtime-client.js';

test('UI subscriptions receive immutable snapshots and can unsubscribe', () => {
  const client = new RealtimeClient(); const original = client.getSnapshot();
  let calls = 0; const unsubscribe = client.subscribe(() => calls++);
  client.message('u1', 'user', 'Hello');
  assert.notEqual(client.getSnapshot(), original); assert.equal(original.messages.length, 0);
  assert.equal(calls, 1); unsubscribe(); client.stop(); assert.equal(calls, 1);
});
test('streaming transcripts deduplicate by item and preserve interruptions', () => {
  const client = new RealtimeClient();
  client.message('a1', 'assistant', 'Good ', true, true);
  client.message('a1', 'assistant', 'morning', true, true);
  client.handle({ type: 'conversation.item.truncated', item_id: 'a1' }, { handle: () => true });
  client.message('a1', 'assistant', 'Good morning');
  assert.equal(client.getSnapshot().messages.length, 1);
  assert.equal(client.getSnapshot().messages[0].interrupted, true);
  assert.equal(client.getSnapshot().messages[0].text, 'Good morning');
  client.stop();
});
test('finish tears down every local resource, marks unfinished captions and preserves recap', () => {
  const client = new RealtimeClient(); const calls = [];
  client.peer = { close: () => calls.push('peer') };
  client.channel = { close: () => calls.push('channel') };
  client.mic = { getTracks: () => [{ stop: () => calls.push('mic') }] };
  client.attachAudio({ pause: () => calls.push('audio'), srcObject: {} });
  client.controller = { playing: true, dispose: () => calls.push('controller') };
  client.update({ connected: true, durationSeconds: 40, sources: [{ filename: 'news.md' }] });
  client.message('a1', 'assistant', 'A longer answer.', false, false);
  const summary = client.stop();
  assert.equal(summary.durationSeconds, 40); assert.equal(summary.connected, false);
  assert.equal(summary.messages[0].interrupted, true); assert.equal(summary.sources.length, 1);
  assert.deepEqual(calls.sort(), ['audio', 'channel', 'controller', 'mic', 'peer']);
  assert.equal(client.audio.srcObject, null);
});
test('navigation while microphone permission is pending closes the late microphone without opening a session', async () => {
  const oldFetch = globalThis.fetch;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let resolveMic, stopped = false, requested = false;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ apiKeyConfigured: true }) });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: () => { requested = true; return new Promise(resolve => { resolveMic = resolve; }); },
  } } });
  const client = new RealtimeClient();
  try {
    const pending = client.start({});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requested, true); client.stop();
    resolveMic({ getTracks: () => [{ stop: () => { stopped = true; } }] });
    await pending;
    assert.equal(stopped, true); assert.equal(client.getSnapshot().status, 'ended');
    assert.equal(client.peer, null);
  } finally {
    client.stop(); globalThis.fetch = oldFetch;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
  }
});

test('only accepted text is spoken; interrupted and cancelled replies never flush Piper tails', () => {
  const calls = [];
  const voice = { busy: true, append: (...args) => calls.push(['append', ...args]), completeItem: (...args) => calls.push(['done', ...args]), finish: id => calls.push(['finish', id]), interrupt: () => calls.push(['interrupt']), dispose: () => {} };
  const client = new RealtimeClient({ voice });
  const controller = { handle: e => e.response_id !== 'old' && e.response?.status !== 'cancelled', isCurrent: id => id === 'r' };
  client.handle({ type: 'response.output_text.delta', item_id: 'a', response_id: 'old', delta: 'Old' }, controller);
  client.handle({ type: 'response.output_text.delta', item_id: 'a', response_id: 'r', delta: 'Hello' }, controller);
  client.handle({ type: 'response.output_text.done', item_id: 'a', response_id: 'r', text: 'Hello' }, controller);
  client.handle({ type: 'response.done', response: { id: 'r', status: 'cancelled' } }, controller);
  client.handle({ type: 'response.done', response: { id: 'old', status: 'completed' } }, controller);
  assert.deepEqual(calls, [['append', 'a', 'r', 'Hello'], ['done', 'a', 'r', 'Hello'], ['interrupt']]);
  assert.equal(client.getSnapshot().messages[0].interrupted, true); client.stop();
});
