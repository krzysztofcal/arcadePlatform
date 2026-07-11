# Operations and Configuration

This document preserves the operational and rollout details that were previously embedded in `README.md`.

## Server gates & debug
- `award-xp.mjs` validates the JSON body, tolerates legacy `scoreDelta` / `pointsPerPeriod` fields, and enforces `XP_DELTA_CAP` plus the per-session (`XP_SESSION_CAP`) ceiling and the Warsaw-local daily (`XP_DAILY_CAP`, default 3000) window that runs from 03:00 to 03:00 (CET/CEST aware).
  - Every response surfaces Redis-sourced `totalToday`, `remaining`, `dayKey`, and `nextReset` (epoch ms of the next Warsaw reset). The signed `xp_day` cookie is rewritten on each call so stale or missing cookies self-heal automatically.
  - The cookie pre-clamps each award before Redis executes, so once the server reports `remaining: 0` the next calls immediately short-circuit until the advertised `nextReset`. Redis still tracks session/lifetime totals for analytics, and any session caps stack on top of the daily allowance.
  - The cookie is HttpOnly + SameSite=Lax, signed with `XP_DAILY_SECRET`, and its payload mirrors the response totals (`granted` equals the legacy `awarded` field but should be preferred going forward and `awarded` will be phased out in a future update). When `XP_COOKIE_SECURE=1`, the cookie is also marked Secure for HTTPS deployments.
  - `awarded` and `granted` are equal today; clients should migrate to `granted`.
  - Local Playwright runs inject `XP_DAILY_SECRET=test-secret` (and `XP_DEBUG=1`) so the preview server matches the production contract; set `XP_DAILY_SECRET` (32+ chars) when running the function manually to avoid `500 server_config/xp_daily_secret_missing`.
- Requests are rejected when the timestamp is stale (`status: "stale"`), another tab owns the lock (`status: "locked"`), metadata is malformed or oversized, or the optional activity guard blocks idle deltas.
- Flip `XP_REQUIRE_ACTIVITY=1` to require input and visibility thresholds (`XP_MIN_ACTIVITY_EVENTS`, `XP_MIN_ACTIVITY_VIS_S`). When disabled the function skips those checks entirely.
- Metadata must remain shallow: depth ≤ 3 and serialized size ≤ `XP_METADATA_MAX_BYTES` (default 2048 bytes). Larger payloads return `413 metadata_too_large` without mutating totals.
- Session keys refresh their TTL (`XP_SESSION_TTL_SEC`, default 7 days) whenever deltas are accepted or a zero-delta heartbeat advances `lastSync`, keeping Redis tidy.
- Enabling `XP_DEBUG=1` adds `{ delta, ts, lastSync, status, dailyCap, sessionCap }` to responses for diagnostics.

## Diagnostics logging
- The client recorder is available only to signed-in allowlisted admins. The About page verifies admin access through `/.netlify/functions/admin-me` before showing the **Dump diagnostics** button or allowing a dump to open/download.
- Once unlocked, the recorder auto-starts (`window.KLog.start(1)`) and the About page surfaces a **Dump diagnostics** button. Clicking it opens a new tab populated with the recent buffer (up to 1000 lines) and falls back to downloading `kcswh-diagnostic-<timestamp>.txt` when the popup is blocked.
- The buffer captures the XP lifecycle breadcrumbs (`xp_init`, `xp_start`, `xp_stop`, `block_no_host`, `block_hard_idle`, `award`) so you can confirm that accrual only happens on game hosts and is suppressed on idle or non-host pages. Check `window.KLog.status()` for the active level and line count.

## Stage DB identity check
- Netlify deploy previews must point at the stage Supabase project before DB migration automation is enabled.
- Configure these variables in Netlify for the `deploy-preview` context with stage values:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY_V2`
  - `SUPABASE_JWT_SECRET` or `SUPABASE_JWT_SECRET_V2`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_DB_URL`
  - `SUPABASE_STAGE_PROJECT_REF`
  - `CHIPS_ENABLED=1`
