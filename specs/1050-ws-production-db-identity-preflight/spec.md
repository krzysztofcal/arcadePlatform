# Production WS Deploy Backend Identity Preflight (Issue #1050 Finding 3)

## User story US1 (P1)
As the Arcade Poker platform operator,
I want the Production WS deployment workflow to verify backend identity (Supabase project ref and PostgreSQL system identifier) against fixed canonical Production identity before switching the release symlink or restarting `ws-server.service`,
So that a misconfigured or mixed environment (e.g. Production URL with Stage DB URL, or Stage target) causes deployment to fail-closed immediately without switching traffic or mutating the wrong database.

## Requirements
1. **Dedicated Production Preflight Helper**:
   - Add `infra/vps/ws-production-env-preflight.mjs`.
   - Reads strictly the fixed Production env file `/etc/arcadeplatform/ws-server.env`.
   - CLI execution strictly checks real `/etc/arcadeplatform/ws-server.env` with root ownership without reading test bypasses from `process.env`.
   - Unit tests use explicit function arguments (`runPreflight({ envFile, allowTestUid, querySystemIdentifier })`), never process environment test seams in production code.
2. **Strict File Security Contract**:
   - Opens `/etc/arcadeplatform/ws-server.env` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`.
   - Rejects symlinks (`!metadata.isFile()`).
   - Requires ownership `root:root` (`uid === 0 && gid === 0`).
   - Requires permissions mode `0600` (`(mode & 0o7777) === 0o600`).
   - Verifies file descriptor metadata before reading file contents.
3. **Required Environment Variables**:
   - `SUPABASE_DB_URL` (non-empty string).
   - `SUPABASE_URL` (non-empty string).
   - `POKER_WS_INTERNAL_TOKEN` (non-empty string).
   - `WS_AUTHORITATIVE_JOIN_ENABLED=1`.
   - `PORT=3000` is defined by systemd `ws-server.service` and is not required in `ws-server.env`.
   - Must not define legacy `WS_BOT_REACTION_MIN_MS` or `WS_BOT_REACTION_MAX_MS`.
4. **Canonical Production Target Identity Binding**:
   - Canonical Production project ref: `otbqfijerkieoxwpxjnm`.
   - Canonical Production PostgreSQL system identifier: `7575202818581710058`.
   - Neither value may be derived or read from mutable input.
5. **URL & DB URL Target Verification**:
   - `SUPABASE_URL` must be a valid URL with `protocol === "https:"` and exact `hostname === "otbqfijerkieoxwpxjnm.supabase.co"`.
   - `SUPABASE_DB_URL` must target canonical production: `postgres.${CANONICAL_PROD_PROJECT_REF}` (pooler) or `.${CANONICAL_PROD_PROJECT_REF}.` / `//${CANONICAL_PROD_PROJECT_REF}.` (direct).
   - Any mixed configuration (e.g. Production URL + Stage DB `krydukthwdvccggbyjfw`, or Stage URL + Production DB) must fail-closed immediately.
6. **Read-Only Database Identity Check & Credential Safety**:
   - Connect using `SUPABASE_DB_URL` and query: `select system_identifier from pg_control_system()`.
   - Value must match exactly `7575202818581710058`.
   - Query execution parses database URL components and invokes `psql` without passing the password in command line arguments (argv).
   - The password is passed strictly via `PGPASSWORD` subprocess environment variable.
   - All errors and outputs are sanitized (`sanitizeOutput`) to redact passwords and URI credentials from logs.
   - Any query failure, connection error, timeout, or mismatched identifier must fail-closed.
7. **Deployment Workflow Integration**:
   - In `.github/workflows/ws-server-deploy.yml`, invoke `sudo -n /usr/local/sbin/arcade-ws-production-env-preflight` during the deployment step on the VPS before `/opt/ws-server/current` symlink switch and before `systemctl restart ws-server.service`.
   - If preflight fails, abort deployment immediately, do not switch symlink, do not restart service, and do not accept health gate.
8. **Infrastructure Configuration & Existing-Host Staging**:
   - Update `infra/vps/arcade-deploy.sudoers` to authorize `/usr/local/sbin/arcade-ws-production-env-preflight ""`.
   - Update `infra/vps/bootstrap.sh` to install `/usr/local/sbin/arcade-ws-production-env-preflight` for fresh VPS recovery.
   - Add `infra/vps/stage-production-env-preflight.sh` for owner-approved existing-host staging.
   - Script installs helper and sudoers, executes read-only verification (`sudo -u copilot sudo -n /usr/local/sbin/arcade-ws-production-env-preflight`), and makes NO restarts, NO env edits, NO DB mutations.
   - Document procedure in `docs/vps-disaster-recovery.md`, `docs/poker-deployment.md`, and `infra/vps/README.md`.
   - Keep PR #1053 in Draft until owner stages on the existing Production VPS.

## Acceptance Criteria
- Production env preflight script is installed and runnable as a standalone root-owned node script.
- Preflight rejects missing, non-regular, symlinked, wrong owner, or non-0600 env files.
- Preflight rejects missing required fields or invalid join settings.
- Preflight rejects Stage Supabase URL, Stage DB URL, or mixed configurations.
- Preflight passes DB password strictly via `PGPASSWORD` (never in `psql` argv) and sanitizes error outputs.
- Preflight executes read-only database query `select system_identifier from pg_control_system()` and requires `7575202818581710058`.
- Preflight rejects any database query error, timeout, or mismatched system identifier.
- CLI execution does not read `WS_PREFLIGHT_*` test env variables and fails closed when unprivileged.
- Deploy workflow runs preflight before current release switch and service restart.
- Staging script `stage-production-env-preflight.sh` provides non-destructive existing-host installation and read-only verification.
- Documentation in `docs/vps-disaster-recovery.md`, `docs/poker-deployment.md`, and `infra/vps/README.md` documents existing-host staging.
- All repo checks (`npm run check:all`, `npm run test:quick`, `npm run test:unit`) pass.

## Breaking Impact
- Brak wpływu na poprawnie skonfigurowane środowisko produkcyjne (canonical Production URL, canonical Production DB URL oraz właściwy PostgreSQL system identifier przechodzą pomyślnie).
- Intentional breaking/fail-closed behavior: Wszelkie próby wdrożenia Production WS ze złym projektem Supabase, z bazą Stage, ze sprzeczną konfiguracją URL vs DB, z niedostępną bazą danych lub z niezgodnym `system_identifier` zostaną zablokowane przed przełączeniem symlinka i przed restartem usługi.
