# CH economy reset runbook

Status: implementation-ready operator procedure. Do not execute production steps until the stage reset and smoke are explicitly accepted.

The executable reset is supabase/manual/chips-economy-test-reset.sql. It is a manual script, not a migration.

## 1. Non-negotiable gates

Do not begin a reset unless all conditions are true:

- the prerequisite guards in poker-create-table and poker-quick-seat are deployed;
- the target Supabase project ref is known independently from the DB URL;
- only one operator controls the reset;
- Netlify deployments, migrations, admin actions and SQL Editor writes are frozen;
- a verified full backup can be produced;
- the operator has permission to disable and re-enable the two ledger DELETE triggers;
- stage is completed before any production reset.

CHIPS_ENABLED=0 is defense-in-depth. Netlify Disable project is the hard traffic gate. Stopping WS is a separate mandatory gate.

## 2. Local prerequisites

Required tools:

- Node.js;
- PostgreSQL client compatible with the Supabase PostgreSQL version;
- Netlify CLI authenticated and linked to the Arcade Platform project;
- SSH access with sudo permission for ws-server-preview.service;
- enough encrypted local or remote storage for a full database backup.

Never paste DB URLs, passwords, service-role tokens or backup contents into a PR, issue or chat.

## 3. Stage read-only preflight

This section is safe to run before maintenance. It does not change Netlify, WS or the database.

Set the stage connection and independently obtained project ref:

    export RESET_TARGET=stage
    export SUPABASE_STAGE_DB_URL='<stage direct or pooler Postgres URL>'
    export EXPECTED_SUPABASE_PROJECT_REF='<stage project ref>'

Derive the project ref from the DB URL and compare it with the expected value:

    ACTUAL_SUPABASE_PROJECT_REF="$(node -e 'const u=new URL(process.env.SUPABASE_STAGE_DB_URL); const host=/^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(u.hostname); const user=/^postgres\.([a-z0-9-]+)$/i.exec(decodeURIComponent(u.username||"")); const ref=(host&&host[1])||(user&&user[1])||""; if(!ref) process.exit(2); process.stdout.write(ref);')"
    test "$ACTUAL_SUPABASE_PROJECT_REF" = "$EXPECTED_SUPABASE_PROJECT_REF"

A non-zero exit stops the procedure.

Run the SQL in preflight-only mode:

    psql "$SUPABASE_STAGE_DB_URL" -X       -v ON_ERROR_STOP=1       -v reset_target=stage       -v expected_project_ref="$EXPECTED_SUPABASE_PROJECT_REF"       -v reset_apply=0       -f supabase/manual/chips-economy-test-reset.sql       | tee stage-ch-reset-preflight.txt

Expected final line:

    PRE-FLIGHT ONLY. No rows or schema objects were modified.

Review and retain:

- preflight relation counts;
- account counts and balances by type/status;
- poker escrow count, residual count, total and maximum;
- current SYSTEM account rows;
- absence of missing-schema, missing-trigger, missing-migration or unexpected-FK errors.

Stop here and obtain explicit approval before entering maintenance.

## 4. Stage maintenance preparation

These steps mutate infrastructure state but do not reset the database yet.

### 4.1 Deploy the prerequisite guards

The deployed code must return 404 before auth or DB access when CHIPS_ENABLED is not exactly 1 for:

- /.netlify/functions/poker-create-table;
- /.netlify/functions/poker-quick-seat.

Set the Deploy Preview Functions-scoped value:

    netlify env:set CHIPS_ENABLED 0 --scope functions --context deploy-preview

Environment changes require a new deploy. Trigger a fresh Deploy Preview for the approved commit and wait for Netlify success.

Verify the maintenance deploy:

    curl -i -X POST 'https://<deploy-preview>/.netlify/functions/poker-create-table'
    curl -i -X POST 'https://<deploy-preview>/.netlify/functions/poker-quick-seat'

Both must return HTTP 404 with not_found. Do not continue on 401, 403, 500 or 200.

### 4.2 Freeze traffic and writers

1. Freeze merges, deployments, migrations, admin operations and SQL Editor writes.
2. In Netlify open Project configuration -> General -> Danger zone -> Disable project.
3. Verify the production URL, the selected Deploy Preview and direct function URLs are unavailable.
4. Stop WS Preview on the VPS:

       sudo systemctl stop ws-server-preview.service
       sudo systemctl is-active ws-server-preview.service

   Expected is inactive.

5. Confirm no operator or automation is running a DB migration or manual poker/admin action.

If any direct Netlify Function remains reachable, abort before backup or SQL.

## 5. Stage backup

Create a full custom-format backup. The command includes all accessible schemas, including public and auth:

    BACKUP_FILE="arcade-stage-before-ch-reset-$(date -u +%Y%m%dT%H%M%SZ).dump"
    pg_dump "$SUPABASE_STAGE_DB_URL"       --format=custom       --no-owner       --no-privileges       --file="$BACKUP_FILE"

