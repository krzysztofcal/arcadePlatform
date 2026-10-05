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
   - Requires non-empty `SUPABASE_DB_URL`, `SUPABASE_URL`, `POKER_WS_INTERNAL_TOKEN`.
   - Requires `PORT=3000` and `WS_AUTHORITATIVE_JOIN_ENABLED=1`.
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
   - Install `infra/vps/ws-production-env-preflight.mjs` to `/usr/local/sbin/arcade-ws-production-env-preflight` mode 0755 root:root.

4. `.github/workflows/ws-server-deploy.yml`:
   - In `deploy` job, step `Atomic release switch + restart + health gate on VPS`:
     Execute `sudo -n /usr/local/sbin/arcade-ws-production-env-preflight` before switching `current` link and before `systemctl restart ws-server.service`.
   - In `validate` job:
     Run `node --test ws-tests/ws-production-env-preflight.behavior.test.mjs`.

5. Tests:
   - Create `ws-tests/ws-production-env-preflight.behavior.test.mjs`:
     - Test 1: Canonical Production env + correct DB system identifier (`7575202818581710058`) -> PASS.
     - Test 2: Stage SUPABASE_URL (`krydukthwdvccggbyjfw`) -> FAIL.
     - Test 3: Stage SUPABASE_DB_URL (`krydukthwdvccggbyjfw`) -> FAIL.
     - Test 4: Mixed Production URL + Stage DB -> FAIL.
     - Test 5: Missing required fields / wrong port / wrong join -> FAIL.
     - Test 6: Symlink, wrong uid, wrong gid, or wrong permissions mode -> FAIL.
     - Test 7: DB returns different system_identifier (e.g. Stage `7656985631720456337`) -> FAIL.
     - Test 8: DB identity check error / connection failure -> FAIL.
     - Test 9: Workflow guard confirms preflight execution order before `current` switch and `systemctl restart ws-server.service`.
   - Update existing guard tests:
     - `ws-tests/infra-vps-workflow.guard.test.mjs`: assert presence of `arcade-ws-production-env-preflight`.
     - `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs`: assert presence of `sudo -n /usr/local/sbin/arcade-ws-production-env-preflight`.

6. Verification:
   - Run targeted test suites: `node --test ws-tests/ws-production-env-preflight.behavior.test.mjs`.
   - Run related deploy guard suites.
   - Run repo checks: `npm run check:all`, `npm run test:quick`, `npm run test:unit`.
   - Draft PR linked to #1050 (do not merge, do not perform unapproved production rollout).

## Breaking Impact
- Brak wpływu na poprawnie skonfigurowane środowisko produkcyjne (canonical Production URL, canonical Production DB URL oraz właściwy PostgreSQL system identifier przechodzą pomyślnie).
- Intentional breaking/fail-closed behavior: Wszelkie próby wdrożenia Production WS ze złym projektem Supabase, z bazą Stage, ze sprzeczną konfiguracją URL vs DB, z niedostępną bazą danych lub z niezgodnym `system_identifier` zostaną zablokowane przed przełączeniem symlinka i przed restartem usługi.
