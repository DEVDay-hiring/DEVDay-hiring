import test from "node:test";
import assert from "node:assert/strict";
import { Conversation, containsKorean } from "../shared/conversation.js";
import { needsNewsSearch, normalizeKnowledgeQuery, responseOptions } from "../shared/knowledge-policy.js";
import { normalizeConversationConfig, buildPersonaInstructions } from "../persona.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(search = async () => ({ resultCount: 1, results: [{ filename: "source.md", text: "SI = Super Intelligence" }] })) {
  const sent = [], muted = [], sources = [];
  const c = new Conversation({ send: e => sent.push(e), search, mute: v => muted.push(v), sources: r => sources.push(r) });
  return { c, sent, muted, sources };
}
function created(c, id, epoch = c.epoch) {
  c.handle({ type: "response.created", response: { id, metadata: { turn_epoch: String(epoch) } } });
}
function done(c, id, output = [], status = "completed") {
  c.handle({ type: "response.done", response: { id, status, output } });
}
const toolCall = { type: "function_call", name: "search_trump_news", call_id: "call1", arguments: '{"query":"What is SI?"}' };
const requests = sent => sent.filter(e => e.type === "response.create");

test("naming questions retrieve; greetings and explicit alternative meanings stay conversational", () => {
  for (const text of ["Hi Trump. I have a question. Why do people call it AI instead of SI?", "What is S I?", "SI가 뭐야?", "Why did you say that about tariffs?"]) assert.ok(needsNewsSearch(text), text);
  for (const text of ["Hi Trump!", "Can we practice ordering coffee?", "By SI I mean System Integration."]) assert.equal(needsNewsSearch(text), false, text);
  assert.match(normalizeKnowledgeQuery("What is SI?"), /Super Intelligence/);
  assert.equal(normalizeKnowledgeQuery("SI units"), "SI units");
});

test("all response phases preserve session persona; no response-level instructions overwrite it", () => {
  for (const phase of ["greeting", "answer", "grounded"]) assert.equal("instructions" in responseOptions("What is SI?", phase), false);
  const config = normalizeConversationConfig({});
  assert.equal(config.support, "english");
  assert.match(buildPersonaInstructions(config), /first-person/);
  assert.equal(normalizeConversationConfig({ level: "invalid", voice: "invalid" }).voice, "cedar");
});

test("Korean text and Korean speech are rejected without creating an answer", () => {
  const errors = [], sent = [];
  const c = new Conversation({ send: event => sent.push(event), search: async () => ({}), mute: () => {}, error: message => errors.push(message) });
  assert.equal(containsKorean("Hello"), false);
  assert.equal(containsKorean("안녕하세요"), true);
  assert.equal(c.text("안녕하세요"), false);
  assert.equal(sent.some(event => event.type === "conversation.item.create" || event.type === "response.create"), false);
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "ko" });
  c.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "ko", transcript: "안녕하세요" });
  c.handle({ type: "input_audio_buffer.speech_stopped", item_id: "ko" });
  assert.equal(requests(sent).length, 0);
  assert.ok(errors.length);
  c.dispose();
});

test("failed or delayed speech transcription never falls back to answering raw audio", async () => {
  const errors = [], sent = [];
  const c = new Conversation({ send: event => sent.push(event), search: async () => ({}), mute: () => {}, error: message => errors.push(message) });
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "failed" });
  c.handle({ type: "conversation.item.input_audio_transcription.failed", item_id: "failed" });
  c.handle({ type: "input_audio_buffer.speech_stopped", item_id: "failed" });
  assert.equal(requests(sent).length, 0);
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "delayed" });
  c.handle({ type: "input_audio_buffer.speech_stopped", item_id: "delayed" });
  await new Promise(resolve => setTimeout(resolve, 20));
  c.dispose();
  assert.equal(requests(sent).length, 0);
  assert.ok(errors.length);
});

test("speech silences local playback, cancels generation, clears audio and waits for user's finished turn", () => {
  const { c, sent, muted } = setup();
  c.greeting(); created(c, "r1");
  c.handle({ type: "output_audio_buffer.started", response_id: "r1" });
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "u1" });
  assert.equal(muted.at(-1), true);
  assert.ok(sent.some(e => e.type === "response.cancel" && e.response_id === "r1"));
  assert.ok(sent.some(e => e.type === "output_audio_buffer.clear"));
  assert.equal(c.handle({ type: "response.output_audio_transcript.delta", response_id: "r1", delta: "stale" }), false);
  c.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "What is SI?" });
  assert.equal(requests(sent).length, 1);
  done(c, "r1", [], "cancelled");
  c.handle({ type: "input_audio_buffer.speech_stopped", item_id: "u1" });
  assert.equal(requests(sent).length, 2);
  assert.equal(requests(sent).at(-1).response.tool_choice.name, "search_trump_news");
  c.dispose();
});

