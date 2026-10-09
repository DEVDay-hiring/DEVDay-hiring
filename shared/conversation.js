import { responseOptions } from "./knowledge-policy.js";

export const KOREAN_INPUT_NOTICE = "한국어 입력에는 답변하지 않아요. 영어로 입력해 주세요.";
export const containsKorean = text => /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff]/u.test(text || "");

// One controller per WebRTC connection. Epochs make delayed transcription,
// response events and searches unable to restart a superseded spoken turn.
export class Conversation {
  constructor({ send, search, mute, localAudio = false, status = () => {}, log = () => {}, sources = () => {}, error = () => {} }) {
    Object.assign(this, { send, search, mute, localAudio, status, log, sources, error });
    this.epoch = 0;
    this.alive = true;
    this.speaking = false;
    this.playing = false;
    this.pending = null;
    this.active = null;
    this.queued = null;
    this.voiceItem = null;
    this.responses = new Map();
    this.transcribed = new Set();
    this.toolCalls = new Set();
    this.searches = new Map();
  }

  greeting() { this.queue("", "greeting"); }

  interrupt(reason = "speech") {
    this.epoch += 1;
    clearTimeout(this.transcriptionTimer);
    this.queued = null;
    this.mute(true); // Immediate local silence, while server VAD clears its buffer.
    if (this.active) {
      this.send({ type: "response.cancel", response_id: this.active.id });
    }
    if (!this.localAudio && (this.active || this.pending || this.playing)) {
      this.send({ type: "output_audio_buffer.clear" });
    }
    for (const controller of this.searches.values()) controller.abort();
    this.playing = false;
    this.log({ type: "conversation.interrupted", reason });
  }

  text(text) {
    if (!this.alive || this.speaking) return false;
    if (containsKorean(text)) {
      this.error(KOREAN_INPUT_NOTICE);
      return false;
    }
    this.interrupt("text");
    this.voiceItem = null;
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    this.queue(text);
    return true;
  }

  queue(text, phase = "answer") {
    this.queued = { epoch: this.epoch, options: responseOptions(text, phase), phase };
    this.flush();
  }

  flush() {
    if (!this.alive || this.speaking || this.pending || this.active || this.searches.size || !this.queued) return;
    const next = this.queued;
    this.queued = null;
    if (next.epoch !== this.epoch) return;
    this.pending = next;
    this.status("thinking");
    this.send({
      type: "response.create",
      response: { ...next.options, ...(this.localAudio ? { output_modalities: ["text"] } : {}), metadata: { turn_epoch: String(next.epoch), phase: next.phase } },
    });
  }

  isCurrent(responseId) {
    return this.alive && !this.speaking && this.responses.get(responseId) === this.epoch;
  }

