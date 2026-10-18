# Official protocol and Nx 23.3.0 integration

Primary specification: https://nx.dev/docs/kb/self-hosted-caching (retrieved 2026-10-18).
Version check: `nx@23.3.0` from npm, `dist/src/tasks-runner/cache.js`, `getHttpCache()` constructs native `HttpRemoteCache` when `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` is set, except for the WASM build. Native implementation runs HTTP through Rust/reqwest. The included real-client test is the compatibility authority; curl alone cannot prove archive restoration.

## HTTP contract

| Request                                          | Result                                                    |
| ------------------------------------------------ | --------------------------------------------------------- |
| GET /v1/cache/{hash}, valid read or write bearer | 200 binary archive with exact Content-Length, or 404 miss |
| PUT /v1/cache/{hash}, write bearer               | 200 after complete atomic publication                     |
| PUT existing hash                                | 409, immutable; bytes are unchanged                       |
| Missing/invalid bearer                           | 401 with WWW-Authenticate: Bearer                         |
| PUT with read-only bearer                        | 403                                                       |

PUT requires `Content-Length` and `Content-Type: application/octet-stream`. The server streams the archive bytes exactly as supplied by Nx and returns them unchanged. It does not repackage them or attempt to implement Nx's archive internals. The official documentation describes tar archives and warns that their internal format can change. Opaque storage avoids assuming an internal layout.

The spec declares GET 200/403/404, but omits GET 401 despite bearer security; this implementation uses conventional 401 for invalid/missing credentials on both methods, as explicitly required by the POC. Additional hardening responses: 400 invalid route/key or incomplete body, 405 unsupported method, 411 absent length, 413 size limit, 415 wrong content type, 503 upload saturation/not ready, 500 safe unexpected storage error. Node's parser can itself reject malformed HTTP framing or close an aborted connection. URL query strings, escaped separators and encoded traversal are rejected. Hash policy is 1–128 ASCII letters/digits/underscore/hyphen, a deliberate stricter subset of the spec's unconstrained string. Actual Nx decimal task hashes are supported.

## Angular 22 / Nx 23.3.0 workspace

Keep `host`, `mfe1`, `mfe2`, `lib-core`, `lib-ui`, their project graph, dependencies, inputs/outputs and existing targets unchanged. Confirm Nx is actually 23.3.0 with `npx nx report`. Use a native supported platform installation, not WASM fallback. Do not install Nx into the cache server's production dependencies.

No `nx.json` remote-cache runner, Nx Cloud registration, access token for Nx Cloud, or community plugin is required. The two official client variables are:

```sh
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER=http://127.0.0.1:8080
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$CACHE_WRITE_TOKEN"
```

Use the server origin with no `/v1/cache` suffix. Set `CACHE_WRITE_TOKEN` locally from your secret store; the cache server and client can run in separate terminals/processes. These names have different roles: `CACHE_*` configures this server; `NX_SELF_HOSTED_*` configures Nx. Never commit either credential. The POC uses HTTP only over loopback. For a remote approved server use an HTTPS origin and a certificate trusted by the native Nx HTTP client. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`; `NODE_EXTRA_CA_CERTS` cannot be assumed to configure Rust/reqwest. Validate organization CA installation with the actual native client on its platform.

Continue the existing validation order:

```sh
npx nx affected -t lint --base=origin/main --head=HEAD
npx nx affected -t typecheck --base=origin/main --head=HEAD
npx nx affected -t test --base=origin/main --head=HEAD
npx nx affected -t build --base=origin/main --head=HEAD
```

Use your actual base branch and target name (`test` for Vitest here). Run sequentially and stop on failure. These are local POC commands, not proposed pipeline edits. Nx Affected still selects projects using Git/project-graph changes. Cacheable targets retain local caching and use remote lookup after local miss. Ensure existing targets declare correct `cache: true`, inputs and outputs; a cache server cannot repair unsound task hashing. Do not overwrite existing `targetDefaults` wholesale. Include relevant environment inputs in the workspace's task configuration as necessary, without including auth tokens in hashes.

To disable HTTP caching, unset BOTH client variables and run existing commands. Do not use `--skip-nx-cache` to test remote hits because it bypasses caching. For read-only clients, set access token to the read token; cache misses execute locally but attempted uploads are forbidden (Nx may report a write failure). Branch protection is achieved by withholding write credentials from untrusted jobs, not a request header or branch name.

## Manual acceptance reproduction

Use `npm run build && npm run test:nx` in the standalone server repo for the deterministic A–E suite. Its `executions.log` is intentionally outside declared outputs/inputs. Nx can replay terminal output on a hit, so seeing TASK_EXECUTED in console is **not** proof of execution. The test asserts the execution marker is absent in the fresh consumer and restored output matches.

For your monorepo: isolate a local POC cache directory, run a cacheable build, remove only that workspace's local cache/output, rerun with identical sources/environment. Nx 23.3.0 local cache is normally `.nx/cache`; check `cacheDirectory` overrides. Prefer a clean second checkout to avoid destroying useful local data. Record server miss/upload/hit events and restored outputs. Modify one relevant source, rerun, and confirm a new hash/artifact. Restart the server with the same persistent directory and retrieve again. The packaged fixture exercises these cases without changing your monorepo or CI.
