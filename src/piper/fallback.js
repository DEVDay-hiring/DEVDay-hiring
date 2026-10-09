// Recover a failed GPU worker in a fresh CPU worker; never retry a cancellation.
export async function withCpuFallback(attempt, mode, onFallback = () => {}) {
  try { return await attempt(mode); }
  catch (error) {
    if (mode === 'wasm' || error.name === 'AbortError' || !error.retryOnCpu) throw error;
    onFallback(error);
    return attempt('wasm');
  }
}

export function finitePcm(data) {
  if (!data.length || !data.every(Number.isFinite)) throw new Error('음성 출력이 비어 있거나 손상되었습니다.');
  if (!data.some(value => Math.abs(value) > 0.00001)) throw new Error('모델이 무음만 반환했습니다.');
  return data;
}
