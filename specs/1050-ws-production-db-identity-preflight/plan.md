# Plan

## Technical context
JavaScript ESM, node:test, infra/vps scripts, GitHub Actions workflow `.github/workflows/ws-server-deploy.yml`. Base live main `87f9153ed426424d6b7651f6aa8c353aa862c99b`.

## Constitution Check
PASS:
- Fundamental deterministic tests only.
- No UI/CSS/JSP/glue suites.
- Minimal change:
  - Add `infra/vps/ws-production-env-preflight.mjs` mirroring the Preview pattern.
  - Bind to canonical Production project ref `otbqfijerkieoxwpxjnm` and PostgreSQL system identifier `7575202818581710058`.
  - Add read-only DB identity query `select system_identifier from pg_control_system()`.
  - Add preflight execution to `.github/workflows/ws-server-deploy.yml` before release switch and service restart.
  - Add preflight command to `infra/vps/arcade-deploy.sudoers` and `infra/vps/bootstrap.sh`.
  - Add fundamental deterministic test suite in `ws-tests/ws-production-env-preflight.behavior.test.mjs` and update workflow guards.
- No new framework, no proxy dependencies, no schema or migration changes.
- Fail-closed security boundary.

## Changes
1. `infra/vps/ws-production-env-preflight.mjs`:
   - Standalone node script with shebang `#!/usr/bin/node`.
   - Opens `/etc/arcadeplatform/ws-server.env` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`.
   - Metadata validation (`metadata.isFile()`, `metadata.uid === 0`, `metadata.gid === 0`, `(metadata.mode & 0o7777) === 0o600`).
   - Checks descriptor metadata before reading file contents.
   - Parses env values with strict regex.
   - Requires non-empty `SUPABASE_DB_URL`, `SUPABASE_URL`, `POKER_WS_INTERNAL_TOKEN`, and `WS_AUTHORITATIVE_JOIN_ENABLED=1` (`PORT=3000` is defined by systemd `ws-server.service` and is not required in `ws-server.env`).
   - Rejects legacy `WS_BOT_REACTION_MIN_MS` and `WS_BOT_REACTION_MAX_MS`.
   - Checks `SUPABASE_URL` contains `://otbqfijerkieoxwpxjnm.supabase.co`.
   - Checks `SUPABASE_DB_URL` contains `postgres.otbqfijerkieoxwpxjnm` (pooler) or `.otbqfijerkieoxwpxjnm.` / `//otbqfijerkieoxwpxjnm.` (direct).
   - Rejects Stage project ref `krydukthwdvccggbyjfw`.
   - Queries `select system_identifier from pg_control_system()` using `psql` (or test runner seam `WS_PREFLIGHT_MOCK_SYSTEM_IDENTIFIER`).
   - Requires query result to match exactly `7575202818581710058`.
   - Rejects any mismatch, query error, timeout, or missing client.
   - Outputs `PASS\n` on success, error message on stderr with exit code 1 on failure.

2. `infra/vps/arcade-deploy.sudoers`:
   - Add `/usr/local/sbin/arcade-ws-production-env-preflight ""` to `ARCADE_DEPLOY_COMMANDS`.

3. `infra/vps/bootstrap.sh`:
   - Install `infra/vps/ws-production-env-preflight.mjs` to `/usr/local/sbin/arcade-ws-production-env-preflight` mode 0755 root:root for fresh host recovery.

4. `infra/vps/stage-production-env-preflight.sh`:
   - Owner-approved existing-host staging script.
   - Requires root, verifies prerequisites on existing host.
   - Validates sudoers syntax with `visudo -cf`.
   - Installs `/usr/local/sbin/arcade-ws-production-env-preflight` (`0755 root:root`).
   - Installs `/etc/sudoers.d/arcade-deploy` (`0440 root:root`) and checks with `visudo -c`.
   - Performs read-only verification: `sudo -u copilot sudo -n /usr/local/sbin/arcade-ws-production-env-preflight` expecting `PASS`.
   - Zero restarts, zero env edits, zero DB mutations.

5. `.github/workflows/ws-server-deploy.yml`:
   - In `deploy` job, step `Atomic release switch + restart + health gate on VPS`:
     Execute `sudo -n /usr/local/sbin/arcade-ws-production-env-preflight` before switching `current` link and before `systemctl restart ws-server.service`.
   - In `validate` job:
     Run `node --test ws-tests/ws-production-env-preflight.behavior.test.mjs`.

6. Documentation:
   - `docs/vps-disaster-recovery.md`: add existing-host staging section.
   - `docs/poker-deployment.md`: add production preflight helper to quick VPS check.
   - `infra/vps/README.md`: add production preflight helper and staging script notes.

7. Tests:
   - `ws-tests/ws-production-env-preflight.behavior.test.mjs`:
     - Test parseEnv.
     - Test parseDbUrl (pooler and direct connection strings).
     - Test sanitizeOutput (password and URI credential redaction).
     - Test canonical Production env + correct DB system identifier (`7575202818581710058`) -> PASS.
     - Test Stage SUPABASE_URL (`krydukthwdvccggbyjfw`) -> FAIL.
     - Test Stage SUPABASE_DB_URL (`krydukthwdvccggbyjfw`) -> FAIL.
     - Test Mixed Production URL + Stage DB -> FAIL.
     - Test Missing required fields / wrong join -> FAIL.
     - Test Symlink, wrong uid, wrong gid, or wrong permissions mode -> FAIL.
     - Test DB returns different system_identifier (e.g. Stage `7656985631720456337`) -> FAIL.
     - Test DB identity check error / connection failure -> FAIL.
     - Test CLI execution ignores WS_PREFLIGHT_* test env vars and rejects extra arguments -> PASS.
     - Test staging script syntax and non-destructive properties -> PASS.
     - Test Workflow guard confirms preflight execution order before `current` switch and `systemctl restart ws-server.service`.
   - Existing guard tests:
     - `ws-tests/infra-vps-workflow.guard.test.mjs`: assert presence of `arcade-ws-production-env-preflight`.
     - `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs`: assert presence of `sudo -n /usr/local/sbin/arcade-ws-production-env-preflight`.

8. Verification:
   - Run targeted test suites: `node --test ws-tests/ws-production-env-preflight.behavior.test.mjs`.
   - Run related deploy guard suites.
   - Run repo checks: `npm run check:all`, `npm run test:quick`, `npm run test:unit`.
   - Draft PR linked to #1050 (keep in Draft until owner completes existing-host staging).

## Breaking Impact
- Brak wpływu na poprawnie skonfigurowane środowisko produkcyjne (canonical Production URL, canonical Production DB URL oraz właściwy PostgreSQL system identifier przechodzą pomyślnie).
- Intentional breaking/fail-closed behavior: Wszelkie próby wdrożenia Production WS ze złym projektem Supabase, z bazą Stage, ze sprzeczną konfiguracją URL vs DB, z niedostępną bazą danych lub z niezgodnym `system_identifier` zostaną zablokowane przed przełączeniem symlinka i przed restartem usługi.