- `SUPABASE_STAGE_PROJECT_REF` is not a secret. It is the Supabase project ref used as the expected stage identity.
- Production keeps production Supabase values. Do not set production `SUPABASE_URL` or `SUPABASE_DB_URL` to stage.
- The admin-only endpoint `/.netlify/functions/admin-stage-identity` returns sanitized environment identity:
  - `environmentContext`
  - `supabaseProjectRef`
  - `expectedStageProjectRef`
  - `databaseTarget`
  - `chipsEnabled`
  - safe boolean config flags
- The endpoint never returns DB URLs, JWT secrets, anon keys, emails, or access tokens.
- Admin UI → Ops → Runtime / environment shows the same identity block.
- Manual preview verification:

```
curl -H "Authorization: Bearer <admin access token>" \
  https://<deploy-preview>.netlify.app/.netlify/functions/admin-stage-identity
```

Expected deploy-preview result:

```
"databaseTarget":"stage"
"stageProjectRefMatches":true
```

Expected production result:

```
"databaseTarget":"production"
```

## Stage DB migrations

Use the stage DB migration workflows before merging DB-heavy changes such as bonus campaigns.

Required GitHub repository secrets:

- `SUPABASE_STAGE_DB_URL` - stage Postgres connection string.
- `SUPABASE_STAGE_PROJECT_REF` - expected stage Supabase project ref.

The workflows refuse to run if the DB URL does not contain the expected stage project ref. They do not reset, drop, or roll back schemas.

AI agents should use the companion checklist in [`docs/ai-agent-db-migration-checklist.md`](ai-agent-db-migration-checklist.md) to decide when to remind users about these scripts and workflows.

### Daily developer workflow

Use this decision tree whenever a branch may touch database schema or seed data:

1. Check whether the branch changes migrations:

```bash
git fetch origin main
git diff --name-only origin/main...HEAD -- supabase/migrations
```

2. If there are no files listed, no stage DB migration action is needed. Run the normal tests for the code you changed.
3. If migration files are listed, run the local structural guard before pushing:

```bash
node scripts/check-db-migrations.mjs
```

4. Push the branch and wait for both PR checks:

```text
DB Migration Check
DB Stage Apply PR
```

5. Test the Netlify deploy preview only after `DB Stage Apply PR` is green, because the preview should be using the shared stage DB.

The local `stage-db-migrate.mjs` command requires stage secrets and a direct Postgres client, so in normal PR work you usually do not run it manually. Let GitHub Actions apply PR migrations to stage.

### Automatic PR stage apply

PRs that change `supabase/migrations/**` run:

```text
DB Migration Check
DB Stage Apply PR
```

Expected sequence:

1. `DB Migration Check` validates migration filenames/order.
2. `DB Stage Apply PR` applies pending migration files to the shared stage DB.
3. The workflow fails if stage contains migration versions that are not present in the PR checkout.
4. The workflow fails if the PR changes a migration version that stage already applied. In that case, create a new timestamped migration or reset/recreate stage before re-running.
5. After the check is green, test the matching Netlify deploy preview against stage.

Do not edit an already-applied migration file in place. If the SQL changed after stage applied it, the PR check will fail with:

```text
Stage already has this migration version; bump timestamp or reset/recreate stage.
```

The normal fix is to add a new migration with a fresh `YYYYMMDDHHMMSS` timestamp. Only reset/recreate stage when the owner intentionally wants to discard the shared stage DB state.

### Working across multiple PRs

The stage DB is shared. It can represent only one compatible migration history at a time.

Use this workflow:

1. For one DB-heavy PR, rely on `DB Stage Apply PR`.
2. When switching review/testing from PR A to PR B, check the `DB Stage Apply PR` result on PR B.
3. If PR B is green, stage is compatible with PR B.
4. If PR B fails because stage contains unrelated migration versions, stage still has migrations from another branch. Use manual prepare only when you intentionally want stage to target PR B:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<branch-or-sha-for-pr-b>
```

5. If manual prepare fails with unrelated versions, do not force apply more SQL. Decide whether to finish testing PR A first, reset/recreate stage, or move PR B onto a migration history compatible with stage.

Practical rule: while iterating on one migration PR, create new timestamped follow-up migrations instead of editing old files. When moving between unrelated migration PRs, expect the shared stage DB to need cleanup or recreation.

### Manual prepare stage

Use this when switching between DB-heavy branches or when a PR was rebased:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<branch-or-sha>
```

