import './style.css';
import { PiperClient, type Result } from './client';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('synthesis-form');
const text = element<HTMLTextAreaElement>('text');
const mode = element<HTMLSelectElement>('mode');
const status = element('status');
const failure = element('failure');
const run = element<HTMLButtonElement>('run');
const stop = element<HTMLButtonElement>('stop');
const audio = element<HTMLAudioElement>('audio');
const metrics = element('metrics');
const log = element('log');
let audioURL = '';
let latest = 0;
let loadMs = 0;
const labels: Record<string, string> = { phonemizer: '영어 발음 변환기를 준비합니다.', load: '음성 모델을 불러옵니다.', inference: '음성을 생성합니다.' };
const client = new PiperClient(event => {
  if (event.type === 'progress') {
    status.textContent = event.stage === 'download'
      ? `파일 다운로드 중 · ${event.file} · ${(event.loaded / 1000000).toFixed(1)}${event.total ? ` / ${(event.total / 1000000).toFixed(1)}` : ''} MB`
      : labels[event.stage] || '음성을 준비합니다.';
  } else {
    const { pcm: _pcm, ...entry } = event;
    log.textContent = (log.textContent + JSON.stringify(entry) + '\n').split('\n').slice(-30).join('\n');
    if (event.type === 'fallback' || event.fallbackReason) status.textContent = event.message || event.fallbackReason;
    if (event.type === 'loaded') loadMs = event.loadMs;
  }
});
function clearAudio() { audio.pause(); audio.removeAttribute('src'); audio.load(); audio.hidden = true; if (audioURL) URL.revokeObjectURL(audioURL); audioURL = ''; }
function wav(result: Result) {
  const view = new DataView(new ArrayBuffer(44 + result.pcm.length * 2));
  const word = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, view.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, result.sampleRate, true); view.setUint32(28, result.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, result.pcm.length * 2, true);
  result.pcm.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); });
  return new Blob([view.buffer], { type: 'audio/wav' });
}
function showMetrics(result: Result, elapsed: number) {
  const seconds = result.pcm.length / result.sampleRate;
  const values = [['실행 방식', result.backend === 'wasm' ? 'CPU · WASM' : 'GPU + CPU · WebGPU/WASM'], ['합성 시간', `${(result.inferenceMs / 1000).toFixed(2)}초`],
    ['음성 길이', `${seconds.toFixed(2)}초`], ['합성 / 음성 길이', `${(result.inferenceMs / 1000 / seconds).toFixed(2)} (1 미만이면 재생보다 빠름)`],
    ['최초 모델 로딩', `${(loadMs / 1000).toFixed(2)}초`], ['이번 전체 대기', `${(elapsed / 1000).toFixed(2)}초`]];
  metrics.replaceChildren(...values.flatMap(([name, value]) => { const dt = document.createElement('dt'); dt.textContent = name; const dd = document.createElement('dd'); dd.textContent = value; return [dt, dd]; }));
  metrics.hidden = false;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const generation = ++latest; clearAudio(); failure.hidden = true; metrics.hidden = true;
  run.disabled = true; mode.disabled = true; stop.disabled = false; status.textContent = '음성을 준비합니다.';
  const began = performance.now();
  try {
    const result = await client.synthesize(text.value.trim(), mode.value);
    if (generation !== latest) return;
    audioURL = URL.createObjectURL(wav(result)); audio.src = audioURL; audio.hidden = false;
    showMetrics(result, performance.now() - began);
    status.textContent = '음성이 준비됐습니다. 재생 버튼을 눌러 들어보세요.';
  } catch (error) {
    if (generation !== latest) return;
    const message = error instanceof Error ? error.message : String(error);
    failure.textContent = `음성을 만들지 못했습니다. ${message} 입력 문장은 유지됩니다. 다시 시도하거나 텍스트로 사용하세요.`;
    failure.hidden = false; status.textContent = '텍스트 사용 가능';
  } finally {
    if (generation === latest) { run.disabled = false; mode.disabled = false; stop.disabled = true; }
  }
});
stop.addEventListener('click', () => { latest++; client.stop(); clearAudio(); status.textContent = '중지했습니다. 다시 실행할 수 있습니다.'; run.disabled = false; mode.disabled = false; stop.disabled = true; });
mode.addEventListener('change', () => { latest++; client.reset(); clearAudio(); metrics.hidden = true; loadMs = 0; });
window.addEventListener('pagehide', () => { client.stop(); clearAudio(); });
