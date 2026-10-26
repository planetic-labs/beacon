import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordingLimits, type RecordingKind } from "@beacon/shared";
import { HttpError } from "@api/lib/http";
const exec = promisify(execFile);
let active = 0;

// Keep this adapter independent of controllers so normalization can move to a worker.
export async function prepareRecording(bytes: Uint8Array, kind: RecordingKind) {
  const limit = recordingLimits[kind];
  if (!bytes.length || bytes.length > limit.bytes) throw new HttpError(400, "Запись слишком большая");
  const b = Buffer.from(bytes);
  const format = b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? "matroska" : b.toString("ascii", 4, 8) === "ftyp" ? "mov" : null;
  if (!format) throw new HttpError(400, "Неподдерживаемый формат записи");
  if (active >= 2) throw new HttpError(429, "Сервер обрабатывает записи. Повторите отправку чуть позже");
  active++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "beacon-recording-"));
    const source = join(directory, "input"), output = join(directory, kind === "audio" ? "output.m4a" : "output.mp4");
    await writeFile(source, bytes, { mode: 0o600 });
    const probe = await exec("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", format, "-show_streams", "-show_format", "-of", "json", source], { timeout: 10000, maxBuffer: 512 * 1024 });
    const metadata = JSON.parse(probe.stdout);
    const streams = metadata.streams as { codec_type: string; width?: number; height?: number; channels?: number; sample_rate?: string }[];
    if (!streams?.some(s => s.codec_type === "audio") || kind === "audio" && streams.some(s => s.codec_type === "video"))
      throw new HttpError(400, "В записи отсутствует звук или выбран неверный тип");
    const audio = streams.find(s => s.codec_type === "audio");
    if ((audio?.channels ?? 0) > 8 || Number(audio?.sample_rate ?? 0) > 192000)
      throw new HttpError(400, "Неподдерживаемые параметры звука");
    const video = streams.find(s => s.codec_type === "video");
    if (kind === "circle" && (!video || !video.width || !video.height || video.width * video.height > 1920 * 1080))
      throw new HttpError(400, "Для кружка нужно видео со звуком, не больше Full HD");
    const duration = Number(metadata.format?.duration);
    if (Number.isFinite(duration) && duration > limit.seconds + 0.75) throw new HttpError(400, "Запись превышает допустимую длительность");
    const args = ["-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-f", format, "-threads", "2", "-i", source, "-t", String(limit.seconds + 1), "-map_metadata", "-1", "-map_chapters", "-1", "-threads", "2", "-filter_threads", "1"];
    if (kind === "circle") args.push("-map", "0:v:0", "-map", "0:a:0", "-vf", "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,setsar=1", "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p");
    else args.push("-map", "0:a:0", "-vn");
    args.push("-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "48000", "-movflags", "+faststart", output);
    await exec("ffmpeg", args, { timeout: 120000, maxBuffer: 512 * 1024 });
    const checked = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", output], { timeout: 10000, maxBuffer: 65536 });
    const actualDuration = Number(JSON.parse(checked.stdout).format?.duration);
    if (!Number.isFinite(actualDuration) || actualDuration <= 0 || actualDuration > limit.seconds + 0.75)
      throw new HttpError(400, "Запись пустая или превышает допустимую длительность");
    const result = await readFile(output);
    if (result.length > limit.bytes) throw new HttpError(400, "Запись слишком большая");
    return { bytes: result, mime: kind === "audio" ? "audio/mp4" : "video/mp4", duration: actualDuration };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Не удалось обработать запись. Попробуйте записать ещё раз");
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    active--;
  }
}
