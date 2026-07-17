# CH economy reset runbook

Status: implementation-ready operator procedure. Do not execute production steps until the stage reset and smoke are explicitly accepted.

The executable reset is supabase/manual/chips-economy-test-reset.sql. It is a manual script, not a migration.

## 1. Non-negotiable gates

Do not begin a reset unless all conditions are true:

- the prerequisite guards in poker-create-table and poker-quick-seat are deployed;
- the target Supabase project ref is known independently from the DB URL;
- only one operator controls the reset;
- Netlify Deploy Preview deployments, migrations, admin actions and SQL Editor writes are frozen;
- a verified full backup can be produced;
- the operator has permission to disable and re-enable the two ledger DELETE triggers;
- the operator has Supabase Owner/Admin access capable of reading and updating stage Network Restrictions;
- stage is completed before any production reset.

For the stage reset, `CHIPS_ENABLED=0` is defense-in-depth and Supabase Network Restrictions are the hard database traffic gate. The production site remains online. Stopping WS Preview before applying the restriction is a separate mandatory gate. Do not delete historical Deploy Previews.

## 2. Operator prerequisites — Ubuntu VPS

Run the preflight and later reset from an Ubuntu VPS checkout of this repository. The Supabase SQL Editor is not the preferred execution method: the reset file uses `psql` meta-commands (`\if`, `\set`, `\quit`) and command-line `-v` parameters that the Dashboard SQL Editor does not implement.

### 2.1 Verify tools

From an interactive Bash shell on the VPS, check:

    psql --version
    node --version
    npx --version
    curl --version
    flock --version

If `psql` is missing (`command not found`), install only the Ubuntu PostgreSQL client:

    sudo apt update
    sudo apt install -y postgresql-client
    psql --version

If `node` is missing, stop. Do not copy an unreviewed installer command from the internet. Install Node.js through the VPS's existing approved provisioning method, then rerun `node --version` before continuing.

Later maintenance sections additionally require:

- Netlify CLI authenticated and linked to the Arcade Platform project;
- Supabase CLI authentication through an existing login or a privately supplied `SUPABASE_ACCESS_TOKEN` with `database_network_restrictions_read` and `database_network_restrictions_write`;
- SSH access with sudo permission for `ws-server-preview.service`;
- enough encrypted local or remote storage for a full database backup.

### 2.2 Confirm the repository file

Change to the root of the Arcade Platform checkout, then verify the manual script:

    test -f supabase/manual/chips-economy-test-reset.sql
    test -r supabase/manual/chips-economy-test-reset.sql
    ls -l supabase/manual/chips-economy-test-reset.sql
    test -x scripts/ops/stage-network-maintenance.sh
    ls -l scripts/ops/stage-network-maintenance.sh

Any non-zero result means the checkout or current revision is wrong. Stop instead of copying the SQL into another tool.

### 2.3 Obtain the stage connection information

In Supabase Dashboard, select the stage project, not production:

1. Open `Settings -> General` and copy `Project Settings -> Reference ID`. This is the stage project ref used for the independent comparison.
2. Click `Connect` at the top of the project Dashboard and choose the PostgreSQL connection string in URI form.
3. Prefer `Direct connection` for the persistent Ubuntu VPS when it can reach Supabase over IPv6 (or the project has the IPv4 add-on).
4. If the VPS is IPv4-only, use `Session pooler` on port `5432`. Do not prefer Transaction pooler on port `6543` for this operator workflow.
5. Replace the password placeholder only in the private shell prompt described below.

The database password and complete connection string are secrets. The project ref is not an authentication credential, but it is still operational metadata and should not be posted publicly without need. Never put the connection string or password in the repository, a commit, PR, issue, chat, shell script, runbook output or `tee` output.

### 2.4 Protect secrets and output

Use a private interactive shell. Disable Bash history before entering the connection string and use a silent prompt so the value is neither echoed nor stored as a literal command:

    set +o history
    umask 077
    read -rsp 'Stage PostgreSQL connection string: ' SUPABASE_STAGE_DB_URL
    printf '\n'
    export SUPABASE_STAGE_DB_URL