This applies pending migrations from the selected ref to shared stage and runs smoke checks. It fails safely if stage contains unrelated migrations from another branch.

### Script reference

- `node scripts/check-db-migrations.mjs`
  - Local and CI structural guard.
  - Validates migration filename format, duplicate versions, duplicate names, empty files, and CRLF line endings.
  - Safe to run any time; does not connect to a database.
- `node scripts/stage-db-migrate.mjs --apply`
  - GitHub Actions stage apply helper.
  - Requires `SUPABASE_STAGE_DB_URL`, `SUPABASE_STAGE_PROJECT_REF`, and `psql`.
  - Refuses non-stage targets and unrelated remote migration histories.
- `node scripts/stage-db-migrate.mjs --apply --changed-from origin/main`
  - PR-mode stage apply helper.
  - Also fails when a changed PR migration version already exists in stage.
  - Normally run by `DB Stage Apply PR`, not by developers locally.

### Promote tested migrations to production

After stage testing passes and the PR is merged:

1. Confirm the merged `main` contains the same migration files tested on stage.
2. Apply production migrations with the production DB connection method used by the owner. Prefer Supabase migration tooling so `supabase_migrations.schema_migrations` is recorded with the schema change, for example:

```bash
supabase db push --db-url "$SUPABASE_PROD_DB_URL"
```

Raw `psql -f supabase/migrations/<migration-file>.sql` is only acceptable if the same operation also records the migration version in `supabase_migrations.schema_migrations`; otherwise future automation can treat an already-applied production migration as pending.

3. Verify production smoke checks manually:

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 10;
select to_regclass('public.chips_accounts');
select to_regclass('public.chips_transactions');
select to_regclass('public.chips_entries');
```

For generic bonus work, additionally verify:

```sql
select to_regclass('public.bonus_campaigns');
select to_regclass('public.bonus_claims');
select to_regclass('public.bonus_campaign_eligible_users');
select enumlabel
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typname = 'chips_tx_type'
  and enumlabel = 'PROMO_BONUS';
