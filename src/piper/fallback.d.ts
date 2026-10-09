export function withCpuFallback<T>(attempt: (mode: string) => Promise<T>, mode: string, onFallback?: (error: Error) => void): Promise<T>;
export function finitePcm(data: Float32Array): Float32Array;