Do not use `export SUPABASE_STAGE_DB_URL='real-secret-url'` in an interactive command that may be written to shell history. The preflight output does not intentionally print the URL or password. `umask 077` ensures a newly created output file is readable only by its owner.

After the approved operation, clear the variables and restore the previous history behavior:

    unset SUPABASE_STAGE_DB_URL EXPECTED_SUPABASE_PROJECT_REF ACTUAL_SUPABASE_PROJECT_REF RESET_TARGET
    set -o history

Keep the preflight output outside the repository with mode `600`, or remove it after review:

    chmod 600 stage-ch-reset-preflight.txt
    mv stage-ch-reset-preflight.txt '<approved-private-directory>/'

If it does not need to be retained, remove it instead:

    rm -f stage-ch-reset-preflight.txt

`shred -u` may be used as a best-effort alternative on traditional local disks, but it is not a reliable erasure guarantee on snapshots, SSDs or copy-on-write storage.

## 3. Stage read-only preflight

This section is safe to run before maintenance. It does not change Netlify, WS or the database.

Set the non-secret target and enter the independently obtained project ref. Enter the connection string through the silent prompt from section 2.4:

    export RESET_TARGET=stage
    read -rp 'Expected stage Supabase project ref: ' EXPECTED_SUPABASE_PROJECT_REF
    export EXPECTED_SUPABASE_PROJECT_REF

Derive the project ref from the DB URL and compare it with the expected value:

    ACTUAL_SUPABASE_PROJECT_REF="$(node -e 'const u=new URL(process.env.SUPABASE_STAGE_DB_URL); const host=/^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(u.hostname); const user=/^postgres\.([a-z0-9-]+)$/i.exec(decodeURIComponent(u.username||"")); const ref=(host&&host[1])||(user&&user[1])||""; if(!ref) process.exit(2); process.stdout.write(ref);')"
    if [ "$ACTUAL_SUPABASE_PROJECT_REF" != "$EXPECTED_SUPABASE_PROJECT_REF" ]; then
      echo 'STOP: project ref mismatch; no database command was run.' >&2
      unset SUPABASE_STAGE_DB_URL EXPECTED_SUPABASE_PROJECT_REF ACTUAL_SUPABASE_PROJECT_REF RESET_TARGET
      exit 1
    fi
    printf 'Project ref verified: %s\n' "$ACTUAL_SUPABASE_PROJECT_REF"

A Node.js error, empty ref or mismatch stops the procedure. Do not override this comparison.

Run the SQL from the repository in preflight-only mode. `pipefail` and `PIPESTATUS[0]` preserve the real `psql` exit status even though output is also sent through `tee`:

    set -o pipefail
    psql "$SUPABASE_STAGE_DB_URL" -X \
      -v ON_ERROR_STOP=1 \
      -v reset_target=stage \
      -v expected_project_ref="$EXPECTED_SUPABASE_PROJECT_REF" \
      -v reset_apply=0 \
      -f supabase/manual/chips-economy-test-reset.sql \
      2>&1 | tee stage-ch-reset-preflight.txt
    PREFLIGHT_EXIT=${PIPESTATUS[0]}
    printf 'Preflight exit code: %s\n' "$PREFLIGHT_EXIT"
    chmod 600 stage-ch-reset-preflight.txt
    test "$PREFLIGHT_EXIT" -eq 0

Successful preflight has exit code `0` and contains this final SQL message before the printed exit-code line:

    PRE-FLIGHT ONLY. No rows or schema objects were modified.

Review and retain:

- preflight relation counts;
- account counts and balances by type/status;
- poker escrow count, residual count, total and maximum;
- current SYSTEM account rows;
- absence of missing-schema, missing-trigger, missing-migration or unexpected-FK errors.

Stop here and obtain explicit approval before entering maintenance.

### 3.1 Error handling

