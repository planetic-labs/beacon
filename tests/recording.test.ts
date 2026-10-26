import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareRecording } from "../apps/api/src/modules/media/recording";
import { recordingFixture } from "./recording-fixtures";
test("recordings normalize audio and circular video into compatible MP4 containers", async () => {
  for (const kind of ["audio", "circle"] as const) {
    const result = await prepareRecording(await recordingFixture(kind), kind);
    assert.equal(result.mime, kind === "audio" ? "audio/mp4" : "video/mp4");
    assert.equal(result.bytes.toString("ascii", 4, 8), "ftyp");
    assert.ok(result.duration > 0 && result.duration < 2);
  }
});
test("recording processing rejects invalid media, mismatched types and excess duration", async () => {
  await assert.rejects(prepareRecording(Buffer.from("invalid"), "audio"), (e: { status: number }) => e.status === 400);
  await assert.rejects(prepareRecording(await recordingFixture("audio"), "circle"), (e: { status: number }) => e.status === 400);
  await assert.rejects(prepareRecording(await recordingFixture("circle"), "audio"), (e: { status: number }) => e.status === 400);
  await assert.rejects(prepareRecording(await recordingFixture("audio", 302), "audio"), (e: { status: number }) => e.status === 400);
});
