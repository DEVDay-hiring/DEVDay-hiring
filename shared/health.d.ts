export type Health = { ok: boolean; apiKeyConfigured: boolean; knowledgeConfigured: boolean; model: string };
export function getHealth(signal?: AbortSignal): Promise<Health>;