- `psql: command not found`: install `postgresql-client` as described in section 2.1, verify `psql --version`, then restart preflight from the beginning.
- project ref mismatch or ref extraction failure: do not connect. Re-select the stage project and independently re-copy both values. Never change the expected ref merely to match an unexpected URL.
- connection, DNS, IPv6, authentication or TLS failure: do not continue. Recheck the stage URI and password. If Direct Connection is unreachable from an IPv4-only VPS, use the stage Session pooler URI from `Connect` and repeat the external ref comparison.
- any SQL/preflight error or non-zero exit code: do not enter maintenance. Retain the protected output for diagnosis and leave Netlify, WS, `CHIPS_ENABLED` and the database unchanged.
- missing success message even with an apparent zero status: treat it as failure and stop.

At this stage do not set `CHIPS_ENABLED=0`, deploy maintenance code, change Network Restrictions, stop WS, create a backup or run reset apply.

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

Complete the following maintenance checklist against the freshly deployed Deploy Preview:

- the same active allowlisted administrator session still opens the Admin panel and can view the Ops tab;
- the Admin panel shows the explicit economy maintenance banner;
- Runtime and Stage Identity show `CHIPS_ENABLED off`;
- Stage Identity reports the expected stage database target and project ref, including `databaseTarget=stage`, `stageProjectRefMatches=true` and `databaseMatchesSupabaseProjectRef=true`;
- `/.netlify/functions/admin-me`, `/.netlify/functions/admin-stage-identity` and `/.netlify/functions/admin-ops-summary` return HTTP 200 for the allowlisted administrator;
- a separately verified account whose user ID is not in `ADMIN_USER_IDS` still cannot access the Admin panel;
- `/.netlify/functions/poker-create-table`, `/.netlify/functions/poker-quick-seat`, `/.netlify/functions/admin-ops-actions` and `/.netlify/functions/admin-ws-preview-bot-reaction` each return controlled HTTP 404 with `not_found` when invoked with their normal mutating method and a valid administrator session.

Record every item as PASS. A 401, 403, 500, unexpected environment/project identity, missing maintenance banner, accessible mutation or loss of the allowlisted administrator's Admin/Ops access is a failed maintenance deploy. Restore `CHIPS_ENABLED=1`, produce a fresh deploy and stop for diagnosis.

Do not stop WS Preview, run the Network Restrictions preflight/restrict commands or create the backup until every checklist item above has passed.

### 4.2 Freeze traffic and writers

1. Freeze merges, Deploy Preview deployments, stage DB workflows, migrations, admin operations and SQL Editor writes. Production remains online.
2. Do not delete or manually disable historical Deploy Previews. Their Postgres and pooler access will be blocked at the stage Supabase project boundary.
3. In a separate browser session, confirm the operator can open the stage Supabase Dashboard Network Restrictions panel with Owner/Admin access. Keep that authenticated emergency recovery path available throughout maintenance. A successful read-only CLI preflight cannot prove that credentials will retain write permission for the entire window.
4. Export the stage identity. `SUPABASE_PROJECT_REF` must be the ref already derived from `SUPABASE_STAGE_DB_URL` in section 3, while `EXPECTED_SUPABASE_PROJECT_REF` remains the independently copied Dashboard value:

       export RESET_TARGET=stage
       export SUPABASE_PROJECT_REF="$ACTUAL_SUPABASE_PROJECT_REF"
       test "$SUPABASE_PROJECT_REF" = "$EXPECTED_SUPABASE_PROJECT_REF"

5. Determine the VPS's current public addresses independently and export host CIDRs. Use `/32` for IPv4 and `/128` for IPv6. Do not copy these placeholders literally:

       export VPS_IPV4_CIDR='<current-vps-ipv4>/32'
       export VPS_IPV6_CIDR='<current-vps-ipv6>/128'

   If the VPS has no working public IPv6 route, leave `VPS_IPV6_CIDR` unset and ensure the selected PostgreSQL connection route works over the allowlisted IPv4 address.

6. Stop WS Preview before restricting the database. The service runs on the allowlisted VPS, so Network Restrictions would not block it:

       sudo systemctl stop ws-server-preview.service
       sudo systemctl is-active ws-server-preview.service

   Expected is inactive.

