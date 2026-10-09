// Capture only the local microphone, never the AI output. Keep at most the first
// 3 minutes in memory and send up to 90 seconds of VAD-selected learner speech.
export class SpeechCapture {
  constructor(stream) {
    this.segments = []; this.chunks = []; this.closed = false; this.limited = false;
    this.startedAt = performance.now(); this.bytes = 0;
    this.recorder = new MediaRecorder(stream);
    this.finished = new Promise(resolve => { this.resolve = resolve; });
    this.recorder.ondataavailable = e => {
      if (e.data.size && this.bytes + e.data.size <= 8_000_000) { this.chunks.push(e.data); this.bytes += e.data.size; }
      else if (e.data.size) this.limited = true;
    };
    this.recorder.onerror = () => { this.failed = true; this.resolve(); };
    this.recorder.onstop = () => this.resolve();
    this.recorder.start(1000);
    this.timer = setTimeout(() => { this.limited = true; this.stopRecording(); }, 180000);
  }
  speechStart(id) {
    if (this.closed) return;
    if (this.active) this.speechStop(this.active.id);
    this.active = { id, start: Math.max(0, (performance.now() - this.startedAt) / 1000 - .6) };
  }
  speechStop(id) {
    if (!this.active || id !== this.active.id) return;
    this.segments.push({ ...this.active, end: (performance.now() - this.startedAt) / 1000 }); this.active = null;
  }
  stopRecording() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer);
    if (this.active) this.speechStop(this.active.id);
    if (this.recorder.state !== 'inactive') this.recorder.stop(); else this.resolve();
  }
  finish() {
    if (this.result) return this.result;
    this.stopRecording();
    this.result = this.encode().catch(() => ({ audio: null, notice: '평가용 녹음을 처리하지 못해 텍스트로만 평가합니다.' }));
    return this.result;
  }
  discard() {
    this.stopRecording(); this.failed = true;
    void this.finished.then(() => { this.chunks = []; });
  }
  async encode() {
    await this.finished;
    if (this.failed || !this.chunks.length || !this.segments.length) {
      this.chunks = []; return { audio: null, notice: '평가할 음성이 없습니다. 마이크로 영어 문장을 말해 주세요.' };
    }
    const blob = new Blob(this.chunks, { type: this.recorder.mimeType }); this.chunks = [];
    const context = new AudioContext({ sampleRate: 16000 });
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const result = selectSpeech(decoded.getChannelData(0), decoded.sampleRate, this.segments);
      if (!result.samples.length) return { audio: null, notice: '평가할 음성 구간이 없습니다.' };
      const wav = encodeWav(result.samples, decoded.sampleRate);
      let binary = ''; const bytes = new Uint8Array(wav);
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { audio: { data: btoa(binary), seconds: result.samples.length / decoded.sampleRate,
        segments: result.segments, limited: this.limited || result.limited },
        notice: this.limited || result.limited ? '긴 대화는 첫 3분 내 사용자 음성 중 최대 90초를 표본 평가합니다.' : '사용자 마이크의 발화 구간을 평가합니다.' };
    } finally { await context.close(); }
  }
}

export function selectSpeech(pcm, rate, segments) {
  const parts = [], selected = []; let used = 0, previousEnd = 0, limited = false;
  for (const segment of segments) {
    const start = Math.max(previousEnd, Math.floor(segment.start * rate));
    const end = Math.min(pcm.length, Math.floor(segment.end * rate), start + 90 * rate - used);
    if (end <= start) { limited = true; continue; }
    parts.push(pcm.slice(start, end));
    selected.push({ id: segment.id, start: used / rate, end: (used + end - start) / rate });
    used += end - start; previousEnd = end;
    if (end < Math.floor(segment.end * rate)) limited = true;
  }
  const samples = new Float32Array(used); let cursor = 0;
  for (const part of parts) { samples.set(part, cursor); cursor += part.length; }
  return { samples, segments: selected, limited };
}
export function encodeWav(samples, rate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return bytes;
}