```

Do not apply production migrations until the stage deploy preview and stage DB checks are green.

## Bonus campaign scheduler

`netlify/functions/bonus-campaigns-scheduled.mjs` runs every 5 minutes when `CHIPS_ENABLED=1`.

It updates only campaign status fields:

- `scheduled -> active` when `starts_at <= now()` and the campaign has not ended.
- `active -> ended` when `ends_at <= now()`.
- stale `scheduled -> ended` when a scheduled campaign's `ends_at` has already passed before activation.

The scheduler does not create claims, write ledger entries, or mutate campaign rules.

## P1.1 rollout & rollback
Operators rolling out the P1.1 XP bridge should stage the following environment toggles alongside their Netlify/Functions deployment:

| Variable | Suggested value | Purpose |
| --- | --- | --- |
| `XP_USE_SCORE` | `0` or `1` | Enables score-mode XP awarding for the new bridge. Leave at `0` during smoke tests, then flip to `1` when the rollout passes QA. |
| `XP_SCORE_TO_XP` | `1` | Conversion rate from accepted score deltas to XP. Increase gradually if the event feed under-counts awards. |
| `XP_MAX_XP_PER_WINDOW` | `10` | Caps XP per window in score mode to guard against spikes. Lower this temporarily if telemetry detects runaway grants. |
| `XP_SCORE_RATE_LIMIT_PER_MIN` | `10000` | Rolling per-minute ceiling for score deltas. Tighten to throttle abuse or loosen if a featured game legitimately needs more throughput. |
| `XP_SCORE_BURST_MAX` | `10000` | Single-window burst limit that stacks with the minute gate. Lowering this curbs short-lived spikes. |
| `XP_SCORE_MIN_EVENTS` | `4` | Minimum input count for a score-bearing window. Raise during investigations of scripted input farms. |
| `XP_SCORE_MIN_VIS_S` | `8` | Minimum focused play time (seconds) for score windows. Increase when you need longer engagement before XP accrues. |
| `XP_DEBUG` / `XP_SCORE_DEBUG_TRACE` | `0` or `1` | Surface debug payloads during staged rollouts. Enable during P1.1 validation, disable once the bridge stabilizes to reduce response size. |

> **Tip:** Environment variables are strings—use plain integers such as `10000` when setting ceilings so the server parser can coerce them cleanly.

**Rollback plan:**
1. Immediately set `XP_USE_SCORE=0` and redeploy the function—this forces the bridge back to time-based awards while keeping the new client live.
2. If issues persist, redeploy the previous stable function build (tagged prior to P1.1) and run `npm run wire:xp` against that commit to ensure the HTML snippet matches.
3. Disable the badge entry point for the affected game(s) or temporarily remove the inline `GameXpBridge.auto()` snippet to halt client-side sends while you investigate. If you must ship that change, commit with `[guard-skip]` in the message (the bridge guard will fail otherwise) and revert as soon as the incident ends.
4. Re-run `npm run check:games-xp-hook` before re-enabling to confirm the guard is satisfied and the rollback did not leave partial bridge markup behind.

Document every toggle change in your incident timeline—the bridge guard expects the environment to match the table above when P1.1 resumes.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `XP_DEBUG` | `0` | Include the `debug` object in responses for easier staging diagnostics. |
| `XP_DAILY_CAP` | `3000` | Maximum XP a user can gain per Warsaw local day (03:00–03:00 CET/CEST). |
| `XP_SESSION_CAP` | value of `XP_DAILY_CAP` (default `3000`) | Maximum XP a single page/game session can accumulate. Set it explicitly only when a lower per-session ceiling is intentional. |
| `XP_DELTA_CAP` | `300` | Largest delta accepted from the client in a single request. |
| `XP_LOCK_TTL_MS` | `3000` | Duration of the per-session Redis lock that guards concurrent writes. |
| `XP_SESSION_TTL_SEC` | `604800` | TTL (seconds) for session counters; refreshed on each award/heartbeat to curb key bloat. |
| `XP_DRIFT_MS` | `30000` | Maximum allowed future drift for client `ts`. Requests beyond this tolerance are rejected. |
| `XP_REQUIRE_ACTIVITY` | `0` | When `1`, enforce minimum input/visibility thresholds before awarding XP. |
| `XP_MIN_ACTIVITY_EVENTS` | `4` | Minimum `metadata.inputEvents` required when `XP_REQUIRE_ACTIVITY=1`. |
| `XP_MIN_ACTIVITY_VIS_S` | `8` | Minimum `metadata.visibilitySeconds` required when `XP_REQUIRE_ACTIVITY=1`. |
| `XP_METADATA_MAX_BYTES` | `2048` | Maximum serialized metadata size; larger payloads return `413 metadata_too_large`. |
| `XP_DAILY_SECRET` | _(required)_ | 32+ character HMAC secret used to sign the `xp_day` cookie. |

Set these variables in tandem so the client and server agree on throughput; the server enforces the cap and surfaces `capDelta` so clients can mirror it without redeploying.

## Server Session Enforcement (Production)
Server-side session validation prevents session hijacking and token forgery attacks. Roll out in two phases:

| Variable | Phase | Purpose |
| --- | --- | --- |
| `XP_SERVER_SESSION_WARN_MODE` | Monitoring | Set to `1` to log session validation failures without blocking requests. Use this to identify legitimate clients that may not be sending tokens correctly. |
| `XP_REQUIRE_SERVER_SESSION` | Enforcement | Set to `1` to reject requests without valid session tokens (returns 401). Only enable after warn mode shows minimal false positives. |

**Rollout procedure:**
1. **Phase 1 - Monitoring:** Set `XP_SERVER_SESSION_WARN_MODE=1` in Netlify environment variables. Monitor function logs for `[XP] Session validation failed (warn mode)` entries. Review any patterns of legitimate failures.
2. **Phase 2 - Enforcement:** Once satisfied that clients are correctly sending session tokens:
   - Set `XP_SERVER_SESSION_WARN_MODE=0`
   - Set `XP_REQUIRE_SERVER_SESSION=1`
3. **Rollback:** If enforcement causes issues, immediately set `XP_REQUIRE_SERVER_SESSION=0` and re-enable warn mode while investigating.

**Session validation checks:**
- HMAC signature verification on session tokens
- User ID matches token claims
- Browser fingerprint matches (anti-hijacking)
- Session exists and is valid in Redis

See `netlify.toml` for the complete environment variable reference.