test("playback can be interrupted even after response generation is finished", () => {
  const { c, sent, muted } = setup();
  c.greeting(); created(c, "r1");
  c.handle({ type: "output_audio_buffer.started", response_id: "r1" });
  done(c, "r1");
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "u1" });
  assert.equal(muted.at(-1), true);
  assert.ok(sent.some(e => e.type === "output_audio_buffer.clear"));
  assert.equal(sent.some(e => e.type === "response.cancel"), false);
  c.dispose();
});

test("late response.created is cancelled before a queued new answer starts", () => {
  const { c, sent } = setup();
  c.greeting();
  c.text("Let's talk about food.");
  assert.equal(requests(sent).length, 1);
  created(c, "late", 0);
  assert.ok(sent.some(e => e.type === "response.cancel" && e.response_id === "late"));
  done(c, "late", [], "cancelled");
  assert.equal(requests(sent).length, 2);
  c.dispose();
});

test("interruption aborts search and stale completion never speaks or changes source UI", async () => {
  let resolveSearch, signal;
  const { c, sent, sources } = setup((_query, s) => { signal = s; return new Promise(resolve => { resolveSearch = resolve; }); });
  c.text("What is SI?"); created(c, "r1"); done(c, "r1", [toolCall]);
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "u2" });
  assert.equal(signal.aborted, true);
  resolveSearch({ resultCount: 1, results: [{ filename: "old.md" }] });
  await tick();
  assert.equal(requests(sent).length, 1);
  assert.equal(sources.length, 0);
  const output = sent.find(e => e.item?.type === "function_call_output");
  assert.match(output.item.output, /interrupted/);
  c.dispose();
});

test("old connection's search completion cannot send to a new session", async () => {
  let resolveSearch;
  const { c, sent } = setup(() => new Promise(resolve => { resolveSearch = resolve; }));
  c.text("What is SI?"); created(c, "r1"); done(c, "r1", [toolCall]);
  c.dispose();
  const count = sent.length;
  resolveSearch({ resultCount: 1, results: [] });
  await tick();
  assert.equal(sent.length, count);
});

test("successful retrieval returns tool output and continues once without overwriting persona", async () => {
  const { c, sent, sources } = setup();
  c.text("What is SI?"); created(c, "r1"); done(c, "r1", [toolCall]);
  await tick();
  assert.equal(sources.length, 1);
  assert.equal(requests(sent).length, 2);
  assert.equal(requests(sent).at(-1).response.tool_choice, "none");
  assert.equal(requests(sent).at(-1).response.instructions, undefined);
  c.dispose();
});

test("out-of-order and duplicate transcriptions do not trigger extra responses", () => {
  const { c, sent } = setup();
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "old" });
  c.handle({ type: "input_audio_buffer.speech_started", item_id: "new" });
  c.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "old", transcript: "What is SI?" });
  assert.equal(requests(sent).length, 0);
  c.handle({ type: "input_audio_buffer.speech_stopped", item_id: "new" });
  const event = { type: "conversation.item.input_audio_transcription.completed", item_id: "new", transcript: "Hello" };
  c.handle(event); c.handle(event);
  assert.equal(requests(sent).length, 1);
  c.dispose();
});

test("retrieval errors are passed to the model without fabricating results", async () => {
  const { c, sent } = setup(async () => { throw new Error("Store unavailable"); });
  c.text("What is SI?"); created(c, "r1"); done(c, "r1", [toolCall]);
  await tick();
  const output = JSON.parse(sent.find(e => e.item?.type === "function_call_output").item.output);
  assert.equal(output.resultCount, 0);
  assert.equal(output.error, "Store unavailable");
  assert.equal(requests(sent).length, 2);
  c.dispose();
});

test('Piper sessions request text and interrupt local audio without server audio-buffer commands', () => {
  const sent = [], muted = [];
  const c = new Conversation({ send: e => sent.push(e), search: async () => ({}), mute: v => muted.push(v), localAudio: true });
  c.greeting(); created(c, 'r'); c.playing = true;
  assert.deepEqual(requests(sent)[0].response.output_modalities, ['text']);
  c.handle({ type: 'input_audio_buffer.speech_started', item_id: 'u' });
  assert.equal(muted.at(-1), true); assert.ok(sent.some(e => e.type === 'response.cancel'));
  assert.equal(sent.some(e => e.type === 'output_audio_buffer.clear'), false); c.dispose();
});
