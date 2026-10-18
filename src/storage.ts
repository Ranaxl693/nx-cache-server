import { constants } from 'node:fs';
import {
  mkdir,
  open,
  link,
  unlink,
  readdir,
  stat,
  access,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
export class CacheError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validateHash(hash: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(hash))
    throw new CacheError(400, 'Invalid cache key');
}
export interface Artifact {
  size: number;
  stream: Readable;
}
export interface Storage {
  get(hash: string): Promise<Artifact | null>;
  put(hash: string, artifact: Readable, size: number): Promise<void>;
  exists(hash: string): Promise<boolean>;
  ready(): Promise<void>;
}
const code = (e: unknown) => (e as NodeJS.ErrnoException).code;
export class FilesystemStorage implements Storage {
  constructor(
    private directory: string,
    private maxBytes: number,
  ) {}
  private path(hash: string) {
    validateHash(hash);
    return join(this.directory, hash);
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Single server owns this directory. Never remove another active server's temp files.
    for (const name of await readdir(this.directory)) {
      if (name.startsWith('.upload-')) {
        const path = join(this.directory, name);
        if (Date.now() - (await stat(path)).mtimeMs > 86400000)
          await unlink(path);
      }
    }
  }
  async ready() {
    await access(this.directory, constants.R_OK | constants.W_OK);
  }
  async exists(hash: string) {
    const a = await this.get(hash);
    if (!a) return false;
    a.stream.destroy();
    return true;
  }
  async get(hash: string): Promise<Artifact | null> {
    let file;
    try {
      file = await open(
        this.path(hash),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (e) {
      if (code(e) === 'ENOENT') return null;
      throw e;
    }
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error('Not regular file');
      return {
        size: info.size,
        stream: file.createReadStream({ autoClose: true }),
      };
    } catch (e) {
      await file.close();
      throw e;
    }
  }
  async put(hash: string, artifact: Readable, size: number) {
    const destination = this.path(hash);
    if (size > this.maxBytes) throw new CacheError(413, 'Artifact too large');
    const temporary = join(this.directory, `.upload-${randomUUID()}`);
    const file = await open(temporary, 'wx', 0o600);
    let bytes = 0;
    try {
      for await (const chunk of artifact) {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string);
        bytes += buffer.length;
        if (bytes > size || bytes > this.maxBytes)
          throw new CacheError(413, 'Artifact too large');
        let offset = 0;
        while (offset < buffer.length) {
          const result = await file.write(
            buffer,
            offset,
            buffer.length - offset,
          );
          offset += result.bytesWritten;
        }
      }
      if (bytes !== size) throw new CacheError(400, 'Incomplete artifact');
      await file.sync();
      await file.close();
      try {
        await link(temporary, destination);
      } catch (e) {
        if (code(e) === 'EEXIST')
          throw new CacheError(409, 'Cache entry already exists');
        throw e;
      }
      const directory = await open(this.directory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
}