7. Save the exact current Network Restrictions configuration. This is read-only and refuses to overwrite an unresolved recovery file:

       scripts/ops/stage-network-maintenance.sh preflight

   Expected evidence:

       NETWORK PREFLIGHT PASSED.
       No Network Restrictions were modified.

8. Restrict stage Postgres and its pooler to the VPS only, then inspect the applied state:

       scripts/ops/stage-network-maintenance.sh restrict
       scripts/ops/stage-network-maintenance.sh status

   Required status is `applied` with mode `restricted-to-vps` and exactly the exported VPS CIDRs. The script uses pinned Supabase CLI `2.109.1`, replaces the complete CIDR set without `--append`, and stores recovery state outside the repository with mode `600`.

9. Confirm the operator's `psql` connection from the VPS still works:

       psql "$SUPABASE_STAGE_DB_URL" -X -v ON_ERROR_STOP=1 -c 'select 1;'

10. Confirm no operator or automation is running a DB migration or manual poker/admin action. Do not rely on Admin/Ops during this restricted phase: Netlify's direct Postgres connection is intentionally outside the VPS allowlist.

Any unexpected CIDR, non-`applied` status, active WS service, failed VPS `psql` connection or missing recovery file is an abort before backup or reset SQL. Use `restore` or the Supabase Dashboard emergency procedure in section 8; do not widen the allowlist ad hoc.

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

Any other exit or final result is failure. Keep `CHIPS_ENABLED=0`, the VPS-only Network Restrictions and WS stopped until the failure path is resolved.

## 7. Stage service restore and smoke

First restore the exact Network Restrictions configuration captured before maintenance, while WS Preview is still inactive:

    scripts/ops/stage-network-maintenance.sh restore

Expected evidence includes:

    NETWORK RESTORE VERIFIED.

The command archives the protected recovery file only after the Management API reports `status=applied` and the exact previous IPv4/IPv6 configuration. Confirm the archived path printed by the command and verify the VPS still connects with `psql`.

Only after the verified network restore, restore the Deploy Preview Functions-scoped value:

    netlify env:set CHIPS_ENABLED 1 --scope functions --context deploy-preview

Environment changes require a fresh deploy.

1. Trigger a fresh Deploy Preview and wait for success. The production site has remained online throughout the stage reset.
2. Confirm admin Stage Identity reports databaseTarget=stage, stageProjectRefMatches=true and chipsEnabled=true.
3. Start WS Preview:

       sudo systemctl start ws-server-preview.service
       sudo systemctl is-active ws-server-preview.service

   Expected is active.

4. Perform the full application smoke. It happens after network restore because Netlify Functions do not originate from the VPS CIDRs:
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
3. Keep WS stopped and run `scripts/ops/stage-network-maintenance.sh restore`. Verify `NETWORK RESTORE VERIFIED` before reconnecting any application writer.
4. Set the affected Netlify context back to CHIPS_ENABLED=1.
5. Produce a fresh deploy. Changing ENV alone is insufficient.
6. Keep WS stopped until the fresh deploy succeeds.
7. Start the applicable WS service.
8. Verify balance read, table creation and WS connectivity.

If the CLI cannot restore the configuration, use Supabase Dashboard -> Database Settings -> Network Restrictions as the emergency recovery path. Read the protected recovery JSON, confirm its project ref, recreate exactly both saved CIDR arrays, wait for the Dashboard to report the applied configuration, and independently re-read it with the script's `status` command. Never copy a recovery file from another project.

### 8.2 COMMIT succeeded but post-commit checks or smoke failed

1. Keep the VPS-only Network Restrictions active.
2. Keep CHIPS_ENABLED=0 and WS stopped.
3. Restore the verified full backup using the approved Supabase/PostgreSQL restore procedure.
4. Read-only verify ledger integrity, triggers, tables and SYSTEM accounts.
5. Only then run the network `restore` command and follow the remaining no-COMMIT service recovery steps.

If rollback or restore cannot be proven, keep the environment in maintenance and escalate. Never reconnect writers to an ambiguous database state.

## 9. Production hold point

Do not prepare or execute production maintenance until the owner provides all of:

