# Poker deployment notes

## Funds safety invariant

Poker funds must always have a deterministic path back to the user. Each buy-in
moves chips from USER → ESCROW using `TABLE_BUY_IN`, and each leave/timeout must
cash those chips back from ESCROW → USER using `TABLE_CASH_OUT`.

Stack authority:
- Authoritative (active gameplay): `poker_state.state.stacks`.
- Authoritative (seat snapshot): `public.poker_seats.stack`.
- Gameplay decisions use `poker_state.state.stacks`; `public.poker_seats.stack` is the persisted snapshot for join/lobby/seat validation and recovery/reconciliation starting state.
- `public.poker_seats.stack` must never be NULL after a successful join.

Stack synchronization is required at lifecycle boundaries:
- successful join
- hand end / settlement
- leave / cash-out

If both stack stores are present, `poker_state.state.stacks` drives gameplay
decisions and `public.poker_seats.stack` must not contradict funds-safety
outcomes. This prevents stranded escrow balances and avoids gameplay issues such
as "stack = 0" with no legal actions.

## Retired HTTP gameplay endpoints

HTTP gameplay endpoints are intentionally retired and return `410 Gone`:
- `/.netlify/functions/poker-join`
- `/.netlify/functions/poker-heartbeat`
- `/.netlify/functions/poker-get-table`
- `/.netlify/functions/poker-start-hand`
- `/.netlify/functions/poker-act`
- `/.netlify/functions/poker-leave`
- `/.netlify/functions/poker-sweep`

There is no scheduled HTTP sweep. Gameplay cleanup is owned exclusively by the WS runtime through `runTableJanitor()` and the serialized inactive-cleanup primitives. The retained `poker-sweep` function is a compatibility tombstone only and must remain non-authoritative.


## Poker Bots (Phase 1)

Runtime config should be read in code via `process.env.*` (WS server runtime and supporting functions).

Authoritative behavior reference: `docs/poker-bots.md`.

Set these as Netlify environment variables (Site settings -> Environment variables):

- `POKER_BOTS_ENABLED` (`0`/`1`)
- `POKER_BOTS_MAX_PER_TABLE` (default: `2`)
- `POKER_BOT_PROFILE_DEFAULT` (default: `TRIVIAL`)
- `POKER_BOT_BANKROLL_SYSTEM_KEY` (default now: `TREASURY`; optional later: `POKER_BOT_BANKROLL`)
- Optional later: `POKER_BOTS_MAX_ACTIONS_PER_POLL`
- `POKER_BUY_IN_TIERS_JSON` (shared ordered buy-in tier catalog; omitted uses the built-in catalog)

Operational notes:
- Before production rollout, run a read-only preflight for every active table's `buy_in` + `stakes` pair. List the complete set with:

  ```sql
  select id, buy_in, stakes, lifecycle_kind, managed_profile_key
  from public.poker_tables
  where status <> 'CLOSED'
  order by buy_in, id;
  ```

  Then run this mismatch query and stop the rollout if it returns any row:

  ```sql
  with expected as (
    select id, buy_in, stakes, lifecycle_kind, managed_profile_key,
      greatest(2, round(buy_in::numeric / 50))::bigint as expected_bb
    from public.poker_tables
    where status <> 'CLOSED'
  ), normalized as (
    select id, buy_in, stakes, lifecycle_kind, managed_profile_key,
      greatest(1, floor(expected_bb / 2))::bigint as expected_sb,
      expected_bb,
      case when jsonb_typeof(stakes) = 'object' and stakes->>'sb' ~ '^[0-9]+$'
        then (stakes->>'sb')::bigint end as actual_sb,
      case when jsonb_typeof(stakes) = 'object' and stakes->>'bb' ~ '^[0-9]+$'
        then (stakes->>'bb')::bigint end as actual_bb
    from expected
  )
  select id, buy_in, stakes,
    jsonb_build_object('sb', expected_sb, 'bb', expected_bb) as canonical_stakes
  from normalized
  where actual_sb is distinct from expected_sb
     or actual_bb is distinct from expected_bb;
  ```

  Every returned pair must be repaired or the table lifecycle must be consciously resolved before enabling enforcement. Also verify that no active bot seat remains on a non-default tier:

  ```sql
  select t.id, t.buy_in, t.stakes, t.lifecycle_kind, t.managed_profile_key,
    count(*) filter (where s.status = 'ACTIVE' and s.is_bot = true) as active_bot_seats
  from public.poker_tables t
  left join public.poker_seats s on s.table_id = t.id
  where t.status <> 'CLOSED'
  group by t.id, t.buy_in, t.stakes, t.lifecycle_kind, t.managed_profile_key
  having t.buy_in <> 100
     and count(*) filter (where s.status = 'ACTIVE' and s.is_bot = true) > 0
  order by t.buy_in, t.id;
  ```

  Stop the rollout if this query returns a row. Resolve each table through the existing graceful retirement/terminal cleanup path at a settled boundary, without changing table state, stakes, stacks, or ledgers with direct SQL; continue only after the table is closed and its escrow is `0`. Do not interrupt a table with an active human hand.

  Then verify the continuous-table profile remains canonical:

  ```sql
  select profile_key, small_blind, big_blind
  from public.poker_managed_table_profiles
  where profile_key = 'CONTINUOUS_BOT_DEFAULT';
  ```

  It must be `1/2`. The configured catalog must include every active table `buy_in` and `100` CH while continuous tables use their fixed `100` CH buy-in; values must fit the PostgreSQL `integer` range and generate blinds no larger than `1,000,000` CH.
