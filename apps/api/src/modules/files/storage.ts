import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdir, readFile, writeFile, unlink, open, stat } from "node:fs/promises";
import path from "node:path";
export interface FileStorage {
  info(key: string): Promise<{size:number}|null>;
  save(key: string, bytes: Uint8Array): Promise<void>;
  saveStream(key: string, stream: Readable): Promise<void>;
  readStream(key: string, start?: number, end?: number): Promise<Readable>;
  read(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
export class LocalStorage implements FileStorage {
  constructor(private root = process.env.MEDIA_ROOT ?? "/data/media") {}
  private file(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, key);
  }
  async info(key:string) {
    try { const result=await stat(this.file(key));return {size:result.size}; }
    catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
  }
  async save(key: string, bytes: Uint8Array) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file(key), bytes, { flag: "wx", mode: 0o600 });
  }
  async saveStream(key: string, stream: Readable) {
    await mkdir(this.root, { recursive: true });
    await pipeline(stream, createWriteStream(this.file(key), { flags: "wx", mode: 0o600 }));
  }
  async readStream(key: string, start?: number, end?: number) {
    const handle = await open(this.file(key), "r");
    return handle.createReadStream({ start, end, autoClose: true });
  }
  async read(key: string) {
    return readFile(this.file(key));
  }
  async remove(key: string) {
    await unlink(this.file(key)).catch(error=>{if(error.code!=="ENOENT")throw error;});
  }
}