- accepted stage preflight;
- accepted backup verification;
- successful stage apply output;
- successful stage smoke table ID and logs;
- Admin/Ops residual result equal to 0 tables and 0 CH.

Production uses the same SQL file with a separately verified production project ref, a separate full backup and confirmation RESET_PROD_CH_ECONOMY. The stage-only Network Restrictions script does not authorize or implement a production network change. Production commands are intentionally not authorized by completion of the stage procedure.

## 10. Breaking impact

The reset permanently removes, unless restored from backup:

- all USER and ESCROW CH accounts;
- all CH transactions and entries;
- all bonus_claims;
- all poker tables, state, seats, requests, actions and hole cards.

It preserves Auth users, user profiles, XP, favorites, avatars, bonus campaign definitions and eligible-user configuration. Existing users recreate a 0 CH account lazily and may claim eligible bonuses again.

The prerequisite guards return 404 for table creation and quick-seat whenever CHIPS_ENABLED is not exactly 1. Monitoring adds one read-only aggregate query whenever Admin/Ops is loaded or refreshed.

## 11. Ubuntu VPS copy/paste checklist — stage preflight only

Run this block from the repository root. It contains placeholders and prompts, not real secrets or project refs. It performs only tool installation/checks and the read-only SQL preflight; it does not enter maintenance.

    if ! command -v psql >/dev/null 2>&1; then
      sudo apt update
      sudo apt install -y postgresql-client
    fi
    psql --version || { echo 'STOP: psql unavailable' >&2; exit 1; }
    node --version || { echo 'STOP: node unavailable' >&2; exit 1; }
    test -f supabase/manual/chips-economy-test-reset.sql || { echo 'STOP: reset SQL missing' >&2; exit 1; }
    test -r supabase/manual/chips-economy-test-reset.sql || { echo 'STOP: reset SQL unreadable' >&2; exit 1; }

    (
      set +o history
      set -o pipefail
      umask 077
      export RESET_TARGET=stage

      read -rsp 'Stage PostgreSQL direct/session-pooler URI: ' SUPABASE_STAGE_DB_URL
      printf '\n'
      export SUPABASE_STAGE_DB_URL
      read -rp 'Expected stage Supabase project ref: ' EXPECTED_SUPABASE_PROJECT_REF
      export EXPECTED_SUPABASE_PROJECT_REF

      ACTUAL_SUPABASE_PROJECT_REF="$(node -e 'const u=new URL(process.env.SUPABASE_STAGE_DB_URL); const host=/^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(u.hostname); const user=/^postgres\.([a-z0-9-]+)$/i.exec(decodeURIComponent(u.username||"")); const ref=(host&&host[1])||(user&&user[1])||""; if(!ref) process.exit(2); process.stdout.write(ref);')"
      if [ "$ACTUAL_SUPABASE_PROJECT_REF" != "$EXPECTED_SUPABASE_PROJECT_REF" ]; then
        echo 'STOP: project ref mismatch; no database command was run.' >&2
        exit 1
      fi
      printf 'Project ref verified: %s\n' "$ACTUAL_SUPABASE_PROJECT_REF"

      psql "$SUPABASE_STAGE_DB_URL" -X \
        -v ON_ERROR_STOP=1 \
        -v reset_target=stage \
        -v expected_project_ref="$EXPECTED_SUPABASE_PROJECT_REF" \
        -v reset_apply=0 \
        -f supabase/manual/chips-economy-test-reset.sql \
        2>&1 | tee stage-ch-reset-preflight.txt
      PREFLIGHT_EXIT=${PIPESTATUS[0]}
      printf 'Preflight exit code: %s\n' "$PREFLIGHT_EXIT"
      chmod 600 stage-ch-reset-preflight.txt

      if [ "$PREFLIGHT_EXIT" -ne 0 ]; then
        echo 'STOP: preflight failed; do not enter maintenance.' >&2
        exit 1
      fi
      if ! grep -Fq 'PRE-FLIGHT ONLY. No rows or schema objects were modified.' stage-ch-reset-preflight.txt; then
        echo 'STOP: success marker missing; do not enter maintenance.' >&2
        exit 1
      fi
      echo 'READ-ONLY STAGE PREFLIGHT PASSED. Stop and submit the protected output for review.'
    )