- Roll out the Netlify and WS revisions together; run the non-default-tier smoke only after both revisions report the same release SHA.
- Bot runtime is guarded by `POKER_BOTS_ENABLED`.
- Initial humans and manual rebuys use the table's persisted `buy_in` value. Initial bot seed funding, replacement funding, and managed top-ups remain temporarily allowed only for the authoritative `100` CH tier; higher tiers are human-only. The retired `POKER_BOT_BUYIN_BB` setting is ignored so table stakes or bot-only configuration cannot make stacks diverge from the table buy-in.
- Values above are Netlify runtime config env vars (not secrets unless explicitly sensitive).
- Bot/gameplay orchestration runs server-side in WS runtime (no client-side bot scripts).
- Bot replacement funding continues to use the existing configured source (default `TREASURY`); the runtime path adds no account, environment variable, balance move, or manual replenishment step. The separate managed-profile correction migration only restores `CONTINUOUS_BOT_DEFAULT` to canonical `1/2` blinds and preserves its other settings.
- Replacement funding is an internal `SYSTEM -> ESCROW` transaction with `created_by = NULL` and closed bot/replacement metadata. It does not depend on `POKER_SYSTEM_ACTOR_USER_ID`. Terminal bot cash-out resolves the destination SYSTEM account from that actual funding provenance instead of using an actor identity or creating a USER account for the bot UUID.
- A replacement funding failure leaves the table in `SETTLED`, retries with bounded fast backoff, then retries at most once per minute until the same generation succeeds or changes. Monitor `ws_settled_rollover_persist_failed` for the controlled reason, requested replacement count, and total delta.

### Local development

- Local `.env` is supported for development only (gitignored, never committed).
- Deployed environments should use Netlify environment variables.
- Keep naming consistent between docs and code: Netlify environment variables read through `process.env`.

## Acceptance

### Browser acceptance (primary)

1. Open the poker table page.
2. Open DevTools console (or your KLog collector).
3. Click Leave.
4. You must see, in order:
   - `poker_leave_bind` with `found:true`
   - `poker_leave_click`
   - `poker_leave_request`
   - then either:
     - `poker_leave_response` (non-pending) + UI updates, or
     - `poker_leave_response` pending + retry logs + eventual terminal result, or
     - `poker_leave_click_error` with a visible UI error

### HTTP gameplay endpoint retirement check

Gameplay HTTP endpoints are intentionally non-authoritative and must return `410 Gone`:
- `/.netlify/functions/poker-join`
- `/.netlify/functions/poker-start-hand`
- `/.netlify/functions/poker-act`
- `/.netlify/functions/poker-leave`
- `/.netlify/functions/poker-sweep`

### Optional CSP check (only if client logs show request but server logs are empty)

Run these from Termux (or anywhere) and confirm headers look sane:

```sh
# Poker page CSP (should allow self scripts)
curl -sSI "https://play.kcswh.pl/poker/" | sed -n '1,120p' | grep -iE 'content-security-policy|x-content-type-options|x-frame-options'

# Legacy gameplay endpoint should be retired (410)
curl -sSI "https://play.kcswh.pl/.netlify/functions/poker-leave" | sed -n '1,120p'
```

What you’re looking for:
- CSP should have `script-src 'self' ...` (or no CSP at all).
- If you use nonces/hashes and inline scripts, CSP must allow them; otherwise the poker JS may not run.
- For network calls, CSP uses `connect-src`. It should include `'self'` (or explicitly `https://play.kcswh.pl`).

## WS preview deploy

The preview WS deploy is manual-only and isolated from the production WS workflows.
It targets only the preview host, preview filesystem root, preview service, preview env file, and preview health checks.
It does not manage Caddy.
The host is a single shared preview runtime, so automatic deployment from every PR is intentionally disabled: concurrent PRs would overwrite each other and a Netlify preview could silently use another branch's backend.

