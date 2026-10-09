// Generation tokens isolate interrupted speech from a new conversational turn.
export class SpeechQueue {
  constructor({ engine, play, stopAudio, status = () => {}, notice = () => {}, playback = () => {} }) {
    Object.assign(this, { engine, play, stopAudio, status, notice, playback });
    this.generation = 0; this.items = new Map(); this.completed = new Set(); this.queue = []; this.mode = 'auto'; this.disabled = false;
    this.completedRanges = []; this.responseId = null; this.processing = false; this.busy = false;
  }
  configure(mode = 'auto') { this.interrupt(); this.mode = mode; this.disabled = mode === 'off'; }
  append(itemId, responseId, delta) {
    if (this.disabled || this.completed.has(itemId)) return;
    const item = this.items.get(itemId) || { responseId, text: '', offset: 0 };
    item.text += delta; this.items.set(itemId, item); this.drain(itemId, item, false);
  }
  completeItem(itemId, responseId, text) {
    if (this.disabled || this.completed.has(itemId)) return;
    const item = this.items.get(itemId) || { responseId, text: '', offset: 0 };
    // Realtime emits output_text.done even on cancellation. Only response.done
    // with completed status can flush its unfinished final sentence.
    item.text = text || item.text; this.items.set(itemId, item); this.drain(itemId, item, false);
  }
  finish(responseId) {
    for (const [id, item] of this.items) if (item.responseId === responseId) {
      this.drain(id, item, true); this.items.delete(id); this.completed.add(id);
      if (this.completed.size > 256) this.completed.delete(this.completed.values().next().value);
    }
  }
  drain(itemId, item, final) {
    const rest = item.text.slice(item.offset), baseOffset = item.offset;
    const { segments, consumed } = speechChunks(rest, final);
    item.offset += consumed;
    for (const segment of segments) {
      if (/[가-힣]/.test(segment.text)) { this.notice('한국어 설명은 자막으로 확인하세요. Piper는 영어 음성으로 읽습니다.'); continue; }
      this.queue.push({ itemId, responseId: item.responseId, ...segment,
        start: baseOffset + segment.start, end: baseOffset + segment.end });
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
        const entry = this.queue.shift(); this.status('synthesizing');
        if (entry.responseId !== this.responseId) { this.responseId = entry.responseId; this.completedRanges = []; }
        const result = await this.engine.synthesize(entry.text, this.mode);
        if (!current()) return;
        await this.play(result, current, () => { if (current()) this.status('speaking'); }, progress => {
          if (current()) this.playback({ ...entry, progress, completed: this.completedRanges.slice() });
        });
        if (!current()) return;
        this.completedRanges.push({ itemId: entry.itemId, start: entry.start, end: entry.end });
        if (this.completedRanges.length > 400) this.completedRanges.shift();
        this.playback({ ...entry, progress: 1, completed: this.completedRanges.slice() });
      }
    } catch (error) {
      if (current() && error.name !== 'AbortError') {
        this.disabled = true; this.queue = []; this.items.clear();
        this.notice('음성을 사용할 수 없어 텍스트로 계속합니다. 자막을 확인하세요.');
      }
    } finally {
      if (current()) { this.processing = false; this.busy = false; this.playback(null); this.status('idle'); }
    }
  }
  interrupt() {
    this.generation++; this.items.clear(); this.completed.clear(); this.queue = []; this.busy = false; this.processing = false;
    this.completedRanges = []; this.responseId = null; this.playback(null);
    this.engine.cancel?.(); this.stopAudio();
  }
  dispose() { this.interrupt(); this.disabled = true; this.engine.stop?.(); }
}

export function speechChunks(text, final = false) {
  const segments = []; let consumed = 0;
  // Avoid speaking incomplete abbreviations/decimals as separate sentences.
  const pattern = /[.!?]+["”')\]]*(?:\s+|$)|\n+/g;
  for (const match of text.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (!final && end === text.length && !/\s$/.test(match[0])) continue;
    const candidate = text.slice(consumed, end);
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|U\.S|e\.g|i\.e)\.$/i.test(candidate.trim())) continue;
    addChunk(segments, candidate, consumed); consumed = end;
  }
  // Bound very long sentences so a monologue never becomes one huge inference.
  while (text.length - consumed > 300) {
    const slice = text.slice(consumed, consumed + 280);
    const space = slice.lastIndexOf(' ');
    const size = space > 100 ? space + 1 : 280;
    addChunk(segments, text.slice(consumed, consumed + size), consumed); consumed += size;
  }
  if (final && consumed < text.length) { addChunk(segments, text.slice(consumed), consumed); consumed = text.length; }
  return { chunks: segments.map(segment => segment.text), segments, consumed };
}

function addChunk(segments, text, offset) {
  const cleaned = text.replace(/https?:\/\/\S+/g, '').replace(/[*#`_]/g, '').replace(/^\s*[-•]\s*/g, '').trim();
  if (!cleaned) return;
  let searchCursor = 0;
  const add = part => {
    const index = text.indexOf(part, searchCursor), start = index < 0 ? offset : offset + index;
    if (index >= 0) searchCursor = index + part.length;
    segments.push({ text: part, start, end: index < 0 ? offset + text.length : start + part.length });
  };
  // Completed sentences can exceed the streaming bound when arriving at once.
  if (cleaned.length > 380) {
    const words = cleaned.split(/\s+/); let part = '';
    for (const word of words) {
      if ((part + ' ' + word).length > 380 && part) { add(part); part = ''; }
      let rest = word;
      while (rest.length > 380) { add(rest.slice(0, 380)); rest = rest.slice(380); }
      part += (part ? ' ' : '') + rest;
    }
    if (part) add(part);
  } else add(cleaned);
}
