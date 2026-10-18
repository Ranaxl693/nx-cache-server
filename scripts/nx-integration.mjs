// Actual Nx client test: isolated workspaces, no plugins and no Nx Cloud.
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  appendFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { FilesystemStorage } from '../dist/storage.js';
import { createCacheServer } from '../dist/server.js';
const root = await mkdtemp(join(tmpdir(), 'nx-cache-acceptance-'));
const dependency = resolve('.nx-fixture/client');
await mkdir(dependency, { recursive: true });
function run(command, args, cwd, env = {}) {
  return new Promise((accept, reject) => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? accept({
            durationMs: Math.round(performance.now() - started),
            output,
          })
        : reject(new Error(`${command} exited ${code}\n${output}`)),
    );
  });
}
const records = [];
const directory = join(root, 'artifacts');
const readToken = randomBytes(32).toString('hex'),
  writeToken = randomBytes(32).toString('hex');
const config = {
  directory,
  readToken,
  writeToken,
  host: '127.0.0.1',
  port: 0,
  maxBytes: 1024 * 1024,
  maxUploads: 4,
};
async function start() {
  const storage = new FilesystemStorage(directory, config.maxBytes);
  await storage.initialize();
  const app = createCacheServer(config, storage, (r) => records.push(r));
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return app;
}
let app;
try {
  await writeFile(
    join(dependency, 'package.json'),
    JSON.stringify({ private: true, devDependencies: { nx: '23.3.0' } }),
  );
  await run('npm', ['install', '--no-audit', '--no-fund'], dependency);
  const nx = join(dependency, 'node_modules/nx/dist/bin/nx.js');
  assert.equal(
    JSON.parse(
      await readFile(join(dependency, 'node_modules/nx/package.json'), 'utf8'),
    ).version,
    '23.3.0',
  );
  // Verify the version-pinned JS bridge selects the native HTTP cache.
  const bridge = await readFile(
    join(dependency, 'node_modules/nx/dist/src/tasks-runner/cache.js'),
    'utf8',
  );
  await writeFile(
    resolve('docs/nx-client-evidence.txt'),
    bridge
      .split('\n')
      .filter(
        (line, i, all) =>
          /SELF_HOSTED|HttpRemoteCache|httpRemoteCache|HTTP.*CACHE/.test(
            line,
          ) ||
          all.slice(Math.max(0, i - 2), i).some((l) => /SELF_HOSTED/.test(l)),
      )
      .join('\n') + '\n',
  );
  async function workspace(name) {
    const path = join(root, name);
    await mkdir(path);
    await symlink(
      join(dependency, 'node_modules'),
      join(path, 'node_modules'),
      'junction',
    );
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({ name: 'cache-fixture', private: true }),
    );
    await writeFile(
      join(path, 'nx.json'),
      JSON.stringify({
        namedInputs: {
          default: ['{projectRoot}/input.txt', '{projectRoot}/task.mjs'],
        },
        targetDefaults: {
          build: {
            cache: true,
            inputs: ['default'],
            outputs: ['{projectRoot}/out'],
          },
        },
      }),
    );
    await writeFile(
      join(path, 'project.json'),
      JSON.stringify({
        name: 'fixture',
        root: '.',
        targets: {
          build: {
            executor: 'nx:run-commands',
            options: { command: 'node task.mjs' },
          },
        },
      }),
    );
    await writeFile(join(path, 'input.txt'), 'version-one\n');
    await writeFile(
      join(path, 'task.mjs'),
      `import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';mkdirSync('out',{recursive:true});writeFileSync('out/result.txt',readFileSync('input.txt'));appendFileSync('executions.log','EXECUTED\\n');console.log('TASK_EXECUTED');`,
    );
    return path;
  }
  const first = await workspace('first'),
    fresh = await workspace('fresh');
  app = await start();
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const env = () => ({
    NX_SELF_HOSTED_REMOTE_CACHE_SERVER: base,
    NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN: writeToken,
    NX_DAEMON: 'false',
    NX_ISOLATE_PLUGINS: 'false',
    NX_TUI: 'false',
    NX_NO_CLOUD: 'true',
    NX_INTERACTIVE: 'false',
  });
  const report = { nxVersion: '23.3.0', node: process.version, results: {} };
  const a = await run(
    process.execPath,
    [nx, 'run', 'fixture:build', '--output-style=static'],
    first,
    env(),
  );
  assert.equal(
    (await readFile(join(first, 'executions.log'), 'utf8')).trim(),
    'EXECUTED',
  );
  assert(records.some((r) => r.event === 'cache_miss'));
  assert(records.some((r) => r.status === 200));
  assert((await readdir(directory)).length > 0);
  report.results.A = a;
  await rm(join(first, '.nx/cache'), { recursive: true, force: true });
  await rm(join(first, 'out'), { recursive: true, force: true });
  await rm(join(first, 'executions.log'));
  const cleared = await run(
    process.execPath,
    [nx, 'run', 'fixture:build', '--output-style=static'],
    first,
    env(),
  );
  assert.equal(
    await readFile(join(first, 'executions.log'), 'utf8').catch(() => null),
    null,
  );
  assert.equal(
    await readFile(join(first, 'out/result.txt'), 'utf8'),
    'version-one\n',
  );
  report.results.BClearedLocal = cleared;
  const b = await run(
    process.execPath,
    [nx, 'run', 'fixture:build', '--output-style=static'],
    fresh,
    env(),
  );
  assert.equal(
    await readFile(join(fresh, 'out/result.txt'), 'utf8'),
    'version-one\n',
  );
  assert.equal(
    await readFile(join(fresh, 'executions.log'), 'utf8').catch(() => null),
    null,
  );
  assert(records.some((r) => r.event === 'cache_hit'));
  report.results.B = b;
  await appendFile(join(fresh, 'input.txt'), 'changed\n');
  const before = (await readdir(directory)).length;
  report.results.C = await run(
    process.execPath,
    [nx, 'run', 'fixture:build', '--output-style=static'],
    fresh,
    env(),
  );
  assert.equal(
    (await readFile(join(fresh, 'executions.log'), 'utf8')).trim(),
    'EXECUTED',
  );
  assert((await readdir(directory)).length > before);
  const key = (await readdir(directory)).find((n) => !n.startsWith('.'));
  assert(key);
  assert.equal((await fetch(`${base}/v1/cache/${key}`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/v1/cache/no-write`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${readToken}`,
          'content-type': 'application/octet-stream',
        },
        body: 'x',
      })
    ).status,
    403,
  );
  report.results.D = { unauthenticated: 401, readOnlyWrite: 403 };
  await app.shutdown();
  app = await start();
  base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(
    (
      await fetch(`${base}/v1/cache/${key}`, {
        headers: { authorization: `Bearer ${readToken}` },
      })
    ).status,
    200,
  );
  report.results.E = { persistedAfterRestart: true };
  report.events = records;
  await writeFile(
    resolve('docs/acceptance-results.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (app) await app.shutdown();
  await rm(root, { recursive: true, force: true });
}