Changes to bot replacement funding touch the authoritative WS runtime and therefore require a manual WS preview deploy before stage acceptance. Verify a replacement with old stack `0` or `1`, then confirm the next hand starts and the table escrow increased by exactly the funded delta. A Netlify deploy preview alone is not sufficient for this server-side path.

Terminal bot cash-out also requires a manual WS preview deploy. Test it only with a newly created preview table: allow at least one bot replacement, close the table through the terminal inactive-cleanup path, and verify that every positive final bot stack moves from table ESCROW to the exact SYSTEM account proven by its seed/replacement ledger lineage. A successful close must leave the escrow balance at `0`; repeating cleanup must not create another transfer. Missing or mixed provenance, a mismatch between authoritative claims and escrow, or any non-zero post-cash-out escrow must return `terminal_accounting_invariant_failed` and leave table accounting and lifecycle state unchanged.

## Continuous bot tables (foundation)

Continuous bot tables are controlled by the single database profile
`public.poker_managed_table_profiles.profile_key = 'CONTINUOUS_BOT_DEFAULT'`.
The migration seeds it disabled with `desired_table_count = 0`; deployment alone
does not create a table. There are no continuous-table ENV settings.

Production supports at most two six-seat tables; Preview allows up to 100 so a
reviewed Stage profile can run five non-stop tables. Profile constraints and
runtime validation bound desired count, bot counts, stakes and timing values.
The supervisor polls the profile, serializes create/retire decisions with a
database advisory transaction lock and retains the last valid profile across a
transient read failure. Only a successfully read disabled/zero profile requests
graceful retirement.

Initial managed bots and settled-boundary top-ups use the established internal
`SYSTEM -> ESCROW` funding shape with `created_by = NULL`. The actual SYSTEM
account and immutable ledger entries are the funding authority. Do not create a
technical USER actor and do not pass bot identities through human join, leave or
rebuy contracts.

Preview rollout:

1. Apply `20260729100000_poker_managed_table_profiles.sql` and
   `20260809224000_poker_managed_table_profiles_canonical_stakes.sql` to stage.
2. Deploy the exact PR SHA with manual `WS Preview Deploy`.
3. Verify release metadata, `ws_artifact_start`, local/public `/healthz` and no supervisor failure.
4. Confirm `CONTINUOUS_BOT_DEFAULT` has canonical `small_blind = 1`,
   `big_blind = 2`; set Preview to `enabled = true`,
   `desired_table_count = 5` through the existing maintenance operation.
5. Verify exactly five `CONTINUOUS_BOT` tables, each with `buy_in = 100`,
   `1/2` stakes, three initial bots, one escrow account, three seed funding
   transactions and a playable persisted hand. Production remains capped at two.
6. Join as a real player through normal quick-seat/direct join; verify actions, settlement, reconnect, rebuy and leave.
7. Verify settled rollover, bot replacement/top-up idempotency and absence of accounting/persistence failures.
8. **Rollback only:** if the preview service must be disabled, set the valid profile to
   `enabled = false`, `desired_table_count = 0`; verify the tables wait for
   `SETTLED`, never remove a human, then close once through terminal accounting
   with escrow `0`. A completed rollout must leave the profile
   `enabled = true`, `desired_table_count = 5`; do not execute this rollback step
   as part of normal Preview operation.

Do not change stakes or `max_seats` on an active production profile without
expecting graceful retirement. Existing tables keep their persisted stakes and
capacity; replacements use the new construction values.
Repo-side Caddy ownership is unified: `infra/vps/Caddyfile` is the single source of truth for both production and preview WS routing, so any Caddy change for either host must be made in that file.

### Dispatch a preview deploy for a selected ref

Run the workflow from GitHub CLI and pass the target ref explicitly:

```sh
gh workflow run ws-preview-deploy.yml --ref main -f ref=<branch-or-sha>
```

From Termux, trigger the current poker-avatar PR and wait for its result with this complete command (requires an authenticated GitHub CLI with Actions write permission):

```sh
REPO=krzysztofcal/arcadePlatform; DEPLOY_REF=agent/plan-poker-profile-avatars; gh workflow run ws-preview-deploy.yml --repo "$REPO" --ref main -f ref="$DEPLOY_REF" && sleep 3 && RUN_ID="$(gh run list --repo "$REPO" --workflow 'WS Preview Deploy' --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')" && gh run watch --repo "$REPO" "$RUN_ID" --exit-status
```

If `gh` returns `403 Resource not accessible by personal access token`, re-authenticate in Termux with an account/token allowed to run Actions:

