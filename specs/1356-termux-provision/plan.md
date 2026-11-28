# Implementation plan — Termux first activation

Base PR #1354 at 694c689dd08dbbf71d2a69daef81d20ccded4148; verify against current main. One Node script, only built-in packages and psql. Import playSupportStageConnection for the writer URL and required CA; use Stage session pooler port 5432 for PostgreSQL administration over IPv4 and transaction pooler 6543 for writer proof. libpq verify-full with the operator-supplied dashboard CA. Use separate SCRAM verifier in admin SQL stdin. Use fixed psql executable/args, sanitized outputs, no password in argv. Use HTTPS Netlify API with an existing operator token explicitly provided via hidden prompt, no token persistence. Owner may save nonsecret CA in Downloads.

## Order

1. Verify exact approved current PR #1354 head and same-repo branch via public GitHub GET. Read Netlify site metadata to confirm the pinned site and get owning account. Require missing exact key in account and site, and reject any inaccessible/ambiguous metadata. Verify PostgreSQL session user/current user, physical identifier and the existing role attributes and scoped grants.
2. Generate one random password and standard SCRAM-SHA-256 verifier locally using Node crypto. Use only documented Netlify createEnvVars with site_id, is_secret true, scopes [functions], one branch context with the exact branch parameter. Verify the returned and independently read metadata before LOGIN. Run as a single operator with exclusive ownership of this operation. Concurrent copies must be prevented by a PostgreSQL advisory lock for the duration of this bounded operation or equivalent fail-closed serialization; no DB data locks or external calls under gameplay locks.
3. Set LOGIN and PASSWORD together with a guarded transaction. Recheck NOLOGIN in the same serialized operation. On success prove the exact login and allowed/denied privileges with read-only queries from Termux. Netlify runtime proof requires a separate approved deployment.
4. Stop on partial failure without automatically overwriting or revoking anything. If a secret exists with NOLOGIN, operator must verify it was created by this attempt and both targets are pinned before deleting the single orphan value, then retry with a fresh password. If LOGIN is already present, diagnose before any changes; no automated reset. After connection proof failure preserve existing state and report the last confirmed step.

## Constitution check

No new workflow/infra/dependencies and no secret persistence or business mutations. Refuse ambiguity; independent exact-diff Claude review, fundamental regression tests only, and OWNER executes only on explicit GO.
