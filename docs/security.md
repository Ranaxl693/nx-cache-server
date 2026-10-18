# Security considerations

This is a personal POC, not HIPAA compliance, an enterprise security approval or a claim of production readiness. Remote deployment requires approved HTTPS infrastructure and organizational review. `TRUST_TLS_PROXY` is a configuration assertion, not encryption or proxy validation.

## Trust boundaries and remaining risks

- **Cache poisoning:** a write token can publish malicious bytes under a known task hash before a trusted producer. Immutability prevents later replacement but cannot establish provenance. Keep writers restricted to trusted machines/branches; never provide credentials to fork PR code or arbitrary scripts. Nx trusts restored outputs. No signing, provenance verification or identity/branch authorization is implemented.
- **Artifact trust:** the server only validates framing and byte counts. A full-length corrupt or malicious archive can be stored; it does not validate archive structure or verify an artifact checksum because the task hash is not a content digest. Clients must handle archive failures. This is different from incomplete uploads, which never publish. Planned enterprise controls should include independently verifiable signatures/provenance and consumer policy.
- **Secrets and PHI:** outputs and terminal logs can contain credentials, source code, personal information or PHI. Read token holders can download all entries in this cache namespace. There is no per-project, tenant or patient authorization, encryption implementation, classification engine or PHI detection. Do not build against live PHI or include secrets in cacheable outputs. Review workspace inputs/outputs/logs. Provision encrypted disks/storage and enforce retention and access auditing externally.
- **Supply chain:** no production npm dependencies; build/test dependencies and base images still carry risk. Lockfile is included. Run `npm ci`, full `npm audit`, production audit and approved image/source scanners; pin a reviewed image digest for release and rebuild for security patches. Installing Nx for the integration test executes upstream package lifecycle scripts. Run only on trusted infrastructure with restricted credentials.
- **Resource exhaustion:** per-artifact and in-flight upload limits, finite timeouts, 128 connections and streaming reduce memory pressure. There is no global disk quota, eviction, per-principal rate limit, tenant isolation or maximum cache cardinality. Valid writers can fill the disk. Enforce volume quota/alerts and rate/bandwidth limits at the approved proxy; consider dedicated upload workers and separate metrics identity before enterprise rollout.
- **Local filesystem:** use a dedicated server-owned directory and local filesystem. No untrusted process may write to it or replace its parent path. 0700/0600 apply on creation; existing paths are not automatically repermissioned. O_NOFOLLOW protects final artifact symlinks, not an attacker controlling the directory itself. Do not assume NFS/SMB semantics. POSIX storage is the supported POC target.
- **Transport and operations:** tokens are bearer credentials. TLS is mandatory off-host; protect proxy-to-service traffic too. The service does not trust X-Forwarded-* for auth and has no CORS or browser UI. Authentication failures do not include credential data. Node parser errors and infrastructure logs must also avoid header/body capture.

## Credentials and rotation

Generate two independent `openssl rand -hex 32` values. Provision through an approved secret manager for remote use. Local `.env` is ignored; restrict it to owner read/write permissions. Do not pass tokens in URLs or commit them. Stop granting write access to untrusted contexts.

Current POC accepts one read token and one write token. Rotation: generate new independent tokens; schedule a coordinated short interruption; stop cache clients; update server secret values; restart server; update client secret values; resume clients; verify old tokens return 401 and new roles behave correctly. Storage survives rotation. There is no overlap/multiple-token grace period; stale clients fail until updated. On compromise revoke immediately, isolate service, assess artifacts, and invalidate/delete the cache offline under an approved incident process.

Future branch policy should sit before `Storage.put`: an authorization provider verifies workload identity/issuer/audience and protected-branch claims from a trusted CI identity system. Never trust user-supplied branch headers. Use separate cache namespaces for repositories/trust domains. Shared POC tokens provide no per-writer audit identity.

## Operational checklist

Before remote use: security review and threat model, approved TLS/private routing, secrets lifecycle, restricted CI writers, provenance strategy, data classification, encrypted storage, volume quota, retention/backup, audit logging, image scan and vulnerability triage, service monitoring and restore exercise. None of these is satisfied merely by using Docker or the startup bind guard.

No automatic retention or eviction is implemented. For POC cleanup stop the server and intentionally remove only the dedicated cache directory. Avoid deleting files concurrently with active operations. Restart creates an empty cache. Define reviewed retention/backup rules before organizational usage.