```sh
gh auth login --hostname github.com --git-protocol https --web
```

Examples:

```sh
gh workflow run ws-preview-deploy.yml --ref main -f ref=feature/ws-preview-health-fix
gh workflow run ws-preview-deploy.yml --ref main -f ref=3b6f2d4
```

- `--ref main` selects the branch that contains `.github/workflows/ws-preview-deploy.yml`.
- `-f ref=...` is the application ref that the workflow checks out and deploys.
- The workflow remains `workflow_dispatch`-only and is not wired into the existing WS PR or production deploy workflows.
- The workflow does not write `/etc/caddy/Caddyfile`; infra applies Caddy and uses `infra/vps/Caddyfile` for both `ws.kcswh.pl` and `ws-preview.kcswh.pl`.

### Preview runtime contract

The preview VPS contract is:

- Host: `ws-preview.kcswh.pl`
- Base root: `/opt/arcade-ws-preview`
- Active app dir: `/opt/arcade-ws-preview/ws-server`
- Env file: `/opt/arcade-ws-preview/.env.preview`
- Systemd unit: `ws-server-preview.service`
- Local health endpoint: `http://127.0.0.1:3001/healthz`
- Public health endpoint: `https://ws-preview.kcswh.pl/healthz`
- Preview port: `3001`
- Remote upload staging directory: `/tmp/arcadeplatform-ws-preview`
- Supabase target: `SUPABASE_STAGE_PROJECT_REF` must be set, and `SUPABASE_URL` plus `SUPABASE_DB_URL` must target that same stage project ref
- Internal admin token: `POKER_WS_INTERNAL_TOKEN` must be a long preview-only secret shared only with the deploy-preview-scoped Netlify Function configuration
- Optional close grace: `POKER_TABLE_CLOSE_GRACE_MS=60000` keeps newly created empty tables open for 60s before cleanup may close them
- Optional transport watchdog timeout: `WS_TRANSPORT_PONG_TIMEOUT_MS=60000` waits for one outstanding WebSocket control-ping acknowledgement before terminating an unresponsive socket through the existing close/reconnect lifecycle. The accepted range is 30–300 seconds.

Preview deploys unpack into a temporary directory under `/tmp/arcadeplatform-ws-preview` and then sync the extracted files into `/opt/arcade-ws-preview/ws-server`.
The `WS_PREVIEW_USER` SSH account must have passwordless sudo available to non-interactive GitHub Actions sessions. The workflow checks this with `sudo -n bash -c 'true'` before touching preview app contents because it needs elevated access to validate the systemd unit, read the preview env file, sync files into `/opt/arcade-ws-preview`, and restart `ws-server-preview.service`. Do not use `sudo -n -v` as the local smoke check here: it can still require a password when the same user has both normal passworded sudo rules and command-specific `NOPASSWD` rules.
The workflow fails fast before mutating preview app contents when passwordless sudo, the preview base root, app dir, env file, service, Node.js, `tar`, `rsync`, `curl`, required `PORT=3001`, `WS_AUTHORITATIVE_JOIN_ENABLED=1`, non-empty `SUPABASE_DB_URL`, preview-only `POKER_WS_INTERNAL_TOKEN`, or stage Supabase project-ref match is missing. It also rejects retired `WS_BOT_REACTION_MIN_MS` and `WS_BOT_REACTION_MAX_MS` values so runtime changes have one source of truth.
Preview routing stays in `infra/vps/Caddyfile`, which must continue to define both the `ws.kcswh.pl -> 127.0.0.1:3000` and `ws-preview.kcswh.pl -> 127.0.0.1:3001` site blocks. Only the preview host exposes the exact `/internal/admin/bot-reaction` reverse-proxy route. Both hosts expose the exact `/internal/admin/poker-log-control` route for the environment-bound authenticated Netlify proxy; no wildcard `/internal/admin/*` route is allowed.

### WS Preview bot reaction control

The Admin Ops card can set a single fixed bot reaction delay for manual poker testing. A value such as `500 ms` creates the in-memory range `500–500 ms`; **Set default** removes the override and restores random `2000–4000 ms` delays. The next bot action reads the current range, while an action already sleeping keeps its original delay.

The control is intentionally process-local and preview-only: it does not use a table, migration, feature-flag service, or timing ENV. A WS Preview restart or deployment restores the default automatically. The deploy-preview Netlify context must define `POKER_WS_INTERNAL_BASE_URL=https://ws-preview.kcswh.pl` and the same preview-only `POKER_WS_INTERNAL_TOKEN` as `/opt/arcade-ws-preview/.env.preview`. Do not copy either setting into production context.

