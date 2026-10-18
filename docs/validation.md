# Executed validation

Date: 2026-10-18. Linux, Node v24.19.0. Nx client exactly 23.3.0; server zero production npm dependencies.

## Acceptance results

| Test                                            | Observed result                                                | Whole-command wall time |
| ----------------------------------------------- | -------------------------------------------------------------- | ----------------------- |
| A: empty local and remote                       | Task executed, server miss, artifact persisted                 | 309 ms                  |
| B: local cache and output explicitly removed    | Nx reported remote cache; output restored; no execution marker | 230 ms                  |
| B: separate fresh workspace                     | Same output restored, no task execution marker, 1/1 remote hit | 222 ms                  |
| C: source input changed                         | Task executed again and remote entry count increased           | 316 ms                  |
| D: authentication                               | Missing token 401; read token upload 403                       | Not benchmarked         |
| E: server stopped/recreated with same directory | Previously stored artifact returned 200                        | Not benchmarked         |

Nx reported internal task-run durations of 59 ms for A, 3 ms for both remote-hit runs and 66 ms for C. Whole-command timings include client startup/graph overhead. This tiny deterministic task is a compatibility check, not a representative Angular performance benchmark. See `acceptance-results.json` for raw Nx output, timings and correlated server events.

`test:nx` verifies output bytes and absence of an uncached execution marker. Cached console text is replayed by Nx and can include TASK_EXECUTED even on a hit; the test does not mistake this replay for actual execution.

## Quality gates

ESLint, strict TypeScript checking, Vitest unit/HTTP integration tests and production build passed. Tests cover success/miss/auth/role separation/immutability/concurrent uploads/key validation/traversal/oversize/incomplete or failed streams/HTTP abort/storage read and write errors/health/readiness/metrics/length/type/file permissions/symlinks/upload admission.

Full dependency audit after updating Vitest: zero reported vulnerabilities. The machine-readable report is `dependency-audit.json`. This is a point-in-time registry result, not a guarantee that dependencies are vulnerability-free. Production runtime uses only Node built-ins.

## Limits of executed verification

- Docker is unavailable in this environment: Dockerfile and Compose provided but image build, container health, volume behavior and image vulnerability scanning were not executed.
- Execution used Node 24.19.0. Node 22 support is configured, but a Node 22 matrix was not executed here.
- The real Nx test uses a minimal native Nx workspace and built-in run-commands executor, not the user's Angular monorepo. Existing Angular code/CI has not been modified or benchmarked.
- Server restart test stops/recreates the HTTP server/storage adapter within the test process. It verifies persisted files, not a host crash/power-loss recovery scenario or a deployed-container restart.
- No TLS deployment, enterprise identity, Azure Blob adapter, artifact signing or healthcare compliance review was performed.
