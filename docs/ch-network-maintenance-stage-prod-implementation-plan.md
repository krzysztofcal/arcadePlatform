# CH economy Network Restrictions — stage/prod implementation plan

Status: planning only. This document does not authorize changing Network Restrictions, stopping services, deploying maintenance configuration, backing up, or resetting stage/production.

## 1. Goal and decision

Replace the production `Disable Project` step with the same database-boundary maintenance model already proven on stage, while keeping one small operator implementation for both environments.

The implementation will generalize the existing stage script rather than create a second copy:

- one script with explicit `RESET_TARGET=stage|prod`;
- the same `preflight`, `restrict`, `status`, `restore`, and `cancel` commands;
- exact target-to-project and target-to-WS-service binding;
- separate recovery evidence for stage and production;
- no automatic restore and no application-runtime changes.

Network Restrictions provide the hard gate for direct PostgreSQL and pooler traffic. They do not disable Supabase Auth, Storage, PostgREST, or other HTTPS APIs. This is acceptable for the CH reset because the current writers for `chips_*`, `bonus_claims`, and poker persistence use `SUPABASE_DB_URL`; the maintenance deploy and writer freeze remain required defense-in-depth.

## 2. Current architecture and findings

### 2.1 Existing operator script

File: `scripts/ops/stage-network-maintenance.sh`.

Current functions to preserve and generalize:

- `validate_target()`;
- `acquire_lock()`;
- `verify_cli_version()`;
- `verify_vps_cidrs()`;
- `validate_network_response()`;
- `get_network_response()`;
- `canonical_config()` / `configs_equal()`;
- `write_recovery_file()` / `read_recovery_config()`;
- `apply_config()` / `wait_for_config()`;
- `require_ws_inactive()`;
- `command_preflight()`;
- `command_restrict()`;
- `command_status()`;
- `command_restore()`.

The script already has the correct safety properties:

- pinned Supabase CLI `2.109.1`;
- `set -Eeuo pipefail` and `umask 077`;
- atomic recovery-file write with mode `600`;
- exact IPv4/IPv6 comparison;
- no `--append`;
- polling until the API reports the expected applied configuration;
- no overwrite of unresolved recovery evidence;
- local `flock`;
- no `EXIT` trap that could restore the wrong configuration;
- `restrict` and `restore` require WS to be inactive.

It is not safe for production as written:

- `validate_target()` accepts only `stage`;
- recovery and lock names are stage-specific;
- `require_ws_inactive()` checks `ws-server-preview.service`;
- output messages claim stage even when the supplied project ref could be different;
- it refuses an initially unrestricted project, so it cannot deterministically restore every valid production starting state.

### 2.2 Current database writers

Files and paths reviewed:

- `netlify/functions/_shared/supabase-admin.mjs`: Netlify SQL client from `SUPABASE_DB_URL`;
- `netlify/functions/_shared/chips-ledger.mjs`: CH accounts, transactions, and entries;
- `netlify/functions/_shared/bonus-campaigns.mjs` and `bonus-campaigns-scheduled.mjs`: bonus claims/campaign state;
- `netlify/functions/_shared/poker-table-init.mjs`, `poker-create-table.mjs`, and `poker-quick-seat.mjs`: table creation and seating;
- `ws-server/poker/bootstrap/persisted-bootstrap-db.mjs` and persistence adapters: authoritative poker state and ledger writes;
- `ws-server/server.mjs`: live poker lifecycle writes;
- `.github/workflows/ws-server-deploy.yml`: production WS restart path;
- `.github/workflows/nightly-poker.yml`: manually triggered production E2E path.

All writes in the reset scope use direct PostgreSQL/pooler access. Supabase HTTPS calls in the repository are for Auth verification/admin reads, Storage/avatar operations, and unrelated services. No current PostgREST or `supabase-js` path writes `chips_accounts`, `chips_transactions`, `chips_entries`, `bonus_claims`, or poker tables.

