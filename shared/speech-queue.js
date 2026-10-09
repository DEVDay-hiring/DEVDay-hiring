// Generation tokens isolate interrupted speech from a new conversational turn.
export class SpeechQueue {
  constructor({ engine, play, stopAudio, status = () => {}, notice = () => {} }) {
    Object.assign(this, { engine, play, stopAudio, status, notice });
    this.generation = 0; this.items = new Map(); this.completed = new Set(); this.queue = []; this.mode = 'auto'; this.disabled = false;
    this.processing = false; this.busy = false;
  }
  configure(mode = 'auto') { this.interrupt(); this.mode = mode; this.disabled = mode === 'off'; }
  append(itemId, responseId, delta) {
    if (this.disabled || this.completed.has(itemId)) return;
    const item = this.items.get(itemId) || { responseId, text: '', offset: 0 };
    item.text += delta; this.items.set(itemId, item); this.drain(item, false);
  }
  completeItem(itemId, responseId, text) {
    if (this.disabled || this.completed.has(itemId)) return;
    const item = this.items.get(itemId) || { responseId, text: '', offset: 0 };
    // Realtime emits output_text.done even on cancellation. Only response.done
    // with completed status can flush its unfinished final sentence.
    item.text = text || item.text; this.items.set(itemId, item); this.drain(item, false);
  }
  finish(responseId) {
    for (const [id, item] of this.items) if (item.responseId === responseId) { this.drain(item, true); this.items.delete(id); this.completed.add(id); if (this.completed.size > 256) this.completed.delete(this.completed.values().next().value); }
  }
  drain(item, final) {
    const rest = item.text.slice(item.offset);
    const { chunks, consumed } = speechChunks(rest, final);
    item.offset += consumed;
    for (const text of chunks) {
      if (/[가-힣]/.test(text)) { this.notice('한국어 설명은 자막으로 확인하세요. Piper는 영어 음성으로 읽습니다.'); continue; }
      this.queue.push(text);
    }
    if (this.queue.length) { this.busy = true; void this.pump(); }
  }
  async pump() {
    if (this.processing || this.disabled) return;
    this.processing = true;
    const generation = this.generation;
    const current = () => generation === this.generation;
    try {
      while (current() && this.queue.length) {
        const text = this.queue.shift(); this.status('synthesizing');
        const result = await this.engine.synthesize(text, this.mode);
        if (!current()) return;
        await this.play(result, current, () => { if (current()) this.status('speaking'); });
      }
    } catch (error) {
      if (current() && error.name !== 'AbortError') {
        this.disabled = true; this.queue = []; this.items.clear();
        this.notice('음성을 사용할 수 없어 텍스트로 계속합니다. 자막을 확인하세요.');
      }
    } finally {
      if (current()) { this.processing = false; this.busy = false; this.status('idle'); }
    }
  }
  interrupt() {
    this.generation++; this.items.clear(); this.completed.clear(); this.queue = []; this.busy = false; this.processing = false;
    this.engine.cancel?.(); this.stopAudio();
  }
  dispose() { this.interrupt(); this.disabled = true; this.engine.stop?.(); }
}

export function speechChunks(text, final = false) {
  const chunks = []; let consumed = 0;
  // Avoid speaking incomplete abbreviations/decimals as separate sentences.
  const pattern = /[.!?]+["”')\]]*(?:\s+|$)|\n+/g;
  for (const match of text.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (!final && end === text.length && !/\s$/.test(match[0])) continue;
    const candidate = text.slice(consumed, end);
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|U\.S|e\.g|i\.e)\.$/i.test(candidate.trim())) continue;
    addChunk(chunks, candidate); consumed = end;
  }
  // Bound very long sentences so a monologue never becomes one huge inference.
  while (text.length - consumed > 300) {
    const slice = text.slice(consumed, consumed + 280);
    const space = slice.lastIndexOf(' ');
    const size = space > 100 ? space + 1 : 280;
    addChunk(chunks, text.slice(consumed, consumed + size)); consumed += size;
  }
  if (final && consumed < text.length) { addChunk(chunks, text.slice(consumed)); consumed = text.length; }
  return { chunks, consumed };
}
function addChunk(chunks, text) {
  const cleaned = text.replace(/https?:\/\/\S+/g, '').replace(/[*#`_]/g, '').replace(/^\s*[-•]\s*/g, '').trim();
  if (!cleaned) return;
  // Completed sentences can exceed the streaming bound when arriving at once.
  if (cleaned.length > 380) {
    const words = cleaned.split(/\s+/); let part = '';
    for (const word of words) {
      if ((part + ' ' + word).length > 380 && part) { chunks.push(part); part = ''; }
      let rest = word;
      while (rest.length > 380) { chunks.push(rest.slice(0, 380)); rest = rest.slice(380); }
      part += (part ? ' ' : '') + rest;
    }
    if (part) chunks.push(part);
  } else chunks.push(cleaned);
}
