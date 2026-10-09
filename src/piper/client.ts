import { withCpuFallback } from './fallback.js';
import type { VisemeCue } from '../../shared/visemes.js';

export type Result = { backend: string; pcm: Float32Array; sampleRate: number; inferenceMs: number; phonemizeMs: number; phonemes: number; visemes?: VisemeCue[] };
export class PiperClient {
  private worker?: Worker;
  private mode = '';
  private forceCpu = false;
  private pendingAbort?: () => void;
  constructor(private report: (event: Record<string, any>) => void) {}

  async synthesize(text: string, mode: string): Promise<Result> {
    if (this.pendingAbort) throw new Error('이전 합성이 진행 중입니다. 중지 후 다시 시도하세요.');
    if (!text.trim() || text.length > 400) throw new Error('영어 문장을 1~400자로 입력하세요.');
    return withCpuFallback((choice: string) => this.attempt(text, choice), this.forceCpu ? 'wasm' : mode, (error: Error) => {
      this.destroyWorker(); this.forceCpu = true;
      this.report({ type: 'fallback', message: 'GPU 실행이 실패해 CPU로 다시 시도합니다.', detail: error.message });
    });
  }

  private attempt(text: string, mode: string): Promise<Result> {
    if (mode !== this.mode) this.destroyWorker();
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.mode = mode;
    }
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      let backend = mode === 'wasm' ? 'wasm' : 'unknown';
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', failed);
        this.pendingAbort = undefined;
      };
      const finishError = (error: Error) => { cleanup(); this.destroyWorker(); reject(error); };
      const deadline = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => finishError(Object.assign(new Error('음성 생성 시간이 초과되었습니다.'), {
          retryOnCpu: backend === 'webgpu+wasm',
        })), ms);
      };
      const message = ({ data }: MessageEvent) => {
        this.report(data);
        if (data.type === 'backend') backend = data.backend;
        if (data.type === 'progress' && ['load', 'inference'].includes(data.stage)) deadline(60000);
        if (data.type === 'result') { cleanup(); resolve(data); }
        if (data.type === 'failure') finishError(Object.assign(new Error(data.message), { retryOnCpu: data.retryOnCpu }));
      };
      const failed = (event: ErrorEvent) => { event.preventDefault(); finishError(Object.assign(new Error(event.message || '음성 실행 환경을 시작하지 못했습니다.'), {
        retryOnCpu: backend === 'webgpu+wasm',
      })); };
      this.pendingAbort = () => finishError(new DOMException('합성을 중지했습니다.', 'AbortError'));
      worker.addEventListener('message', message);
      worker.addEventListener('error', failed);
      deadline(120000);
      worker.postMessage({ text, mode, base: new URL(`${import.meta.env.BASE_URL}piper/`, location.origin).href });
    });
  }

  private destroyWorker() { this.worker?.terminate(); this.worker = undefined; this.mode = ''; }
  // Keep a loaded idle model warm across turns; terminate only active synthesis.
  cancel() { this.pendingAbort?.(); }
  stop() { this.pendingAbort?.(); this.destroyWorker(); }
  reset() { this.stop(); this.forceCpu = false; }
}
