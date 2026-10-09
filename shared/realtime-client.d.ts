export type Message = { id: string; role: 'user' | 'assistant'; text: string; partial?: boolean; prompted?: boolean; interrupted?: boolean; timestamp: string };
export type Source = { filename: string; text: string; score: number | null };
export type Config = { topic: string; level: string; support: string; correction: string; voice?: string; speechMode?: 'auto' | 'wasm' | 'off'; learnerContext: string; evaluateAudio?: boolean };
export type AudioSample = { data: string; seconds: number; limited: boolean; segments: { id: string; start: number; end: number }[] };
export type SpeechCue = { itemId: string; responseId: string; text: string; start: number; end: number; progress: number; completed: { itemId: string; start: number; end: number }[] } | null;
export type Snapshot = {
  status: string; connected: boolean; micMuted: boolean; textOnly: boolean; error: string; needsPlayback: boolean;
  messages: Message[]; sources: Source[]; searchCount: number; logs: { type: string; time: string; detail: string }[];
  startedAt: number | null; durationSeconds: number; connectionMs: number | null; latencyMs: number | null; turns: number;
  evaluationAudio?: Promise<{ audio: AudioSample | null; notice: string }>;
  recordingNotice?: string;
  voiceStatus: string; voiceNotice: string; voiceBackend: string; voiceProgress: string;
  speechCue: SpeechCue;
};
export type SpeechAdapter = {
  readonly busy: boolean;
  attachAudio(node: HTMLAudioElement | null): void;
  configure(mode: string, hooks: { status(value: string): void; notice(value: string): void; backend(value: string): void; progress(value: string): void; playbackBlocked(value: boolean): void; playbackStarted(): void; playback(value: SpeechCue): void }): void;
  append(itemId: string, responseId: string, delta: string): void;
  completeItem(itemId: string, responseId: string, text: string): void;
  finish(responseId: string): void; interrupt(): void; dispose(): void; resume(): Promise<void>;
};
export class RealtimeClient {
  constructor(options?: { voice?: SpeechAdapter });
  getSnapshot: () => Snapshot;
  subscribe: (listener: () => void) => () => void;
  attachAudio: (node: HTMLAudioElement | null) => void;
  start(config: Config, textOnly?: boolean): Promise<void>;
  stop(): Snapshot;
  text(text: string, prompted?: boolean): boolean;
  toggleMic(): void;
  playAudio(): Promise<void>;
  dismissError(): void;
}
