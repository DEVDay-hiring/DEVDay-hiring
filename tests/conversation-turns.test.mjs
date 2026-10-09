import test from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../shared/conversation.js';
import { RealtimeClient } from '../shared/realtime-client.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const contextEcho = "English conversation practice. Terms may include Trump, Artificial Intelligence (AI), Super Intelligence (SI), S I. Preserve the speaker's actual wording, including Korean when spoken.";

function setup(search = async () => ({ results: [] })) {
  const sent = [], spoken = [], finished = [];
  const voice = { busy: false, append: (_item, _response, text) => spoken.push(text),
    completeItem: () => {}, finish: id => finished.push(id), interrupt: () => {}, dispose: () => {} };
  const client = new RealtimeClient({ voice });
  const track = { enabled: true, stop() {} };
  client.mic = { getAudioTracks: () => [track], getTracks: () => [track] };
  client.update({ connected: true });
  const controller = new Conversation({ send: event => sent.push(event), search, localAudio: true,
    mute: () => {}, status: status => client.conversationStatus(status), error: error => client.update({ error }) });
  client.controller = controller;
  const emit = event => client.handle(event, controller);
  const created = id => emit({ type: 'response.created', response: { id, metadata: {
    turn_epoch: String(controller.pending.epoch), request_id: controller.pending.requestId,
  } } });
  const transcript = (id, text) => {
    emit({ type: 'input_audio_buffer.speech_started', item_id: id });
    emit({ type: 'input_audio_buffer.speech_stopped', item_id: id });
    emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
  };
  const reply = (id, text) => {
    created(id);
    const delta = { type: 'response.output_text.delta', event_id: `delta-${id}`, response_id: id, item_id: `item-${id}`, delta: text };
    emit(delta); emit(delta);
    emit({ type: 'response.output_text.done', response_id: id, item_id: `item-${id}`, text });
    const done = { type: 'response.done', response: { id, status: 'completed', output: [] } };
    emit(done); emit(done);
  };
  return { client, controller, track, sent, spoken, finished, emit, created, transcript, reply,
    requests: () => sent.filter(event => event.type === 'response.create') };
}

test('prompt echoes, empty audio and Korean never become visible learner turns or answers', () => {
  const s = setup();
  try {
    for (const [id, text] of [['echo', contextEcho], ['silence', ' '], ['korean', '안녕하세요']]) {
      s.emit({ type: 'input_audio_buffer.speech_started', item_id: id });
      s.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: id, delta: text });
      s.emit({ type: 'input_audio_buffer.speech_stopped', item_id: id });
      s.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
      assert.equal(s.client.snapshot.status, 'ready');
      assert.ok(s.sent.some(event => event.type === 'conversation.item.delete' && event.item_id === id));
    }
    assert.equal(s.client.snapshot.messages.length, 0);
    assert.equal(s.client.snapshot.turns, 0);
    assert.equal(s.requests().length, 0);
    s.transcript('valid', 'What does artificial intelligence mean?');
    assert.equal(s.requests().length, 1);
    assert.equal(s.client.snapshot.turns, 1);
  } finally { s.client.stop(); }
});

test('one spoken question produces one answer despite duplicate events and muted-mic echoes', () => {
  const s = setup();
  try {
    s.transcript('user-1', 'Hello');
    assert.equal(s.track.enabled, false, 'mute before preparing the answer');
    s.emit({ type: 'input_audio_buffer.speech_started', item_id: 'echo-1' });
    s.emit({ type: 'input_audio_buffer.committed', item_id: 'echo-1' });
    s.emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'echo-1' });
    s.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'echo-1', transcript: 'Hi there, nice to see you.' });
    s.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-1', transcript: 'Hello' });
    s.reply('answer-1', 'Hi! What would you like to discuss?');
    assert.equal(s.requests().length, 1);
    assert.equal(s.client.snapshot.turns, 1);
    assert.equal(s.client.snapshot.messages.filter(m => m.role === 'assistant').length, 1);
    assert.deepEqual(s.spoken, ['Hi! What would you like to discuss?']);
    assert.deepEqual(s.finished, ['answer-1']);
    assert.equal(s.track.enabled, false, 'do not automatically re-enable the mic');

    s.client.toggleMic();
    s.transcript('user-2', 'Hello');
    s.reply('answer-2', 'Welcome back.');
    assert.equal(s.requests().length, 2, 'a new intentional turn may repeat the same words');
    assert.equal(s.client.snapshot.turns, 2);
    assert.deepEqual(s.finished, ['answer-1', 'answer-2']);
  } finally { s.client.stop(); }
});

test('search preambles stay silent and duplicate tool completion yields one final answer', async () => {
  let resolveSearch, searches = 0;
  const s = setup(() => { searches++; return new Promise(resolve => { resolveSearch = resolve; }); });
  try {
    s.client.text('What is SI?');
    s.created('lookup');
    s.emit({ type: 'response.output_text.delta', response_id: 'lookup', item_id: 'preamble', delta: 'Hi there, nice to see you. ' });
    s.emit({ type: 'response.output_text.done', response_id: 'lookup', item_id: 'preamble', text: 'Hi there, nice to see you. ' });
    const done = { type: 'response.done', response: { id: 'lookup', status: 'completed', output: [
      { type: 'function_call', name: 'search_trump_news', call_id: 'search-1', arguments: '{"query":"Super Intelligence"}' },
    ] } };
    s.emit(done); s.emit(done);
    assert.equal(searches, 1);
    assert.equal(s.client.snapshot.messages.filter(m => m.role === 'assistant').length, 0);
    assert.deepEqual(s.spoken, []);
    resolveSearch({ results: [], resultCount: 0 });
    await tick();
    s.emit(done);
    assert.equal(s.requests().length, 2, 'one search pass and one final answer pass');
    s.reply('final', 'SI means Super Intelligence in this context.');
    s.emit(done);
    assert.equal(s.requests().length, 2);
    assert.equal(s.client.snapshot.messages.filter(m => m.role === 'assistant').length, 1);
    assert.deepEqual(s.spoken, ['SI means Super Intelligence in this context.']);
    assert.deepEqual(s.finished, ['final']);
  } finally { s.client.stop(); }
});

test('unsolicited responses cannot steal a pending request and the welcome runs once', () => {
  const s = setup();
  try {
    s.controller.greeting(); s.controller.greeting();
    assert.equal(s.requests().length, 1);
    const pending = s.controller.pending;
    for (const id of ['automatic', 'wrong-request']) {
      s.emit({ type: 'response.created', response: { id, metadata: { turn_epoch: '0', request_id: id } } });
      s.emit({ type: 'response.output_text.delta', response_id: id, item_id: id, delta: 'Duplicate welcome.' });
      s.emit({ type: 'response.done', response: { id, status: 'completed', output: [] } });
    }
    assert.equal(s.controller.pending, pending);
    assert.deepEqual(s.spoken, []);
    assert.equal(s.sent.filter(event => event.type === 'response.cancel').length, 2);
    s.reply('welcome', 'Hello!');
    s.controller.greeting();
    assert.equal(s.requests().length, 1);
    assert.deepEqual(s.spoken, ['Hello!']);
  } finally { s.client.stop(); }
});
