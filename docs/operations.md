# Operations and Configuration

This document preserves the operational and rollout details that were previously embedded in `README.md`.

## Server gates & debug
- XP auth uses the shared Supabase verifier, including remote verification for ES256 tokens. Keep `SUPABASE_URL`/`SUPABASE_URL_V2` and a server-side Supabase API key configured together; invalid supplied bearer tokens return `401` instead of mutating an anonymous XP identity.
- `calculate-xp.mjs` is the only XP award and status endpoint. It calculates grants from bounded semantic activity windows while enforcing session and Warsaw-local daily caps. The retired `award-xp` endpoint and its redirects have been removed.
  - Authenticated positive grants atomically maintain dark leaderboard projections under `<XP_KEY_NS>:leaderboard:v1:*`. Day and ISO-week projections follow the canonical 03:00 Warsaw XP reset, expire after their bounded retention windows, and are not yet publicly exposed. Guest awards do not write leaderboard members; conversion synchronizes all-time only.
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

## XP leaderboard maintenance

`/.netlify/functions/admin-xp-leaderboard-maintenance` is an admin-only, bounded repair endpoint. New accounts receive profiles from the database trigger and do not require routine profile-coverage runs. Requests default to dry-run, accept at most 50 accounts, use the configured `XP_KEY_NS`, and refuse unknown Supabase targets. A successful dry-run returns a signed `applyToken` valid for five minutes. The token is bound to the admin, Netlify deploy, target project, operation, page, offset, limit, and period; it cannot authorize a different request.

Prerequisites are existing runtime configuration only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, Upstash REST credentials, `XP_KEY_NS`, and `SUPABASE_STAGE_PROJECT_REF` on deploy previews. No database migration or new persistent environment variable is required.

The Netlify build writes its build-only `CONTEXT` into `netlify/functions/_generated/deploy-context.mjs` before Functions are bundled. This is required because Netlify does not guarantee that `CONTEXT` remains available in the Functions runtime. The maintenance target still requires matching Supabase URL, database, and service-role project references; the generated context alone cannot authorize a mismatched target.

Use an admin Supabase access token and the matching deploy URL. Start every operation without `apply`:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer <admin access token>" \
  -H "Content-Type: application/json" \
  https://<deploy>/.netlify/functions/admin-xp-leaderboard-maintenance \
  -d '{"operation":"profile_coverage","page":1,"limit":25}'
```

For each page, inspect the dry-run response and stop if `failed` is non-zero. Apply that exact page immediately with the returned token:

```json
{
  "operation": "profile_coverage",
  "page": 1,
  "limit": 25,
  "apply": true,
  "applyToken": "<token returned by this exact dry-run>"
}
```

Expired tokens, changed parameters, another admin, and another stage/production target return `409` before maintenance runs. After profile coverage completes, run `backfill` with the same dry-run-first and paged apply sequence. It reads canonical lifetime/current-day/current-week counters, sets non-zero sorted-set scores, removes stale zero scores, and refreshes bounded day/week TTLs. Re-running every page must converge to `updated: 0`, `removed: 0`, and only `unchanged` results.

Finally run `prune` separately for `all_time`, `today`, and `week`. It removes index members without an eligible visible public profile. Prune uses `offset`, not `page`; when an apply removes rows it returns the same `nextOffset` so shifted members are not skipped:

```json
{
  "operation": "prune",
  "period": "all_time",
  "offset": 0,
  "limit": 25,
  "apply": true,
  "applyToken": "<token returned by this exact prune dry-run>"
}
```

Stop on any non-zero `failed` count. The endpoint logs aggregate counts only and never logs user IDs or emails. Do not run production apply until the public API PR is deployed dark and stage backfill has been rerun successfully. Rollback consists of removing the derived `<XP_KEY_NS>:leaderboard:v1:*` sorted sets; never modify canonical `total` or `daily` XP keys.

## XP leaderboard reads

The leaderboard read layer has two endpoints with separate cache and authentication contracts:

```text
GET /.netlify/functions/xp-leaderboard?period=today|week|all_time&page=1&limit=25
GET /.netlify/functions/xp-leaderboard-me?period=today|week|all_time
```

The first endpoint is public, returns only allowlisted profile identity, rank, period XP, lifetime-derived level, and profile URL, and uses `no-store`. Fresh reads prevent a recently re-enabled owner from appearing in authenticated `me` while an older public page still omits them. It never includes `me` and never returns UUIDs, emails, bio, chips, ledger/session data, Redis keys, or avatar storage keys. Missing profiles produce a shorter deterministic raw page; the endpoint does not borrow members from the next page. `page` is capped at 20 and `limit` at 50.

The second endpoint requires `Authorization: Bearer <Supabase access token>`, returns only the matching public-safe row or `me: null`, and always uses `private, no-store`. Public and private results must not be merged into one cacheable response.

Deploy Previews enable these reads automatically unless `XP_LEADERBOARD_ENABLED=0` is explicitly set. Production stays unavailable by default; set `XP_LEADERBOARD_ENABLED=1` only after production profile coverage/backfill/prune and API smoke pass. Optional per-instance limits are `XP_LEADERBOARD_RATE_LIMIT_IP_PER_MIN` and `XP_LEADERBOARD_ME_RATE_LIMIT_IP_PER_MIN`, both defaulting to 60. No database migration is required.

Preview smoke requests:

```bash
curl -i 'https://<deploy-preview>/.netlify/functions/xp-leaderboard?period=all_time&page=1&limit=25'

curl -i \
  -H 'Authorization: Bearer <stage user access token>' \
  'https://<deploy-preview>/.netlify/functions/xp-leaderboard-me?period=all_time'
```

Repeat both requests for `today` and `week`. Confirm both public and `me` responses are `no-store`, ties use competition ranks, period levels use lifetime XP, and no private identifiers occur anywhere in response bodies. A Redis, canonical-lifetime, or profile read failure must return non-cacheable `503 leaderboard_unavailable`, never a successful empty ranking or fabricated level 1.

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
  - separate `supabaseUrlProjectRef` and `databaseProjectRef`
  - `databaseMatchesSupabaseProjectRef`
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

### Public profile avatar rollout

Avatar uploads require migration `20260711103000_profile_avatar_storage.sql`, `SUPABASE_URL` (or `SUPABASE_URL_V2`), `SUPABASE_SERVICE_ROLE_KEY`, and the normal authenticated profile configuration in the Netlify Functions scope. The service-role key is never returned to the browser; only a short-lived, path-scoped Storage upload URL is returned.

After the stage migration workflow succeeds, verify on the matching Deploy Preview:

1. Upload a JPEG, PNG, and WebP below 1 MB and 1024x1024; each public result must be a 256x256 WebP.
2. Confirm `/u/<handle>`, account UI, and topbar render the same stable public avatar URL.
3. Confirm the private original returns no public access and is deleted after finalization.
4. Reject SVG/GIF, files over 1 MB, dimensions over 1024x1024, expired upload IDs, and an upload ID owned by another user.
5. Restore the default avatar and confirm the processed object is removed and all profile surfaces return to `avatar_variant`.

Apply the same migration to production only after this stage smoke passes. A rollback may disable the avatar controls/functions, but should not drop `user_profiles.avatar_key`; existing public WebP objects remain harmless while the feature is disabled.

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
| `XP_SESSION_CAP` | `300` | Maximum XP per award session. The browser rotates to a fresh award session after reaching this ceiling, while the daily cap remains authoritative. |
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