Verify that the archive can be read:

    pg_restore --list "$BACKUP_FILE" > "$BACKUP_FILE.list"
    test -s "$BACKUP_FILE.list"
    grep -q 'SCHEMA.*public' "$BACKUP_FILE.list"
    grep -q 'SCHEMA.*auth' "$BACKUP_FILE.list"

Generate a checksum and copy the backup to approved encrypted storage outside the repository:

    sha256sum "$BACKUP_FILE" "$BACKUP_FILE.list"

Do not continue if pg_dump, pg_restore listing, schema checks, checksum or external storage fails.

## 6. Stage reset apply

Reconfirm the external target check immediately before apply:

    test "$RESET_TARGET" = "stage"
    test "$ACTUAL_SUPABASE_PROJECT_REF" = "$EXPECTED_SUPABASE_PROJECT_REF"

Run the destructive mode exactly once:

    psql "$SUPABASE_STAGE_DB_URL" -X       -v ON_ERROR_STOP=1       -v reset_target=stage       -v expected_project_ref="$EXPECTED_SUPABASE_PROJECT_REF"       -v reset_apply=1       -v confirm_reset=RESET_STAGE_CH_ECONOMY       -f supabase/manual/chips-economy-test-reset.sql       | tee stage-ch-reset-apply.txt

Expected final line:

    RESET COMMITTED AND POST-COMMIT BASELINE VERIFIED FOR: stage

Any other exit or final result is failure. Keep Netlify disabled, CHIPS_ENABLED=0 and WS stopped until the failure path is resolved.

## 7. Stage service restore and smoke

Restore the Deploy Preview Functions-scoped value:

    netlify env:set CHIPS_ENABLED 1 --scope functions --context deploy-preview

Environment changes require a fresh deploy.

1. Enable the Netlify project.
2. Trigger a fresh Deploy Preview and wait for success.
3. Confirm admin Stage Identity reports databaseTarget=stage, stageProjectRefMatches=true and chipsEnabled=true.
4. Start WS Preview:

       sudo systemctl start ws-server-preview.service
       sudo systemctl is-active ws-server-preview.service

   Expected is active.

5. Perform the smoke:
   - log in with an existing test user;
   - hard-refresh and fetch chips balance;
   - confirm a new USER account starts at 0 CH;
   - claim the accepted welcome/promo bonus;
   - create a new poker table;
   - confirm human and bots start with 100 CH;
   - finish a short hand;
   - leave and wait for terminal close;
   - confirm table status CLOSED and escrow balance 0;
   - confirm bot cash-out returned to proven SYSTEM provenance;
   - open Admin -> Ops and confirm the residual card is green with 0 closed residual tables and 0 CH.

Retain the table ID, relevant sanitized WS log lines, final user balance, final table status and escrow balance.

## 8. Abort and recovery

### 8.1 No COMMIT or transaction rollback

1. Stop further reset work.
2. Read-only verify that old accounts/tables remain and all required triggers are enabled.
3. Set the affected Netlify context back to CHIPS_ENABLED=1.
4. Produce a fresh deploy. Changing ENV alone is insufficient.
5. If Netlify cannot build while disabled, enable the project with the maintenance deploy still on CHIPS_ENABLED=0, then immediately publish the fresh deploy.
6. Keep WS stopped until the fresh deploy succeeds.
7. Start the applicable WS service.
8. Verify balance read, table creation and WS connectivity.

### 8.2 COMMIT succeeded but post-commit checks or smoke failed

1. Keep Netlify disabled.
2. Keep CHIPS_ENABLED=0 and WS stopped.
3. Restore the verified full backup using the approved Supabase/PostgreSQL restore procedure.
4. Read-only verify ledger integrity, triggers, tables and SYSTEM accounts.
5. Only then follow the no-COMMIT service recovery steps.

If rollback or restore cannot be proven, keep the environment in maintenance and escalate. Never reconnect writers to an ambiguous database state.

## 9. Production hold point

Do not prepare or execute production maintenance until the owner provides all of:

- accepted stage preflight;
- accepted backup verification;
- successful stage apply output;
- successful stage smoke table ID and logs;
- Admin/Ops residual result equal to 0 tables and 0 CH.

Production uses the same SQL file with a separately verified production project ref, a separate full backup and confirmation RESET_PROD_CH_ECONOMY. Production commands are intentionally not authorized by completion of the stage procedure.

## 10. Breaking impact

The reset permanently removes, unless restored from backup:

- all USER and ESCROW CH accounts;
- all CH transactions and entries;
- all bonus_claims;
- all poker tables, state, seats, requests, actions and hole cards.

It preserves Auth users, user profiles, XP, favorites, avatars, bonus campaign definitions and eligible-user configuration. Existing users recreate a 0 CH account lazily and may claim eligible bonuses again.

The prerequisite guards return 404 for table creation and quick-seat whenever CHIPS_ENABLED is not exactly 1. Monitoring adds one read-only aggregate query whenever Admin/Ops is loaded or refreshed.