Manual verification after both Netlify Deploy Preview and an explicit WS Preview Deploy:

1. Open Admin → Ops and confirm the card says `WS Preview`, `Default`, and `2000–4000 ms`.
2. Set `500 ms`, start a poker hand, and confirm subsequent bot decisions occur after about half a second.
3. Click **Set default**, continue playing, and confirm subsequent bot decisions again vary within approximately `2000–4000 ms`.
4. Restart or redeploy the preview WS and confirm the card returns to `Default` without database cleanup.

### Poker DEBUG control

Admin → Ops exposes process-local Global, Category, and Table DEBUG overrides with a mandatory server-bounded TTL. The Netlify context is bound to one WS origin: deploy previews use `https://ws-preview.kcswh.pl`, while production uses `https://ws.kcswh.pl`. Each context must define its own `POKER_WS_INTERNAL_BASE_URL` and matching `POKER_WS_INTERNAL_TOKEN`; never reuse the Preview token in Production.

Table DEBUG is the normal diagnostic scope. The selector reuses the authenticated OPEN-table list and retains a manual exact-ID fallback. Global DEBUG is emergency-only and requires an additional browser confirmation on Production. Active overrides display a local countdown derived from `serverNow`; expiry remains authoritative in WS and does not depend on the Admin page.

The control does not read journald, store logs in Supabase, change poker state, or suppress `ERROR`. Disable submits the exact active scope returned by WS. A restart clears all process-local overrides.

Minimal preview sudoers coverage for `WS_PREVIEW_USER` must include the concrete programs used by the workflow: `systemctl`, `test`, `grep`, `bash`, `rm`, `mkdir`, `tar`, and `rsync`. On Ubuntu, verify the actual binary paths with `command -v systemctl test grep bash rm mkdir tar rsync`, then keep `/etc/sudoers.d/ws-preview-deploy` mode `0440`.

Quick VPS check for the current `copilot` deploy user:

```sh
sudo -u copilot sudo -n systemctl cat ws-server-preview.service >/dev/null && echo systemctl-ok
sudo -u copilot sudo -n test -d /opt/arcade-ws-preview && echo test-ok
sudo -u copilot sudo -n grep -Eq '^PORT=3001$' /opt/arcade-ws-preview/.env.preview && echo grep-ok
sudo -u copilot sudo -n bash -c 'test -f "$1"' bash /opt/arcade-ws-preview/.env.preview && echo bash-ok
sudo -u copilot sudo -n mkdir -p /tmp/arcadeplatform-ws-preview/sudo-check && echo mkdir-ok
sudo -u copilot sudo -n rm -rf /tmp/arcadeplatform-ws-preview/sudo-check && echo rm-ok
sudo -u copilot sudo -n rsync --version >/dev/null && echo rsync-ok
sudo -u copilot sudo -n tar --version >/dev/null && echo tar-ok
```

### Preview secrets

Configure these GitHub Actions secrets for preview access only:

- `WS_PREVIEW_HOST`
- `WS_PREVIEW_USER`
- `WS_PREVIEW_SSH_KEY`

These secrets are intentionally separate from the production WS deploy credentials so preview runs cannot mutate production WS resources.


## Post-deploy migration note
Legacy HTTP sweep is retired for gameplay authority and no scheduler invokes it. Any stale active gameplay cleanup must run from WS-owned runtime/ops flows, not from `/.netlify/functions/poker-sweep`.

## Poker action-history retention cleanup

**Purpose and ownership.** The retention cleanup is owned by the authoritative WS server process (`ws-server/server.mjs`). It bounds the growth of `public.poker_actions` by deleting rows from completed hands older than configurable retention windows. The cleanup is a continuous background sweep inside the WS runtime; it is not an HTTP endpoint, Supabase scheduled job, cron job, or table janitor operation.

Implementation: `ws-server/poker/persistence/action-history-cleanup.mjs`, scheduler wiring in `ws-server/server.mjs`.

### Data classification — `has_human_participant`

The one-way boolean column `public.poker_tables.has_human_participant` classifies tables for retention purposes:

| Value | Meaning | Retention |
|-------|---------|-----------|
| `false` | No human participation detected | Uses **bot** retention windows |
| `true` | Human has played at this table | Uses **human** retention windows |

Once set to `true` the flag never returns to `false`. Existing tables are backfilled by the migration `20260730160000_poker_tables_has_human_participant.sql` from three sources: current human seats (`poker_seats.is_bot IS NOT TRUE`), historical human gameplay requests (`poker_requests.kind IN ('JOIN','LEAVE','ACT','REBUY')`), and creator gameplay evidence (`poker_actions.user_id = poker_tables.created_by` with a non-ADMIN action).

