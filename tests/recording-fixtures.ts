import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);
export async function recordingFixture(kind: "audio" | "circle", seconds = 1) {
  const directory = await mkdtemp(join(tmpdir(), "beacon-recording-fixture-"));
  try {
    const file = join(directory, "source.webm");
    const args = ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"];
    if (kind === "circle") args.push("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=12", "-c:v", "libvpx", "-b:v", "200k");
    args.push("-t", String(seconds), "-c:a", "libopus", file);
    await exec("ffmpeg", args, { timeout: 20000 });
    return await readFile(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