Production WS runs on the same VPS that will be allowlisted. Network Restrictions therefore cannot stop it. `ws-server.service` must be inactive before production `restrict` and remain inactive through `restore`.

### 2.3 Operational equivalence

Keeping Netlify online is equivalent to `Disable Project` for the reset database only when all gates hold:

1. a fresh production deploy has `CHIPS_ENABLED=0`;
2. mutating Netlify endpoints return controlled `404`;
3. production WS and every same-VPS database writer are stopped;
4. merges, deploy workflows, migrations, SQL Editor operations, scheduled/manual poker runs, and admin mutations are frozen;
5. production Postgres and pooler allow only the verified operator VPS CIDRs.

It is intentionally not a full application outage. Auth, Storage, and HTTPS APIs remain online. No implementation task may describe Network Restrictions as blocking those APIs.

## 3. Implementation tasks

### Task 1 — Rename and generalize the operator script

Files:

- rename `scripts/ops/stage-network-maintenance.sh` to `scripts/ops/ch-economy-network-maintenance.sh`;
- update every repository reference to the old path.

Properties:

- keep commands `preflight|restrict|status|restore` and add `cancel` for a captured read-only preflight that will not proceed to restriction;
- require `RESET_TARGET` to be exactly `stage` or `prod`;
- derive immutable target configuration once, immediately after validation:
  - stage database input: `SUPABASE_STAGE_DB_URL`;
  - stage independently sourced identity: `EXPECTED_SUPABASE_STAGE_PROJECT_REF`;
  - production database input: `SUPABASE_PROD_DB_URL`;
  - production independently sourced identity: `EXPECTED_SUPABASE_PROD_PROJECT_REF`;
  - stage WS service: `ws-server-preview.service`;
  - prod WS service: `ws-server.service`;
  - target label used in every message and recovery record;
- select the database URL and expected project ref internally from this fixed mapping; do not accept generic `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`, or `EXPECTED_SUPABASE_PROJECT_REF` as target-selection inputs;
- do not accept an operator-provided service name in normal execution;
- retain test-only command injection only where required by the existing test pattern.

`validate_target()` must require:

- the target-specific database URL and expected project ref selected above;
- a project ref derived by the script from the selected database URL;
- exact equality between that derived ref and the selected target-specific expected ref, plus the existing project-ref format check;
- both expected refs to be present and different, so the script has an independent anti-cross reference for each environment;
- the selected ref to differ from the opposite environment's expected ref; `RESET_TARGET=prod` with a stage DB URL and matching stage ref must fail, as must the inverse;
- a production-only confirmation value bound to the project ref for `restrict`, for example `NETWORK_MAINTENANCE_CONFIRM=RESTRICT_PROD_<project-ref>`;
- no production confirmation requirement for read-only `status` or emergency `restore` after valid recovery evidence has been loaded.

The production confirmation is an operator-intent guard, not a substitute for the target-specific mapping or anti-cross validation.

### Task 2 — Isolate recovery evidence and serialization

Functions:

- `acquire_lock()`;
- `write_recovery_file()`;
- `read_recovery_config()`;
- `archive_recovery_file()`.

Required model:

- one global maintenance lock, e.g. `ch-economy-network-maintenance.lock`, preventing concurrent stage/prod commands;
- target-specific recovery files:
  - `stage-network-restrictions.json`;
  - `prod-network-restrictions.json`;
- recovery schema includes `schemaVersion`, `target`, `projectRef`, `capturedAt`, pinned CLI version, prior restriction mode, and exact IPv4/IPv6 arrays;
- recovery schema includes `phase`, initially `captured` and changed atomically to `restricted` only after exact VPS-only convergence has been verified;
- reading recovery requires exact match of both `target` and `projectRef`;
- stage recovery can never authorize production restore, and vice versa;
- `preflight` refuses to create a new recovery file while either target has unresolved recovery evidence;
- restored evidence is archived with target and UTC timestamp and remains mode `600`.