This classification affects retention only. It does not make the database authoritative for active gameplay, does not replace `poker_seats` or `poker_state`, and is not consulted by bot claims recovery, terminal accounting, or any gameplay decision.

### Four-phase deletion semantics

Cleanup runs in bounded rounds. Each phase has its own database transaction, so
a successful phase is not rolled back when a later phase fails:

**Historical orphan hole cards.** Before the regular phases, cleanup removes a
bounded set of old `poker_hole_cards` from `CLOSED` tables only when no
`poker_actions` exist for the hand. It requires and locks the authoritative
`poker_state` row with `FOR UPDATE OF ps SKIP LOCKED`, but never locks
`poker_tables`, avoiding a new cross-table lock-order cycle. The JSON state must
be an object with a string `handId`. A non-empty value protects that hand;
`handId: ""` is the canonical terminal sentinel and means no current hand.
Missing, null, or non-string values fail closed. Candidate age is based on
`MAX(poker_hole_cards.created_at)`, so one fresh row protects the whole hand.
The phase uses the existing bot/human action-retention cutoffs and sets local
`250ms` lock and `10000ms` statement timeouts. The orphan hand batch is capped
at 25 even when the shared cleanup batch is larger. Timeout or deadlock rolls back
only this phase; normal cleanup continues and the orphan phase retries on the
next sweep.

**Hole cards phase.** Deletes `poker_hole_cards` for unique `(table_id, hand_id)`
hands whose `HAND_SETTLED` marker is older than the applicable action-retention
cutoff. `batchSize` limits candidate hands; `holeCardsDeleted` counts physical
hole-card rows. A failed hole-card phase is not retried in later rounds of the
same sweep, but is retried by the next sweep.

**Phase 1 — ordinary actions.** Deletes all action rows except `HAND_SETTLED` for completed hands whose `HAND_SETTLED` audit row is older than the applicable action-retention cutoff. Only hands that still have ordinary action rows are selected (correlated `EXISTS`). A table's retention classification is read while holding a row lock (`FOR UPDATE OF t SKIP LOCKED`) and locked tables are bounded by `lockLimit = batchSize * 2`.

**Phase 2 — settlement markers.** Deletes old `HAND_SETTLED` rows only when no ordinary actions and no `poker_hole_cards` remain for the same hand (two correlated `NOT EXISTS` checks). This guarantees that a marker remains available for a later hole-card retry if that phase previously failed.

The order in every round is orphan hole cards, regular hole cards, Phase 1,
then Phase 2. An orphan or regular hole-card failure does not block the action
phases. A Phase 1 or Phase 2 failure stops later rounds. Candidate CTEs are
bounded and feed `DELETE … RETURNING`; bot and human cutoffs are selected
through `has_human_participant` predicates.

`batchSize` limits the number of candidate hands (hole cards and Phase 1) or settlement rows (Phase 2) selected per sweep, not the number of physical rows deleted. A single candidate hand may contain multiple hole-card or ordinary-action rows, so the corresponding deleted counters may be much larger than `batchSize`.

### Environment variables

| Variable | Unit | Default | Range | Disabled | Meaning |
|----------|------|---------|-------|----------|---------|
| `WS_POKER_BOT_ACTION_RETENTION_MS` | ms | `0` | finite non-negative integer | `0` | Delete ordinary actions and eligible hole cards for bot-only tables after this many ms since the hand's `HAND_SETTLED` marker |
| `WS_POKER_BOT_SETTLED_RETENTION_MS` | ms | `0` | finite non-negative integer | `0` | Delete `HAND_SETTLED` markers for bot-only tables after this many ms, only when ordinary actions and hole cards are gone |
| `WS_POKER_HUMAN_ACTION_RETENTION_MS` | ms | `0` | finite non-negative integer | `0` | Same as bot-action but for tables where a human ever played |
| `WS_POKER_HUMAN_SETTLED_RETENTION_MS` | ms | `0` | finite non-negative integer | `0` | Delete `HAND_SETTLED` markers for human-participated tables after this many ms, only when ordinary actions and hole cards are gone |
| `WS_POKER_ACTION_HISTORY_SWEEP_MS` | ms | `300000` (5 min) | `30_000`–`3_600_000` | N/A | Interval between cleanup sweep invocations |
| `WS_POKER_ACTION_HISTORY_BATCH_SIZE` | count | `20` | `1`–`100` integer | N/A | Maximum candidate hands/settlements per phase per sweep. `lockLimit` is derived as `batchSize * 2` |
| `WS_POKER_CLOSED_TABLE_RETENTION_MS` | ms | `604800000` (7 days) | finite non-negative integer | `0` | Delete old `CLOSED` poker tables after this many ms since terminal close (`updated_at`). Runs after the action-history sweep on the same timer; requires terminal state (`HAND_DONE` + empty `handId`), settled escrow (`balance = 0`), zero actions/hole cards, no fresh requests, and no unfinished durable `ACT` request |
| `WS_POKER_CLOSED_TABLE_BATCH_SIZE` | count | `20` | `1`–`100` integer | N/A | Maximum candidate tables deleted per sweep. Runtime-loaded tables are excluded via `tableManager` retirement claims; the final guarded DELETE uses `FOR UPDATE SKIP LOCKED` |
| `ADMIN_LEDGER_DB_WARNING_MB` | MB | `800` | finite non-negative integer | `0` | Database total size warning threshold for the admin Ops "Ledger / Database capacity" section. `0` disables the warning only (measurements are still reported and `capacityStatus` stays `OK`); invalid or negative values fall back to the default. Configure per environment according to the actual database capacity and operational policy. |

