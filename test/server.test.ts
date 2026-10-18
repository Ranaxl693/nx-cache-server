import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { request } from 'node:http';
import { configuration, type Config } from '../src/config.js';
import { FilesystemStorage, type Storage } from '../src/storage.js';
import { createCacheServer } from '../src/server.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(override?: Storage) {
  const directory = await mkdtemp(join(tmpdir(), 'nx-http-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    directory,
    readToken: 'r'.repeat(64),
    writeToken: 'w'.repeat(64),
    maxBytes: 100,
    maxUploads: 4,
  };
  const disk = new FilesystemStorage(directory, 100);
  await disk.initialize();
  const app = createCacheServer(config, override ?? disk, () => {});
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  cleanup.push(app.shutdown);
  const address = app.server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const headers = {
    authorization: `Bearer ${config.writeToken}`,
    'content-type': 'application/octet-stream',
  };
  return { ...app, disk, base, headers, config, directory };
}
describe('HTTP protocol', () => {
  it('uploads, downloads and reports a miss', async () => {
    const a = await setup();
    expect(
      (await fetch(a.base + '/v1/cache/missing', { headers: a.headers }))
        .status,
    ).toBe(404);
    expect(
      (
        await fetch(a.base + '/v1/cache/123', {
          method: 'PUT',
          headers: a.headers,
          body: 'artifact',
        })
      ).status,
    ).toBe(200);
    const result = await fetch(a.base + '/v1/cache/123', {
      headers: { authorization: `Bearer ${a.config.readToken}` },
    });
    expect(result.status).toBe(200);
    expect(result.headers.get('content-length')).toBe('8');
    expect(await result.text()).toBe('artifact');
    expect(a.metrics.hits).toBe(1);
  });
  it('rejects missing and invalid tokens and prevents read-only writes', async () => {
    const a = await setup();
    for (const authorization of ['', 'Bearer invalid'])
      expect(
        (await fetch(a.base + '/v1/cache/123', { headers: { authorization } }))
          .status,
      ).toBe(401);
    expect(
      (
        await fetch(a.base + '/v1/cache/123', {
          method: 'PUT',
          headers: {
            ...a.headers,
            authorization: `Bearer ${a.config.readToken}`,
          },
          body: 'x',
        })
      ).status,
    ).toBe(403);
  });
  it('rejects duplicate and concurrent overwrites', async () => {
    const a = await setup();
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        fetch(a.base + '/v1/cache/123', {
          method: 'PUT',
          headers: a.headers,
          body: String(i),
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(
      (
        await fetch(a.base + '/v1/cache/123', {
          method: 'PUT',
          headers: a.headers,
          body: 'replace',
        })
      ).status,
    ).toBe(409);
    expect(
      (await readdir(a.directory)).filter((n) => n.startsWith('.upload-')),
    ).toEqual([]);
  });
  it('rejects invalid hashes and traversal', async () => {
    const a = await setup();
    for (const path of [
      '%2e%2e%2fsecret',
      '..',
      '%00',
      'a.b',
      'x'.repeat(129),
      '%2Fetc%2Fpasswd',
    ]) {
      expect(
        (await fetch(a.base + '/v1/cache/' + path, { headers: a.headers }))
          .status,
      ).toBe(400);
    }
  });
  it('rejects oversized uploads', async () => {
    const a = await setup();
    expect(
      (
        await fetch(a.base + '/v1/cache/123', {
          method: 'PUT',
          headers: a.headers,
          body: 'x'.repeat(101),
        })
      ).status,
    ).toBe(413);
    expect(await a.disk.exists('123')).toBe(false);
  });
  it('does not commit incomplete streams', async () => {
    const a = await setup();
    await expect(
      a.disk.put('123', Readable.from(['short']), 20),
    ).rejects.toThrow('Incomplete');
    expect(await a.disk.exists('123')).toBe(false);
    expect(await readdir(a.directory)).toEqual([]);
  });
  it('cleans up streams that fail', async () => {
    const a = await setup();
    async function* broken() {
      yield Buffer.from('x');
      throw new Error('broken');
    }
    await expect(
      a.disk.put('123', Readable.from(broken()), 10),
    ).rejects.toThrow('broken');
    expect(await readdir(a.directory)).toEqual([]);
  });
  it('cleans up aborted HTTP uploads', async () => {
    const a = await setup();
    await new Promise<void>((resolve) => {
      const req = request(
        a.base + '/v1/cache/123',
        { method: 'PUT', headers: { ...a.headers, 'content-length': '80' } },
        () => {},
      );
      req.on('error', () => resolve());
      req.write('short');
      setTimeout(() => req.destroy(), 30);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(await a.disk.exists('123')).toBe(false);
    expect(await readdir(a.directory)).toEqual([]);
  });
  it('returns safe storage errors and readiness failure', async () => {
    const fail = async () => {
      throw new Error('SECRET filesystem path');
    };
    const a = await setup({ get: fail, put: fail, exists: fail, ready: fail });
    const result = await fetch(a.base + '/v1/cache/123', {
      headers: a.headers,
    });
    expect(result.status).toBe(500);
    expect(await result.text()).toBe('Internal server error');
    expect((await fetch(a.base + '/ready')).status).toBe(503);
  });
  it('serves health, readiness and authenticated metrics', async () => {
    const a = await setup();
    expect((await fetch(a.base + '/health')).status).toBe(200);
    expect((await fetch(a.base + '/ready')).status).toBe(200);
    expect((await fetch(a.base + '/metrics')).status).toBe(401);
    expect(
      (await fetch(a.base + '/metrics', { headers: a.headers })).status,
    ).toBe(200);
  });
  it('requires content length and binary content type', async () => {
    const a = await setup();
    const response = await fetch(a.base + '/v1/cache/123', {
      method: 'PUT',
      headers: { authorization: a.headers.authorization },
      body: 'x',
    });
    expect(response.status).toBe(415);
  });
  it('persists artifacts across adapters', async () => {
    const a = await setup();
    await a.disk.put('123', Readable.from(['abc']), 3);
    const second = new FilesystemStorage(a.directory, 100);
    await second.initialize();
    const result = await second.get('123');
    expect(result?.size).toBe(3);
    result?.stream.destroy();
  });
});
it('validates configuration securely', () => {
  expect(() => configuration({})).toThrow();
  expect(() =>
    configuration({
      CACHE_READ_TOKEN: 'x'.repeat(64),
      CACHE_WRITE_TOKEN: 'x'.repeat(64),
    }),
  ).toThrow();
  expect(() =>
    configuration({
      CACHE_READ_TOKEN: 'r'.repeat(64),
      CACHE_WRITE_TOKEN: 'w'.repeat(64),
      HOST: '0.0.0.0',
    }),
  ).toThrow('TLS');
});

it('enforces chunked upload length requirement', async () => {
  const a = await setup();
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      a.base + '/v1/cache/chunked',
      {
        method: 'PUT',
        headers: { ...a.headers, 'transfer-encoding': 'chunked' },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on('error', reject);
    req.write('x');
    req.end();
  });
  expect(status).toBe(411);
});
it('returns safe errors for upload storage failure', async () => {
  const a = await setup({
    ready: async () => {},
    exists: async () => false,
    get: async () => null,
    put: async () => {
      throw new Error('private path');
    },
  });
  const response = await fetch(a.base + '/v1/cache/failure', {
    method: 'PUT',
    headers: a.headers,
    body: 'x',
  });
  expect(response.status).toBe(500);
  expect(await response.text()).toBe('Internal server error');
});
it('protects file permissions and rejects artifact symlinks', async () => {
  const a = await setup();
  await a.disk.put('original', Readable.from(['abc']), 3);
  expect((await stat(join(a.directory, 'original'))).mode & 0o777).toBe(0o600);
  await symlink(join(a.directory, 'original'), join(a.directory, 'symlink'));
  await expect(a.disk.get('symlink')).rejects.toThrow();
});

it('limits concurrent uploads without racing admission', async () => {
  let release!: () => void;
  let admitted!: () => void;
  const entered = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = await setup({
    ready: async () => {},
    get: async () => null,
    exists: async () => false,
    put: async (_hash, body) => {
      for await (const chunk of body) {
        void chunk;
      }
      admitted();
      await gate;
    },
  });
  a.config.maxUploads = 1;
  const first = fetch(a.base + '/v1/cache/first', {
    method: 'PUT',
    headers: a.headers,
    body: 'x',
  });
  await entered;
  try {
    const second = await fetch(a.base + '/v1/cache/second', {
      method: 'PUT',
      headers: a.headers,
      body: 'y',
    });
    expect(second.status).toBe(503);
  } finally {
    release();
  }
  expect((await first).status).toBe(200);
});