  handle(event) {
    if (!this.alive) return false;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.interrupt();
        this.speaking = true;
        this.voiceItem = event.item_id;
        this.status("listening");
        break;
      case "input_audio_buffer.speech_stopped": {
        if (event.item_id !== this.voiceItem) break;
        this.speaking = false;
        this.status("transcribing");
        const epoch = this.epoch;
        clearTimeout(this.transcriptionTimer);
        if (!this.transcribed.has(event.item_id)) {
          this.transcriptionTimer = setTimeout(() => {
            if (!this.alive || epoch !== this.epoch || this.transcribed.has(event.item_id)) return;
            this.transcribed.add(event.item_id);
            this.error("음성을 확인하지 못해 답변하지 않았어요. 영어로 다시 말씀해 주세요.");
            this.status("ready");
          }, 12000);
        } else {
          this.flush();
          if (!this.pending && !this.active && !this.queued && !this.searches.size) this.status("ready");
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        if (event.item_id !== this.voiceItem || this.transcribed.has(event.item_id)) break;
        clearTimeout(this.transcriptionTimer);
        this.transcribed.add(event.item_id);
        if (containsKorean(event.transcript)) {
          this.error(KOREAN_INPUT_NOTICE);
          this.status("ready");
        } else if (event.transcript?.trim()) this.queue(event.transcript);
        else {
          this.error("음성을 확인하지 못해 답변하지 않았어요. 영어로 다시 말씀해 주세요.");
          this.status("ready");
        }
        break;
      case "conversation.item.input_audio_transcription.failed":
        if (event.item_id !== this.voiceItem || this.transcribed.has(event.item_id)) break;
        clearTimeout(this.transcriptionTimer);
        this.transcribed.add(event.item_id);
        this.error("음성을 확인하지 못해 답변하지 않았어요. 영어로 다시 말씀해 주세요.");
        this.status("ready");
        break;
      case "response.created": {
        const response = event.response;
        const epoch = Number(response.metadata?.turn_epoch ?? this.pending?.epoch ?? -1);
        this.responses.set(response.id, epoch);
        this.active = { id: response.id, epoch };
        this.pending = null;
        if (epoch !== this.epoch || this.speaking) {
          this.send({ type: "response.cancel", response_id: response.id });
        }
        break;
      }
      case "output_audio_buffer.started":
        if (!this.isCurrent(event.response_id)) return false;
        this.playing = true;
        this.mute(false);
        this.status("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        if (!this.isCurrent(event.response_id)) return false;
        this.playing = false;
        if (!this.searches.size && !this.pending && !this.active) this.status("ready");
        break;
      case "response.output_audio_transcript.delta":
      case "response.output_audio_transcript.done":
      case "response.output_text.delta":
      case "response.output_text.done":
        return this.isCurrent(event.response_id);
      case "response.done": {
        const response = event.response;
        if (this.active?.id === response.id) this.active = null;
        const calls = (response.output || []).filter(item => item.type === "function_call" && item.call_id);
        if (this.isCurrent(response.id) && response.status === "failed") {
          this.error(response.status_details?.error?.message || "응답 생성에 실패했습니다. 다시 말씀해 주세요.");
          this.status("ready");
        }
        if (!this.isCurrent(response.id) || response.status !== "completed") {
          // Resolve old tool call items without resuming their abandoned answer.
          for (const call of calls) this.toolOutput(call, { error: "Turn interrupted; do not resume it." });
          this.flush();
          return false;
        }
        if (calls.length) void this.runTools(calls, this.epoch);
        else {
          if (response.status === "completed" && !this.playing) this.status("ready");
          this.flush();
        }
        break;
      }
      case "error":
        // VAD may have already cancelled the exact response we just cancelled.
        if (event.error?.code === "response_cancel_not_active") return false;
        this.error(event.error?.message || "Realtime 응답 오류");
        break;
    }
    return true;
  }

  toolOutput(call, result) {
    if (!this.alive) return;
    this.send({ type: "conversation.item.create", item: {
      type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result),
    } });
  }

  async runTools(calls, epoch) {
    const fresh = calls.filter(call => !this.toolCalls.has(call.call_id));
    if (!fresh.length) return;
    this.status("searching");
    const batch = new AbortController();
    this.searches.set(batch, batch);
    try {
      for (const call of fresh) {
        this.toolCalls.add(call.call_id);
        let result;
        try {
          if (batch.signal.aborted || epoch !== this.epoch) throw new Error("Turn interrupted");
          if (call.name !== "search_trump_news") throw new Error("Unsupported tool");
          const { query } = JSON.parse(call.arguments || "{}");
          if (typeof query !== "string" || !query.trim()) throw new Error("검색어가 없습니다.");
          this.log({ type: "knowledge.search.started", query });
          result = await this.search(query, batch.signal);
          if (!this.alive) return;
          if (epoch !== this.epoch) throw new Error("Turn interrupted");
          this.sources(result);
          this.log({ type: "knowledge.search.completed", result_count: result.resultCount,
            filenames: result.results?.map(item => item.filename) });
        } catch (error) {
          result = { results: [], resultCount: 0, error: String(error.message || error) };
          if (this.alive && epoch === this.epoch) {
            this.error(result.error);
            this.log({ type: "knowledge.search.failed", error: { message: result.error } });
          }
        }
        this.toolOutput(call, result);
      }
    } finally {
      this.searches.delete(batch);
      if (this.alive && epoch === this.epoch && !this.speaking) this.queue("", "grounded");
      else this.flush();
    }
  }

  dispose() {
    this.alive = false;
    clearTimeout(this.transcriptionTimer);
    for (const controller of this.searches.values()) controller.abort();
    this.queued = null;
    this.mute(true);
  }
}
