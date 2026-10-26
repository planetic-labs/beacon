export const recordingLimits = {
  audio: { seconds: 300, bytes: 10 * 1024 * 1024, title: "Голосовое сообщение" },
  circle: { seconds: 60, bytes: 25 * 1024 * 1024, title: "Видеокружок" },
} as const;
export type RecordingKind = keyof typeof recordingLimits;