Expected success evidence:

    PRE-FLIGHT ONLY. No rows or schema objects were modified.
    Preflight exit code: 0
    READ-ONLY STAGE PREFLIGHT PASSED. Stop and submit the protected output for review.

After review, either move the protected output outside the repository or delete it:

    chmod 600 stage-ch-reset-preflight.txt
    mv stage-ch-reset-preflight.txt '<approved-private-directory>/'

or:

    rm -f stage-ch-reset-preflight.txt

Stop after this checklist. Do not set `CHIPS_ENABLED=0`, change Network Restrictions, stop WS, run `pg_dump` or execute reset apply until the preflight output has been reviewed and the next maintenance step is explicitly authorized.

## 12. Ubuntu VPS copy/paste checklist — resume approved stage maintenance

Use this only after the SQL preflight and section 4.1 Admin maintenance checklist have both been accepted. It intentionally stops after applying and verifying the VPS-only restriction; backup and reset remain separate, explicit steps.

    (
      set +o history
      set -Eeuo pipefail
      umask 077
      export RESET_TARGET=stage

      read -rsp 'Stage PostgreSQL direct/session-pooler URI: ' SUPABASE_STAGE_DB_URL
      printf '\n'
      export SUPABASE_STAGE_DB_URL
      read -rp 'Expected stage Supabase project ref: ' EXPECTED_SUPABASE_PROJECT_REF
      export EXPECTED_SUPABASE_PROJECT_REF

      ACTUAL_SUPABASE_PROJECT_REF="$(node -e 'const u=new URL(process.env.SUPABASE_STAGE_DB_URL); const host=/^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(u.hostname); const user=/^postgres\.([a-z0-9-]+)$/i.exec(decodeURIComponent(u.username||"")); const ref=(host&&host[1])||(user&&user[1])||""; if(!ref) process.exit(2); process.stdout.write(ref);')"
      test "$ACTUAL_SUPABASE_PROJECT_REF" = "$EXPECTED_SUPABASE_PROJECT_REF" || {
        echo 'STOP: project ref mismatch.' >&2
        exit 1
      }
      export SUPABASE_PROJECT_REF="$ACTUAL_SUPABASE_PROJECT_REF"

      read -rp 'Current VPS public IPv4 host CIDR (x.x.x.x/32): ' VPS_IPV4_CIDR
      export VPS_IPV4_CIDR
      read -rp 'Current VPS public IPv6 host CIDR (address/128, blank if unavailable): ' VPS_IPV6_CIDR
      export VPS_IPV6_CIDR

      sudo systemctl stop ws-server-preview.service
      test "$(systemctl is-active ws-server-preview.service || true)" = inactive

      scripts/ops/stage-network-maintenance.sh preflight
      scripts/ops/stage-network-maintenance.sh restrict
      scripts/ops/stage-network-maintenance.sh status
      psql "$SUPABASE_STAGE_DB_URL" -X -v ON_ERROR_STOP=1 -c 'select 1;'

      echo 'STAGE NETWORK GATE PASSED. Stop here and review status before backup/reset.'
    )

Required evidence before backup:

    NETWORK PREFLIGHT PASSED.
    NETWORK RESTRICTION APPLIED.
    "status": "applied"
    "mode": "restricted-to-vps"
    STAGE NETWORK GATE PASSED. Stop here and review status before backup/reset.

If any command fails, do not run backup or reset. Keep WS stopped. If `preflight` created a recovery file, run `restore` with the same target variables or use the Dashboard emergency path from section 8. After the operation, clear secrets and targeting variables:

    unset SUPABASE_STAGE_DB_URL SUPABASE_ACCESS_TOKEN EXPECTED_SUPABASE_PROJECT_REF SUPABASE_PROJECT_REF RESET_TARGET VPS_IPV4_CIDR VPS_IPV6_CIDR
    set -o history
