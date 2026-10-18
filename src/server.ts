import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Config } from './config.js';
import { CacheError, validateHash, type Storage } from './storage.js';
export type Logger = (record: Record<string, unknown>) => void;
const digest = (value: string) => createHash('sha256').update(value).digest();
export function createCacheServer(
  config: Config,
  storage: Storage,
  log: Logger = (r) => console.log(JSON.stringify(r)),
) {
  const read = digest(config.readToken),
    write = digest(config.writeToken);
  const metrics = {
    requests: 0,
    hits: 0,
    misses: 0,
    uploads: 0,
    errors: 0,
    totalDurationMs: 0,
  };
  let activeUploads = 0;
  let stopping = false;
  const respond = (res: ServerResponse, status: number, body = '') => {
    res.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const start = performance.now(),
      id = randomUUID();
    metrics.requests++;
    res.on('finish', () => {
      const durationMs = performance.now() - start;
      metrics.totalDurationMs += durationMs;
      log({
        event: 'request',
        id,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      });
    });
    try {
      if (req.method === 'GET' && req.url === '/health') {
        respond(res, 200, 'ok');
        return;
      }
      if (req.method === 'GET' && req.url === '/ready') {
        if (stopping) throw new CacheError(503, 'Not ready');
        try {
          await storage.ready();
        } catch {
          throw new CacheError(503, 'Not ready');
        }
        respond(res, 200, 'ready');
        return;
      }
      const authorization = req.headers.authorization ?? '';
      const token =
        /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(authorization)?.[1] ?? '';
      const candidate = digest(token);
      const canRead = timingSafeEqual(candidate, read);
      const canWrite = timingSafeEqual(candidate, write);
      if (!canRead && !canWrite) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        throw new CacheError(401, 'Unauthorized');
      }
      if (req.method === 'GET' && req.url === '/metrics') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ...metrics, activeUploads }));
        return;
      }
      const match = /^\/v1\/cache\/([^/?]+)$/.exec(req.url ?? '');
      if (!match) throw new CacheError(400, 'Invalid cache route');
      const hash = match[1]!;
      validateHash(hash);
      if (req.method === 'GET') {
        const artifact = await storage.get(hash);
        if (!artifact) {
          metrics.misses++;
          log({ event: 'cache_miss', id });
          respond(res, 404);
          return;
        }
        metrics.hits++;
        log({ event: 'cache_hit', id });
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': artifact.size,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        await pipeline(artifact.stream, res);
        return;
      }
      if (req.method !== 'PUT') {
        res.setHeader('Allow', 'GET, PUT');
        throw new CacheError(405, 'Method not allowed');
      }
      if (!canWrite) throw new CacheError(403, 'Read-only credential');
      const length = req.headers['content-length'];
      if (!length || !/^\d+$/.test(length))
        throw new CacheError(411, 'Content-Length required');
      const size = Number(length);
      if (!Number.isSafeInteger(size) || size > config.maxBytes)
        throw new CacheError(413, 'Artifact too large');
      if (
        req.headers['content-type']?.split(';')[0] !==
        'application/octet-stream'
      )
        throw new CacheError(415, 'Expected application/octet-stream');
      if (activeUploads >= config.maxUploads)
        throw new CacheError(503, 'Upload capacity reached');
      activeUploads++;
      try {
        if (await storage.exists(hash))
          throw new CacheError(409, 'Cache entry already exists');
        await storage.put(hash, req, size);
        metrics.uploads++;
      } finally {
        activeUploads--;
      }
      respond(res, 200);
    } catch (error) {
      metrics.errors++;
      const status = error instanceof CacheError ? error.status : 500;
      log({ event: 'request_error', id, status });
      if (!res.headersSent && !res.destroyed) {
        res.setHeader('Connection', 'close');
        respond(
          res,
          status,
          error instanceof CacheError ? error.message : 'Internal server error',
        );
      } else res.destroy();
    }
  };
  const server = createServer(
    {
      maxHeaderSize: 8192,
      requestTimeout: 120000,
      headersTimeout: 15000,
      keepAliveTimeout: 5000,
    },
    (req, res) => {
      void handle(req, res);
    },
  );
  server.maxConnections = 128;
  return {
    server,
    metrics,
    shutdown: async () => {
      stopping = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
        const timeout = setTimeout(() => server.closeAllConnections(), 10000);
        timeout.unref();
      });
    },
  };
}
