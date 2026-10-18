# Troubleshooting

| Symptom                                                             | Check                                                                                                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup rejects tokens                                              | Two different random 32–256 ASCII letters/digits/_/- values are required; .env must be loaded                                                |
| Non-loopback bind rejected                                          | Keep 127.0.0.1 locally; approved TLS proxy topology is required remotely                                                                     |
| 401                                                                 | Exact Bearer token; server CACHE_* versus client NX_SELF_HOSTED_* variable names; secret rotation                                            |
| 403 on PUT                                                          | Client uses read-only token; use write credential only on trusted producers                                                                  |
| 409                                                                 | Entry already immutable; expected concurrent/duplicate write behavior                                                                        |
| 411 / 415                                                           | PUT must include Content-Length and application/octet-stream                                                                                 |
| 413                                                                 | Artifact exceeds MAX_ARTIFACT_BYTES or declared length                                                                                       |
| 503                                                                 | Upload admission full or readiness failed; check storage permissions and load                                                                |
| 500                                                                 | Check filesystem ownership, quota, space and host telemetry; details intentionally excluded from HTTP/log responses                          |
| No HTTP requests from Nx                                            | Correct version/native binary, cacheable target, no skip-cache flags, local cache hit, unset/misnamed URL, Cloud/legacy runner configuration |
| No task executes on remote hit but console includes old task output | Nx replays cached terminal output; inspect execution markers and output files                                                                |
| TLS failures                                                        | Trust the approved CA in the native HTTP client's platform trust configuration; do not disable certificate validation                        |
| Native Nx unavailable                                               | Install platform optional dependencies; WASM does not support this HTTP cache path                                                           |
| Nx plugin socket restricted in test sandbox                         | Fixture sets NX_ISOLATE_PLUGINS=false and NX_DAEMON=false; this does not change caching semantics                                            |
| Persistent upload temporary files                                   | Immediate cleanup is best-effort; stale files older than 24h are cleaned on restart; inspect disk/ownership                                  |
| Docker volume permission error                                      | Use named volume or provision bind mount for node UID 1000 with mode 0700; don't chmod 777                                                   |

The fixture's cold command includes process startup, graph generation and task scheduling. Its tiny task is not a benchmark of enterprise build acceleration. Remote hits can be slower for tiny tasks. Compare representative builds on approved infrastructure.
