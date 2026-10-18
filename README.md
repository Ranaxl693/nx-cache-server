# nx-self-hosted-cache-server

Standalone Node.js/TypeScript filesystem HTTP cache for Nx 23.3.0. Zero runtime npm dependencies; no Angular, Nx, database, cloud service or cache plugin in the server. Nx is installed only in the isolated compatibility-test fixture.

## Quick start

Use Node 22.14+ (22 LTS or newer supported LTS), npm and a local POSIX filesystem supporting hard links, `O_NOFOLLOW`, file/directory fsync. Validation on this delivery used Node 24; see `docs/validation.md` for actual results.

```sh
npm ci
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
# Set CACHE_READ_TOKEN and CACHE_WRITE_TOKEN in .env using these different secrets.
npm run build
npm start
```

Default listener: `http://127.0.0.1:8080`. Health: `/health`; storage readiness: `/ready`; authenticated JSON metrics: `/metrics`. Never expose plain HTTP remotely. `.env` and cache data are ignored by Git. Example files contain no working credentials.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:nx
npm run format:check
npm audit
npm run audit
```

`test:nx` installs exactly Nx 23.3.0 into ignored `.nx-fixture/client`, creates independent temporary workspaces and storage, executes Nx, verifies restored output and absence of execution markers, tests invalidation/authentication/restart, and writes `docs/acceptance-results.json`. It requires registry access and the platform's native Nx binary. No browser E2E or pipeline changes are included.

## Docker POC

```sh
docker compose up --build -d
docker compose logs -f cache
docker compose restart cache
docker compose down
```

Compose loads credentials from your local `.env`, publishes only on host loopback and retains the named volume across restart/down. **Do not use `down -v` unless intentionally deleting all artifacts.** The container binds all interfaces inside its network namespace; never attach untrusted containers to that network. `TRUST_TLS_PROXY=true` in this local-only Compose acknowledges this bind exception; it does not enable TLS. For remote use replace this topology with approved TLS termination, firewall/private network and reviewed infrastructure. Docker is not proof of security approval.

## Configuration

| Variable           | Default   | Meaning                                                                                         |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------- |
| HOST               | 127.0.0.1 | Listener address                                                                                |
| PORT               | 8080      | Integer 1–65535                                                                                 |
| CACHE_DIR          | ./data    | Persistent directory; server-owned, not shared with untrusted processes                         |
| CACHE_READ_TOKEN   | required  | Read-only random token                                                                          |
| CACHE_WRITE_TOKEN  | required  | Separate read/write random token                                                                |
| MAX_ARTIFACT_BYTES | 536870912 | Maximum stored/uploaded bytes per entry                                                         |
| MAX_UPLOADS        | 4         | In-flight upload admission limit                                                                |
| TRUST_TLS_PROXY    | false     | Explicit non-loopback bind acknowledgement; requires reviewed TLS infrastructure for remote use |

Tokens accept 32–256 characters from letters, digits, `_`, `-`; generate with 32 random bytes, not memorable strings. Numeric settings fail closed if malformed. Request timeout is 120 seconds, header timeout 15 seconds, max headers 8 KiB, max connections 128 and shutdown drain 10 seconds. Reverse proxy limits must align with these settings.

## Documentation

- [Architecture](docs/architecture.md)
- [Protocol and Nx 23.3.0 integration](docs/nx-integration.md)
- [Security and operational limitations](docs/security.md)
- [Validation and acceptance evidence](docs/validation.md)
- [Troubleshooting](docs/troubleshooting.md)

## Repository

Source repository: https://github.com/Ranaxl693/nx-cache-server

This standalone application stays separate from the Angular monorepo. The package name remains `nx-self-hosted-cache-server`; the repository uses the user-provided name `nx-cache-server`. No GitHub Actions or existing CI/CD changes are included.
