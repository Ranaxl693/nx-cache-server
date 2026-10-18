# Architecture

The Node built-in HTTP server authenticates requests, validates keys and upload metadata, applies admission limits, then delegates to `Storage`. The filesystem adapter streams binary bytes unchanged. It never extracts or executes archives. The task hash is an opaque task identity, not a checksum of the uploaded bytes.

| Module     | Responsibility                                                  |
| ---------- | --------------------------------------------------------------- |
| config.ts  | Environment validation, loopback default, credential separation |
| server.ts  | HTTP contract, authorization, metrics, safe logs, lifecycle     |
| storage.ts | Storage interface and filesystem implementation                 |
| main.ts    | Composition root and signal handling                            |

`Storage.get(hash)` returns `{size, stream}` or null. `put(hash, readable, size)` streams into an exclusive temporary file, counts bytes, flushes and closes it, then atomically links it into the final name. Hard-link publication fails if another writer already published that hash; first completed writer wins and others get 409. Finally temporary files are unlinked. Readers only see complete published files. The directory is fsynced after publication; storage faults after publication can yield a 500 with an entry already present. Retrying then gets 409.

`exists` is an optimization only; no-overwrite correctness comes from atomic link publication. Files use 0600, new directory 0700, process umask 0077. Existing directory permissions/ownership must be provisioned correctly. Downloads open with O_NOFOLLOW and validate regular files. Cache-key validation is repeated inside storage, not only in HTTP routing.

Only one server process should own a directory. Concurrent HTTP uploads within it are supported. Process crashes can leave `.upload-*` files; startup deletes only these files older than 24 hours. Recent orphan files remain until a later startup. Streaming failures immediately attempt cleanup. Cleanup failures may leave temporary files; monitor disk space and ownership. No network filesystem atomicity assumptions are made.

For Azure Blob, implement the same interface: download stream + size, conditional create with `If-None-Match: *`, map already-exists to 409, existence to properties, readiness to the approved storage probe. Use managed identity and private endpoints. Implement upload cleanup, size enforcement and streaming in that adapter. Route code stays unchanged. Azure support is a design extension, not implemented or tested here.

Metrics contain requests, cache lookup hits/misses, successful uploads, errors, total completed-response duration in milliseconds and active uploads. These are process-local counters reset on restart. Hit count means lookup hit, not guaranteed complete download; aborted transfers may count as hits. `/metrics` requires either cache token. Health endpoints expose fixed strings only. Readiness checks access permissions, not free space, write durability or full storage health.

Each completed request has a random request ID and duration. Cache events use that ID, without paths, hashes, bodies, tokens or headers. Error logs include safe status only; operational diagnosis can therefore require separate approved host/storage telemetry. Logs are JSON lines to stdout and need infrastructure retention/rotation. Server shutdown stops admission/listening, closes idle connections and drains active connections for at most ten seconds before forcing socket closure.