The single lock is a deliberate change from independent target locks. It serializes stage and production maintenance even though their recovery files remain target-specific. This is intentionally stricter: one operator host cannot capture, restrict, cancel, or restore one environment while another environment has an unresolved operation, reducing cross-target mistakes and recovery-file races at the cost of forbidding otherwise independent concurrent maintenance.

`command_cancel()` is the only supported way to resolve a read-only preflight that will not continue:

1. acquire the same global lock and load target-bound recovery;
2. require `phase: captured`; `phase: restricted` must fail and instruct the operator to use `restore`;
3. read the current restrictions from the Management API without issuing an update;
4. require an exact semantic match with the captured IPv4/IPv6 arrays and prior mode;
5. archive the recovery record only after that equality check passes.

`cancel` must fail closed and retain recovery if the response is unauthorized, malformed, transitional, or different. Manual deletion of a recovery file is never part of the normal runbook. `restore` handles only `phase: restricted`; this keeps cancellation provably read-only.

Do not introduce a database table, remote state store, or secret manager for this one-shot operator state.

### Task 3 — Support both restricted and initially unrestricted projects

Functions:

- `validate_network_response()`;
- `write_recovery_file()` / `read_recovery_config()`;
- `apply_config()`;
- `wait_for_config()`;
- `command_preflight()`;
- `command_restore()`.

The current stage script requires a non-empty applied configuration. The generic script must represent and restore both valid initial states:

- `restricted`: exact prior IPv4/IPv6 CIDR arrays;
- `unrestricted`: the official Supabase representation for no restrictions.

Implementation requirements:

- capture the API's status and arrays before mutation;
- never treat malformed, unauthorized, unknown, or transitional responses as unrestricted;
- use the official Supabase CLI contract for removing restrictions when restoring an unrestricted project (`0.0.0.0/0` and `::/0`, subject to verification against pinned CLI output);
- poll until the API reports the documented unrestricted semantics, not merely command success;
- for a previously restricted project, restore and compare the exact canonical arrays;
- fail closed if the pinned CLI/API response cannot distinguish the two modes.

No restore may be inferred from an absent recovery file.

### Task 4 — Preserve VPS-only restriction semantics

Functions:

- `verify_vps_cidrs()`;
- `restricted_config()`;
- `apply_config()`;
- `wait_for_config()`;
- `require_ws_inactive()`.

Requirements:

- verify detected public IPv4 equals the supplied `/32`;
- when supplied, verify IPv6 equals the supplied `/128` after normalized comparison;
- replace the complete allowed list without `--append`;
- require target-specific WS service to be `inactive` before `restrict` and `restore`;
- wait for exact VPS-only config and the documented applied status;
- include target and project ref in success output without printing credentials;
- retain the rule that the script never stops/starts services and never changes `CHIPS_ENABLED`.

For production, the runbook must additionally require a read-only inventory of same-VPS services/timers using the production DB URL. The generic script must not attempt to discover secrets from process environments.

### Task 5 — Update the reset runbook

File: `docs/ch-economy-reset-runbook.md`.

Replace stage-only command references with the generic script and add a production section. Production order:

1. independently verify production Supabase project ref and connection target;
2. freeze merges, Netlify production deploys, WS deploy workflow, migrations, SQL Editor, nightly/manual poker runs, and admin mutations;
3. set production `CHIPS_ENABLED=0` and produce a fresh production deploy;
4. verify Admin maintenance state and controlled `404` from all listed mutation endpoints;
5. confirm Supabase Dashboard emergency access;
6. stop `ws-server.service` and verify it is inactive;
7. verify no other same-VPS production DB writer is active;
8. run generic `preflight`, review protected recovery evidence, then `restrict` and `status` for `RESET_TARGET=prod`;
9. confirm operator `psql` still works and run the exact Netlify database-isolation probe defined below;
10. run PostgreSQL 17 backup, relative checksum verification, reset apply, and SQL assertions using the already reviewed reset contract;
11. run `restore` while WS remains stopped and verify the exact previous mode/configuration;
12. only after network restore, deploy production with `CHIPS_ENABLED=1`;
13. start `ws-server.service` after the deploy succeeds;
14. execute the production smoke and verify residual monitoring is green.

