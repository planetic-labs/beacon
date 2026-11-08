/** Server-only contract, independent of the recognition provider. */
export type TranscriptionInput = {
  /** Recording bytes validated and size-limited by Beacon before dispatch. */
  audio: Uint8Array;
  mimeType: string;
  /** Optional language hint; omit to let the provider detect it. */
  language?: string;
};
export type TranscriptionResult = {
  text: string;
  language?: string;
};
/** Implement with an external API or a self-hosted service without changing callers. */
export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput, options: { signal: AbortSignal }): Promise<TranscriptionResult>;
}
