export class SpeechQueue {
  constructor(options: { engine: { synthesize(text: string, mode: string): Promise<any>; cancel?(): void; stop?(): void }; play(result: any, current: () => boolean, started: () => void): Promise<void>; stopAudio(): void; status?(status: string): void; notice?(message: string): void });
  busy: boolean;
  disabled: boolean;
  configure(mode?: string): void;
  append(itemId: string, responseId: string, delta: string): void;
  completeItem(itemId: string, responseId: string, text: string): void;
  finish(responseId: string): void;
  interrupt(): void;
  dispose(): void;
}