The runbook must retain separate stage and production confirmation tokens for the SQL reset. The network script does not authorize the SQL reset.

Failure paths:

- before SQL commit: keep production maintenance deploy active, WS stopped, and VPS-only restrictions in place until diagnosis or deliberate restore;
- after successful SQL commit but failed assertions/smoke: keep writers stopped and follow the verified PostgreSQL 17 backup-restore procedure;
- failed CLI restore: use the target-bound recovery JSON and Supabase Dashboard emergency procedure;
- never start Netlify writers or WS before restoration is independently verified.

Concrete Netlify isolation probe after `restrict`:

- use the already authenticated allowlisted administrator session against the active target Netlify deploy;
- send `GET /.netlify/functions/admin-ops-summary` with the normal `Authorization: Bearer <Supabase access token>` and allowed `Origin` headers;
- record that the same request returned HTTP `200` immediately before restriction;
- after VPS-only restriction, require HTTP `500` with the controlled body `{\"error\":\"server_error\"}` within the normal function timeout, because `loadOpsSummary()` performs direct PostgreSQL queries through `SUPABASE_DB_URL` while admin authorization continues through the unaffected Auth HTTPS API;
- HTTP `200`, a timeout, an auth response (`401`/`403`), malformed output, or any other result is not proof of database isolation and blocks reset apply.

This probe is read-only. It intentionally confirms that Netlify cannot reach Postgres; `admin-stage-identity` is not suitable because it reports sanitized configuration without querying the database, and `admin-ops-summary` must not be expected to remain usable during the network-restricted interval.

### Task 6 — Update architecture documentation

Files:

- `docs/ch-economy-reset-and-escrow-monitoring-plan.md`;
- `docs/ch-economy-reset-runbook.md`.

Update stale statements that production requires `Disable Project`. Document instead:

- Network Restrictions are the hard Postgres/pooler boundary for both targets;
- `CHIPS_ENABLED=0` remains required;
- production remains HTTP-accessible in maintenance mode;
- HTTPS Supabase APIs are explicitly outside the network gate;
- all environment-specific recovery and service gates remain separate.

Do not alter runtime application code, reset SQL, database schema, migrations, CSP, or environment-variable definitions.

## 4. Minimal regression tests

Add `tests/ch-economy-network-maintenance.behavior.test.mjs` and register it in `scripts/test-all.mjs`. Reuse Node's built-in test runner, temporary directories, and fake command executables; do not create a test framework or call the real Supabase Management API.

Required cases:

1. `RESET_TARGET=stage` binds only `ws-server-preview.service` and stage recovery evidence.
2. `RESET_TARGET=prod` binds only `ws-server.service` and prod recovery evidence.
3. unknown/missing target, missing target-specific input, malformed ref, or project-ref mismatch fails before any CLI update.
4. a DB-derived ref and expected ref that agree with each other but both belong to the opposite environment fail before any CLI update, for both stage-to-prod and prod-to-stage crossing.
5. production `restrict` fails without the exact project-bound confirmation.
6. `restrict` fails while the target WS service is active.
7. stage/prod recovery evidence cannot be crossed or overwritten.
8. the global lock prevents overlapping target operations and deliberately serializes stage and production.
9. `preflight` writes `phase: captured`; successful verified restriction changes it to `phase: restricted`.
10. `cancel` archives an unchanged `captured` recovery without an API update, while changed/malformed state or `phase: restricted` retains evidence and fails.
11. `restore` accepts `phase: restricted`, rejects `phase: captured`, and archives only after verified convergence.
12. exact IPv4/IPv6 replacement contains no `--append`.
13. restricted prior config is restored with semantically exact CIDR sets after canonical sorting.
14. unrestricted prior config is restored through the verified official CLI contract.
15. malformed/unauthorized/transitional CLI responses fail closed.
16. `status` reports target, project ref, API status, recovery phase, and one controlled mode without secrets.
17. restore timeout/failure retains the original recovery file.
18. repository docs contain no executable reference to the retired stage-only script.

