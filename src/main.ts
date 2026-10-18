import { configuration } from './config.js';
import { FilesystemStorage } from './storage.js';
import { createCacheServer } from './server.js';
process.umask(0o077);
const config = configuration();
const storage = new FilesystemStorage(config.directory, config.maxBytes);
await storage.initialize();
const app = createCacheServer(config, storage);
app.server.listen(config.port, config.host, () =>
  console.log(JSON.stringify({ event: 'listening', port: config.port })),
);
app.server.on('error', () => {
  console.error(JSON.stringify({ event: 'server_error' }));
  process.exitCode = 1;
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void app.shutdown();
  });
