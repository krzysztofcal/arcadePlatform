# Production WS Deploy Backend Identity Preflight (Issue #1050 Finding 3)

## User story US1 (P1)
As the Arcade Poker platform operator,
I want the Production WS deployment workflow to verify backend identity (Supabase project ref and PostgreSQL system identifier) against fixed canonical Production identity before switching the release symlink or restarting `ws-server.service`,
So that a misconfigured or mixed environment (e.g. Production URL with Stage DB URL, or Stage target) causes deployment to fail-closed immediately without switching traffic or mutating the wrong database.

## Requirements
1. **Dedicated Production Preflight Helper**:
   - Add `infra/vps/ws-production-env-preflight.mjs`.
   - Reads strictly the fixed Production env file `/etc/arcadeplatform/ws-server.env` (overrideable only for unit tests via internal test env `WS_PREFLIGHT_TEST_ENV_FILE`, never from the env being verified or CLI arguments).
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
   - `PORT=3000`.
   - `WS_AUTHORITATIVE_JOIN_ENABLED=1`.
   - Must not define legacy `WS_BOT_REACTION_MIN_MS` or `WS_BOT_REACTION_MAX_MS`.
4. **Canonical Production Target Identity Binding**:
   - Canonical Production project ref: `otbqfijerkieoxwpxjnm`.
   - Canonical Production PostgreSQL system identifier: `7575202818581710058`.
   - Neither value may be derived or read from mutable input.
5. **URL & DB URL Target Verification**:
   - `SUPABASE_URL` must target canonical production: `://${CANONICAL_PROD_PROJECT_REF}.supabase.co`.
   - `SUPABASE_DB_URL` must target canonical production: `postgres.${CANONICAL_PROD_PROJECT_REF}` (pooler) or `.${CANONICAL_PROD_PROJECT_REF}.` / `//${CANONICAL_PROD_PROJECT_REF}.` (direct).
   - Any mixed configuration (e.g. Production URL + Stage DB `krydukthwdvccggbyjfw`, or Stage URL + Production DB) must fail-closed immediately.
6. **Read-Only Database Identity Check**:
   - Connect using `SUPABASE_DB_URL` and query: `select system_identifier from pg_control_system()`.
   - Value must match exactly `7575202818581710058`.
   - Query execution uses system `psql` (or test runner seam `WS_PREFLIGHT_MOCK_SYSTEM_IDENTIFIER` for deterministic unit testing).
   - Any query failure, connection error, timeout, or mismatched identifier must fail-closed.
7. **Deployment Workflow Integration**:
   - In `.github/workflows/ws-server-deploy.yml`, invoke `sudo -n /usr/local/sbin/arcade-ws-production-env-preflight` during the deployment step on the VPS before `/opt/ws-server/current` symlink switch and before `systemctl restart ws-server.service`.
   - If preflight fails, abort deployment immediately, do not switch symlink, do not restart service, and do not accept health gate.
8. **Infrastructure Configuration**:
   - Update `infra/vps/arcade-deploy.sudoers` to authorize `/usr/local/sbin/arcade-ws-production-env-preflight ""`.
   - Update `infra/vps/bootstrap.sh` to install `/usr/local/sbin/arcade-ws-production-env-preflight`.

## Acceptance Criteria
- Production env preflight script is installed and runnable as a standalone root-owned node script.
- Preflight rejects missing, non-regular, symlinked, wrong owner, or non-0600 env files.
- Preflight rejects missing required fields, non-3000 port, or invalid join settings.
- Preflight rejects Stage Supabase URL, Stage DB URL, or mixed configurations.
- Preflight executes read-only database query `select system_identifier from pg_control_system()` and requires `7575202818581710058`.
- Preflight rejects any database query error, timeout, or mismatched system identifier.
- Deploy workflow runs preflight before current release switch and service restart.
- Workflow guard tests verify preflight ordering and fail-closed behavior.
- All repo checks (`npm run check:all`, `npm run test:quick`, `npm run test:unit`) pass.

## Breaking Impact
- Brak wpływu na poprawnie skonfigurowane środowisko produkcyjne (canonical Production URL, canonical Production DB URL oraz właściwy PostgreSQL system identifier przechodzą pomyślnie).
- Intentional breaking/fail-closed behavior: Wszelkie próby wdrożenia Production WS ze złym projektem Supabase, z bazą Stage, ze sprzeczną konfiguracją URL vs DB, z niedostępną bazą danych lub z niezgodnym `system_identifier` zostaną zablokowane przed przełączeniem symlinka i przed restartem usługi.
