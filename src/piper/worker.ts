/// <reference types="@webgpu/types" />
/// <reference lib="webworker" />
import { finitePcm } from './fallback.js';
import { phonemeTimeline } from '../../shared/visemes.js';
import type * as ORT from 'onnxruntime-web';

type Config = { audio: { sample_rate: number }; espeak: { voice: string }; num_speakers: number;
  phoneme_id_map: Record<string, number[]>; hop_length: number;
  inference: { noise_scale: number; length_scale: number; noise_w: number } };
type Manifest = { version: string; model: string; config: string; bytes: number };
const scope = self as unknown as DedicatedWorkerGlobalScope;
let ort: typeof ORT;
let session: ORT.InferenceSession | undefined;
let config: Config;
let phonemizer: { callMain(args: string[]): number };
let printed: { phoneme_ids: number[] } | undefined;
let phase = 'assets';
let backend = 'wasm';
const report = (message: Record<string, unknown>) => scope.postMessage(message);

async function cachedBytes(url: string, cacheName: string, expectedBytes?: number) {
  let cache: Cache | undefined;
  try { cache = await caches.open(cacheName); } catch { /* Private mode/quota must not prevent synthesis. */ }
  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    const data = await cached.arrayBuffer();
    if (!expectedBytes || data.byteLength === expectedBytes) return data;
    await cache?.delete(url).catch(() => {});
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`다운로드 실패 (${response.status}): ${new URL(url).pathname}`);
  const reader = response.body?.getReader();
  const parts: Uint8Array[] = [];
  const total = expectedBytes || Number(response.headers.get('content-length'));
  let loaded = 0;
  if (!reader) throw new Error('이 브라우저에서는 모델 다운로드를 읽을 수 없습니다.');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.byteLength;
    report({ type: 'progress', stage: 'download', loaded, total, file: new URL(url).pathname.split('/').at(-1) });
  }
  if (expectedBytes && loaded !== expectedBytes) throw new Error('모델 다운로드가 불완전합니다. 다시 시도하세요.');
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.byteLength; }
  try { await cache?.put(url, new Response(data, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* Cache storage can be full. */ }
  return data.buffer;
}

async function load(base: string, mode: string) {
  phase = 'assets';
  const url = (part: string) => new URL(part, base).href;
  const manifestResponse = await fetch(url('models/manifest.json'), { signal: AbortSignal.timeout(15000) });
  if (!manifestResponse.ok) throw new Error('모델 파일이 준비되지 않았습니다. npm run prepare:piper를 실행하세요.');
  const manifest: Manifest = await manifestResponse.json();
  const response = await fetch(url(manifest.config), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('모델 설정 파일을 읽지 못했습니다.');
  config = await response.json();
  if (config.num_speakers !== 1) throw new Error('단일 화자 모델이 필요합니다.');
  const bytes = await cachedBytes(url(manifest.model), `hiring-piper-model-${manifest.version}`, manifest.bytes);
  const [wasmBinary, dataBinary] = await Promise.all(['wasm', 'data'].map(ext =>
    cachedBytes(url(`runtime/piper_phonemize.${ext}`), 'hiring-piper-phonemizer-1.0.0')));
  report({ type: 'progress', stage: 'phonemizer' });
  const { default: createPiperPhonemize } = await import(/* @vite-ignore */ url('runtime/piper_phonemize.mjs'));
  phonemizer = await createPiperPhonemize({
    wasmBinary, getPreloadedPackage: () => dataBinary, noInitialRun: true,
    locateFile: (name: string) => url(`runtime/${name}`),
    print: (line: string) => { printed = JSON.parse(line); },
    printErr: (line: string) => { throw new Error(`발음 변환 실패: ${line}`); },
  });
  phase = 'gpu';
  // A browser may expose navigator.gpu but return no usable adapter.
  let adapter;
  if (mode !== 'wasm') try { adapter = await navigator.gpu?.requestAdapter(); } catch { /* Use CPU. */ }
  backend = adapter ? 'webgpu+wasm' : 'wasm';
  report({ type: 'backend', backend, fallbackReason: mode !== 'wasm' && !adapter ? '이 브라우저에서 GPU를 사용할 수 없어 CPU로 실행합니다.' : '' });
  ort = adapter ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmPaths = url('runtime/');
  ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ort.env.logLevel = 'warning';
  if (adapter) ort.env.webgpu.adapter = adapter;
  report({ type: 'progress', stage: 'load', backend });
  const began = performance.now();
  session = await ort.InferenceSession.create(bytes, {
    executionProviders: adapter ? ['webgpu', 'wasm'] : ['wasm'],
    freeDimensionOverrides: { batch_size: 1 },
  });
  report({ type: 'loaded', backend, loadMs: performance.now() - began });
}

scope.onmessage = async ({ data }) => {
  try {
    if (!session) await load(data.base, data.mode);
    phase = 'phonemize'; printed = undefined;
    const began = performance.now();
    const result = phonemizer.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text: data.text }]), '--espeak_data', '/espeak-ng-data']);
    const output = printed as { phoneme_ids: number[] } | undefined;
    if (result !== 0 || !output?.phoneme_ids.length) throw new Error('문장을 발음 기호로 바꾸지 못했습니다.');
    const ids = output.phoneme_ids;
    const phonemizeMs = performance.now() - began;
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(ids.length)), [1]),
      scales: new ort.Tensor('float32', Float32Array.of(config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w), [3]),
    };
    phase = 'inference';
    report({ type: 'progress', stage: 'inference', backend });
    const start = performance.now();
    const outputs = await session!.run(feeds);
    let pcm: Float32Array;
    let visemes: ReturnType<typeof phonemeTimeline> = [];
    try {
      pcm = Float32Array.from(finitePcm(await outputs.output.getData() as Float32Array));
      if (outputs.phoneme_durations) {
        try {
          visemes = phonemeTimeline(ids, await outputs.phoneme_durations.getData() as Float32Array,
            config.phoneme_id_map, pcm.length, config.audio.sample_rate, config.hop_length);
        } catch { /* Optional visual timing must never prevent speech. */ }
      }
    } finally { Object.values(outputs).forEach(tensor => tensor.dispose()); }
    report({ type: 'result', backend, pcm, sampleRate: config.audio.sample_rate,
      phonemizeMs, inferenceMs: performance.now() - start, phonemes: ids.length, visemes });
  } catch (error) {
    report({ type: 'failure', phase, backend, retryOnCpu: backend === 'webgpu+wasm' && ['gpu', 'inference'].includes(phase),
      message: error instanceof Error ? error.message : String(error) });
  }
};
