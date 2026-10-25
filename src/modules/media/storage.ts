import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
export interface FileStorage {
  save(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
export class LocalStorage implements FileStorage {
  constructor(private root = process.env.MEDIA_ROOT ?? "/data/media") {}
  private file(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, key);
  }
  async save(key: string, bytes: Uint8Array) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file(key), bytes, { flag: "wx", mode: 0o600 });
  }
  async read(key: string) {
    return readFile(this.file(key));
  }
  async remove(key: string) {
    await unlink(this.file(key));
  }
}
export const storage: FileStorage = new LocalStorage();
export function mediaUrl(id: string) {
  return `${process.env.MEDIA_BASE_URL?.replace(/\/$/, "") ?? ""}/media/${id}`;
}
export function imageMime(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