Validation rules (fail-fast at WS startup):

- Every retention value must be a finite, non-negative integer.
- `action = 0` with `settled > 0` is **invalid** — throws at startup.
- When both `> 0`, `settled` must be `>= action`.
- `batchSize` must be an integer from 1 through 100.
- Bot and human retention pairs are validated independently.
- Action-history retention defaults are `0` (disabled until configured). Closed-table retention defaults to 7 days; `0` disables it.

A sweep-in-progress guard prevents concurrent sweeps when a sweep takes longer than the sweep interval.

### Current WS Preview policy

The following policy is intentionally enabled on Preview in `/opt/arcade-ws-preview/.env.preview`:

```
WS_POKER_BOT_ACTION_RETENTION_MS=86400000
WS_POKER_BOT_SETTLED_RETENTION_MS=604800000
WS_POKER_HUMAN_ACTION_RETENTION_MS=604800000
WS_POKER_HUMAN_SETTLED_RETENTION_MS=2592000000
WS_POKER_ACTION_HISTORY_SWEEP_MS=300000
WS_POKER_ACTION_HISTORY_BATCH_SIZE=50
# Closed-table retention (after terminal close + settled escrow):
WS_POKER_CLOSED_TABLE_RETENTION_MS=604800000
WS_POKER_CLOSED_TABLE_BATCH_SIZE=50
```

Human-readable equivalents:
- Bot ordinary actions: **24 hours**
- Bot settlements: **7 days**
- Human-table ordinary actions: **7 days**
- Human-table settlements: **30 days**
- Sweep interval: **5 minutes**
- Batch size: **50** (lock limit: **100**)
- Closed-table retention: **7 days** after terminal close, only when escrow is settled and history is gone

This Preview policy is distinct from code defaults. Action-history retention production defaults remain `0` (disabled) until separately configured; closed-table retention defaults to 7 days but only deletes tables that satisfy every safety guard. The `/opt/arcade-ws-preview/.env.preview` file is **not touched** by the `ws-preview-deploy.yml` workflow — rsync syncs only `ws-server/`, `shared/`, and `netlify/functions/_shared/` directories, so Preview env configuration persists across deploys.

### Required migrations and deployment order

Two migrations are introduced by this feature:

| Migration | Purpose |
|-----------|---------|
| `20260730160000_poker_tables_has_human_participant.sql` | Add `has_human_participant` column + 3-source backfill |
| `20260730160001_poker_actions_hand_settled_cleanup_idx.sql` | Partial index `(table_id, created_at) WHERE action_type = 'HAND_SETTLED'` |

Deployment order:
1. Apply both migrations to the target database.
2. Deploy the matching WS revision.
3. Configure non-zero retention values for the environment.
4. Restart the WS service and verify health.

Editing an already-applied migration is not allowed. Use a new timestamped migration file for corrections.

### Observability and verification

**klog events:**

| Event | Severity | Fields |
|-------|----------|--------|
| `ws_action_history_cleanup_complete` | INFO | `orphanHoleCardsDeleted`, `holeCardsDeleted`, `phase1Deleted`, `phase2Deleted`, `batchSize`, `lockLimit` |
| `ws_action_history_cleanup_failed` | ERROR | stable `errorCode`, ordered `failedPhases`, completed phase counters |

The `complete` event is emitted only when at least one row was deleted. A no-op with enabled retention remains a successful, quiet sweep. The `failed` event is emitted after a sweep with one or more failed phases. `orphan_hole_cards_cleanup_failed` identifies the recovery phase without weakening the regular `HAND_SETTLED` path. Because transactions are separate, `failed` does not mean that successful phase counters were rolled back; the panel may show positive deletion counts together with `failed`.

