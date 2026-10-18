import { resolve } from 'node:path';
export interface Config {
  host: string;
  port: number;
  directory: string;
  readToken: string;
  writeToken: string;
  maxBytes: number;
  maxUploads: number;
}
export function configuration(env: NodeJS.ProcessEnv = process.env): Config {
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const readToken = env.CACHE_READ_TOKEN ?? '';
  const writeToken = env.CACHE_WRITE_TOKEN ?? '';
  if (
    !/^[A-Za-z0-9_-]{32,256}$/.test(readToken) ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(writeToken) ||
    readToken === writeToken
  )
    throw new Error('Configure distinct 32–256 character random tokens');
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host) && env.TRUST_TLS_PROXY !== 'true')
    throw new Error('Non-loopback binding requires approved TLS proxy');
  return {
    host,
    port: integer('PORT', 8080, 1, 65535),
    directory: resolve(env.CACHE_DIR ?? 'data'),
    readToken,
    writeToken,
    maxBytes: integer(
      'MAX_ARTIFACT_BYTES',
      536870912,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    maxUploads: integer('MAX_UPLOADS', 4, 1, 128),
  };
}