Static tests may verify command construction, but state transitions must execute the shell script against fakes so quoting, files, permissions, locks, and exit statuses are exercised.

## 5. Manual verification and rollout

Implementation PR verification is non-mutating by default:

- syntax and existing repository checks;
- fake-CLI behavior tests for both targets;
- review of generated help text and target-specific paths;
- no stage/prod `restrict` or `restore` during CI.

Operator rollout after merge:

1. run `status`/`preflight` read-only against stage with the generic script;
2. compare captured stage evidence with the previously proven stage configuration;
3. run `cancel` to re-read and exactly match current restrictions, then archive `phase: captured` evidence without an API update if no stage maintenance is planned;
4. run production `status` and entitlement check read-only;
5. stop and review the production output before authorizing any production maintenance step;
6. production mutation follows only the updated runbook and a separately approved maintenance window.

Do not test production `restrict` merely to validate the implementation.

## 6. Acceptance criteria

- One operator script supports only explicit `stage|prod` targets.
- Target selects immutable target-specific DB URL/ref variables, project/service/recovery namespace, and cannot be overridden accidentally.
- Matching DB-derived and expected refs from the wrong environment are rejected independently of the production confirmation token.
- Production mutation requires an explicit project-bound confirmation.
- Exact previous restrictions, including unrestricted mode, can be restored deterministically.
- Recovery evidence from one environment is rejected by the other.
- Recovery phases distinguish captured preflight from applied restriction; unchanged preflight can be cancelled without an API update or manual file deletion.
- One intentional global lock serializes stage and production commands while recovery files remain target-specific.
- Both `restrict` and `restore` require the correct WS service to be inactive.
- The documented `admin-ops-summary` probe proves Netlify's direct PostgreSQL path is blocked before reset apply.
- The script never changes application ENV, deploys, starts/stops services, runs backup, or runs reset SQL.
- Runbook no longer requires Netlify `Disable Project` for production.
- Runbook still requires `CHIPS_ENABLED=0`, writer freeze, PostgreSQL 17 backup, exact reset marker, and restore-before-writers.
- Tests cover all critical target isolation and recovery invariants without cloud mutations.

## 7. Breaking impact

Operationally breaking:

- the stage-only script path is renamed;
- copied commands or private notes referencing `stage-network-maintenance.sh` must be updated;
- recovery schema gains a target/mode field and old unresolved recovery files require explicit operator review before using the new script;
- production reset procedure changes from whole-site disable to database Network Restrictions plus maintenance deploy.

Not breaking:

- no runtime application behavior changes;
- no DB migration or schema change;
- no new persistent ENV;
- no WS protocol, Netlify API, JSP, JavaScript, CSS, or CSP change;
- no automatic production action occurs after merge.

## 8. Explicitly out of scope

- executing stage or production maintenance;
- changing or running the CH reset SQL;
- automatic backup/restore;
- stopping or starting WS from the script;
- changing Netlify ENV or triggering deploys from the script;
- blocking Auth, Storage, or PostgREST;
- deleting historical deploys;
- adding a general feature-flag or maintenance framework;
- automatic residual remediation.

## 9. Owner-controlled decisions before production use

- confirm the independently sourced production project ref;
- confirm production Network Restrictions entitlement and current mode;
- approve the maintenance window and writer freeze;
- approve the exact production VPS IPv4/IPv6 CIDRs;
- verify Dashboard emergency restore access;
- approve protected recovery/backup storage locations;
- authorize production `restrict`, SQL reset, and later restore as separate hold points.

Plan verdict: implementation may proceed as one small operator-tooling PR. Production reset remains blocked until that implementation is merged, its tests are green, production read-only preflight is reviewed, and the owner explicitly authorizes each mutating maintenance phase.