### Historical orphan SQL rollout gate

Do not deploy a revision that introduces or changes the orphan phase before
examining its final SQL against the target Stage backlog. First run the
candidate `SELECT` through `EXPLAIN (ANALYZE, BUFFERS)`. Run the complete
`DELETE` plan only inside an explicitly rolled-back transaction:

```sql
BEGIN;
SET LOCAL lock_timeout = '250ms';
SET LOCAL statement_timeout = '10000ms';
EXPLAIN (ANALYZE, BUFFERS)
WITH locked_states AS MATERIALIZED (...),
     orphan_candidates AS MATERIALIZED (...)
DELETE FROM public.poker_hole_cards hc
USING orphan_candidates oc
WHERE hc.table_id = oc.table_id AND hc.hand_id = oc.hand_id
RETURNING hc.table_id, hc.hand_id, hc.user_id;
ROLLBACK;
```

Record the eligible orphan count before and after and require equality after
the rollback. If the final query exceeds the statement budget or performs an
unacceptable scan, compare real plans before choosing an index. In particular,
evaluate existing indexes against `(table_id, hand_id, created_at)` and
`(created_at, table_id, hand_id)`; do not add a migration speculatively. If an
index is required, apply it to Stage and repeat both plans before the first WS
Preview deploy containing the active phase.

**Preview verification commands:**

```bash
# Health check
curl -s http://127.0.0.1:3001/healthz

# Cleanup logs since the service activation timestamp
sudo journalctl -u ws-server-preview.service --no-pager | grep "ws_action_history_cleanup_"

# Inspect running environment values
sudo grep -E '^WS_POKER_(BOT|HUMAN)_(ACTION|SETTLED)_RETENTION_MS=|^WS_POKER_ACTION_HISTORY_(SWEEP_MS|BATCH_SIZE)=' /opt/arcade-ws-preview/.env.preview
```

**SQL verification queries:**

```sql
-- Count expired bot ordinary actions (actions past bot-action retention
-- belonging to a completed, settled hand)
SELECT COUNT(*)
FROM public.poker_actions pa
JOIN public.poker_tables t ON t.id = pa.table_id
WHERE t.has_human_participant = false
  AND pa.action_type != 'HAND_SETTLED'
  AND EXISTS (
    SELECT 1 FROM public.poker_actions hs
    WHERE hs.table_id = pa.table_id
      AND hs.hand_id = pa.hand_id
      AND hs.action_type = 'HAND_SETTLED'
      AND hs.created_at < now() - interval '24 hours'
  );

-- Group expired bot settlement markers by table
SELECT pa.table_id, COUNT(*) AS expired_settlements
FROM public.poker_actions pa
JOIN public.poker_tables t ON t.id = pa.table_id
WHERE t.has_human_participant = false
  AND pa.action_type = 'HAND_SETTLED'
  AND pa.created_at < now() - interval '7 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.poker_actions oa
    WHERE oa.table_id = pa.table_id
      AND oa.hand_id = pa.hand_id
      AND oa.action_type != 'HAND_SETTLED'
  )
GROUP BY pa.table_id
ORDER BY expired_settlements DESC;

-- Verify has_human_participant for a specific table
SELECT id, status, lifecycle_kind, has_human_participant, created_at
FROM public.poker_tables
WHERE id = '<TABLE_ID>';
```

A shared stage database may contain a historical backlog. A recently active continuous bot table may still show expired rows while the sweep processes older tables first. Successful repeated bounded-deletion logs plus decreasing global eligible counts demonstrate progress; a single active table not reaching zero immediately does not indicate a failure.

### Safety, disabling, and rollback

**This process permanently deletes historical `poker_actions` rows.**

- Set all four retention values to `0` to disable deletion entirely.
- Restart the WS service after changing configuration — the values are read once at process start.
- Disabling cleanup stops future deletion but **cannot restore already deleted rows**.
- Do not accidentally apply a short human retention — human and bot retention are independently configurable.
- The `has_human_participant` flag is one-way and not reversible. If a table is incorrectly classified, only the retention values (not the flag) can be adjusted.

### Preview smoke evidence (2026-07-30)

- Deployed SHA: `a9eacc3f6ac37d9dab473e6f12febf417b4f06d1`
- Local health (`http://127.0.0.1:3001/healthz`) returned `200`; public health passed.
- Both phases deleted rows against real PostgreSQL on the stage database.
- Bounded `holeCardsDeleted`, `phase1Deleted`, and `phase2Deleted` values were observed in `ws_action_history_cleanup_complete` logs.
- No `ws_action_history_cleanup_failed` events were observed.
- Preview was then configured for continuous retention with the policy documented above.
