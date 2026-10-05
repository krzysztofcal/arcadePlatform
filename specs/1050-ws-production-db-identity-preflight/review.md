# Code Review & Verification Evidence: Finding P1 #3 (Issue #1050)

## Problem Summary
Finding P1 #3 from GitHub issue #1050:
*"Production WS deploy can pass health while connected to the wrong Supabase/PostgreSQL target."*

### Root Cause
1. While Preview already had a root-owned preflight (`infra/vps/ws-preview-env-preflight.mjs`) checking project ref and env file integrity, Production deploy in `.github/workflows/ws-server-deploy.yml` lacked any backend identity preflight before switching releases and restarting `ws-server.service`.
2. Existing Production deploy gates verified network/process liveness (`/healthz` returning `ok` and WS hello handshake), but did not prove backend target identity.
3. If `/etc/arcadeplatform/ws-server.env` had been corrupted, restored incorrectly, or misconfigured with a Stage DB URL or mixed configuration (Production `SUPABASE_URL` with Stage `SUPABASE_DB_URL`), the Production deploy would have restarted and accepted the service as healthy, potentially mutating or reading from the wrong database.

## Solution Architecture
1. **Production Environment Preflight Script (`infra/vps/ws-production-env-preflight.mjs`)**:
   - Reads strictly from the fixed `/etc/arcadeplatform/ws-server.env` (never from user input or verified env).
   - Enforces fail-closed file security contract: regular file, no symlinks (`O_NOFOLLOW | O_NONBLOCK`), root-owned (`uid === 0 && gid === 0`), and mode `0600`.
   - Requires non-empty `SUPABASE_DB_URL`, `SUPABASE_URL`, `POKER_WS_INTERNAL_TOKEN`, `PORT=3000`, and `WS_AUTHORITATIVE_JOIN_ENABLED=1`.
   - Rejects legacy reaction settings (`WS_BOT_REACTION_MIN_MS`, `WS_BOT_REACTION_MAX_MS`).
   - Binds to canonical Production project ref `otbqfijerkieoxwpxjnm` independently of mutable env input.
   - Verifies `SUPABASE_URL` targets `://otbqfijerkieoxwpxjnm.supabase.co`.
   - Verifies `SUPABASE_DB_URL` targets `otbqfijerkieoxwpxjnm` (supporting pooler format `postgres.otbqfijerkieoxwpxjnm` and direct formats).
   - Strictly rejects Stage project ref `krydukthwdvccggbyjfw` or mixed configurations.
   - Parses `SUPABASE_DB_URL` into components (`host`, `port`, `user`, `password`, `database`, `sslmode`).
   - Executes read-only DB identity query `select system_identifier from pg_control_system();` via `psql`.
   - Passes DB password strictly via `PGPASSWORD` subprocess environment variable; command line arguments (`argv`) contain only non-secret flags (`-h`, `-p`, `-U`, `-d`, `-X`, `-Atq`, `-v ON_ERROR_STOP=1`, `-c`).
   - Redacts all passwords and connection credentials from stdout/stderr via `sanitizeOutput`.
   - Asserts the returned identifier matches canonical Production `7575202818581710058`.
   - Rejects any mismatch, connection failure, timeout, or missing database client.
   - Production CLI execution block contains no `process.env.WS_PREFLIGHT_*` seams; test parameters are passed via direct function parameters (`runPreflight({ envFile, allowTestUid, querySystemIdentifier })`).
2. **Infrastructure Configuration & Existing-Host Staging**:
   - Updated `infra/vps/arcade-deploy.sudoers` to include `/usr/local/sbin/arcade-ws-production-env-preflight ""`.
   - Updated `infra/vps/bootstrap.sh` to install the preflight script at `/usr/local/sbin/arcade-ws-production-env-preflight` with mode 0755 root:root for fresh host recovery.
   - Created `infra/vps/stage-production-env-preflight.sh` for owner-approved existing-host staging:
     - Validates prerequisites (`/etc/arcadeplatform/ws-server.env`, `/usr/bin/node`, `/usr/bin/psql`).
     - Validates sudoers syntax with `visudo -cf`.
     - Installs `/usr/local/sbin/arcade-ws-production-env-preflight` (`0755 root:root`) and `/etc/sudoers.d/arcade-deploy` (`0440 root:root`).
     - Verifies read-only via `sudo -u copilot sudo -n /usr/local/sbin/arcade-ws-production-env-preflight` expecting `PASS`.
     - Zero restarts, zero env modifications, zero DB mutations.
   - Updated documentation in `docs/vps-disaster-recovery.md`, `docs/poker-deployment.md`, and `infra/vps/README.md`.
3. **Deploy Workflow Integration (`.github/workflows/ws-server-deploy.yml`)**:
   - Executes `sudo -n /usr/local/sbin/arcade-ws-production-env-preflight` on the VPS before `/opt/ws-server/current` symlink switch and before `systemctl restart ws-server.service`.
   - Fails closed: any error terminates deployment without switching the release or restarting the service.
   - Retains existing atomic release switch, local `/healthz`, public `/healthz`, and public hello handshake once identity is proven.
   - Registered `ws-production-env-preflight.behavior.test.mjs` in the `validate` job.

## Automated Verification
- **Targeted Test Suites**:
  - `node --test ws-tests/ws-production-env-preflight.behavior.test.mjs` (16/16 pass):
    - `parseEnv` parses assignments and trims quotes -> PASS
    - `parseDbUrl` parses pooler and direct connection strings correctly -> PASS
    - `sanitizeOutput` redacts secret passwords and connection URI credentials -> PASS
    - Valid canonical Production env + correct DB system identifier (`7575202818581710058`) -> PASS
    - Direct DB URL format -> PASS
    - Stage `SUPABASE_URL` -> FAIL
    - Stage `SUPABASE_DB_URL` -> FAIL
    - Mixed Production URL + Stage DB -> FAIL
    - Mixed Stage URL + Production DB -> FAIL
    - Missing required variables / bad ports / bad join -> FAIL
    - Symlinks, wrong file mode (e.g. 0644), or wrong owner -> FAIL
    - DB returning wrong `system_identifier` (e.g. Stage `7656985631720456337`) -> FAIL
    - DB query error or empty response -> FAIL
    - CLI execution ignores `WS_PREFLIGHT_*` test env vars and rejects extra arguments -> PASS
    - `stage-production-env-preflight.sh` has valid syntax and strictly verifies without restarts -> PASS
    - Workflow ordering guard in `ws-server-deploy.yml` -> PASS
  - `node --test ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs` (1/1 pass)
  - `node --test ws-tests/infra-vps-workflow.guard.test.mjs` (16/16 pass)
  - Deploy suite tests (`ws-server-deploy.*`, `ws-production-deploy-collision.*`, `ws-deploy.*`): all passed.
- **Repository Checks**:
  - `npm run test:quick`: Syntax OK (221 files).
  - `npm run check:all`: Lifecycle OK (169 files), Badge OK (53 pages), XP guards OK.
  - `npm run test:unit`: Games validation OK.

## Breaking Impact
- Brak wpływu na poprawnie skonfigurowane środowisko produkcyjne (canonical Production URL, canonical Production DB URL oraz właściwy PostgreSQL system identifier przechodzą pomyślnie).
- Intentional breaking/fail-closed behavior: Wszelkie próby wdrożenia Production WS ze złym projektem Supabase, z bazą Stage, ze sprzeczną konfiguracją URL vs DB, z niedostępną bazą danych lub z niezgodnym `system_identifier` zostaną natychmiast zablokowane przed przełączeniem symlinka i przed restartem usługi.
