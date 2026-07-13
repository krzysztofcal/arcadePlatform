# XP Leaderboard Implementation Plan

## Executive summary

Arcade Hub is ready to add a public XP leaderboard after stabilizing the authoritative XP path, public profiles, avatars, and topbar hydration. The leaderboard must rank only authenticated accounts, use server-confirmed XP, and expose only public profile identity. Guests remain outside public rankings.

The current XP store has per-user lifetime and daily counters but no efficient cross-user index. Reading or scanning individual XP keys at request time is not acceptable. The implementation will add Redis sorted-set projections for `today`, `week`, and `all_time`, update them atomically with every confirmed authenticated XP grant, and resolve public profile fields in a server-only API.

This document tracks the staged implementation. PR #690 implements the dark-write projection foundation and its tests; backfill, public APIs, and UI remain later phases.

## Current foundation

The following prerequisites are complete:

- `calculate-xp` is the single authoritative gameplay award and status endpoint.
- `award-xp` has been removed.
- Lifetime XP is stored under the canonical account key owned by `xp-ledger`.
- Daily caps and day keys use the existing `Europe/Warsaw` contract.
- Badge, authenticated status, and public profile resolve the same Supabase user ID and lifetime total.
- Authenticated XP survives browser-data deletion and device changes.
- Every normal authenticated UI entry creates or reads a public profile.
- Public profiles provide stable handles, display names, default/uploaded avatars, current XP, and level.
- Topbar profile, XP, and chips hydration is presentation-only and does not change XP authority.

Existing documents provide a future row contract and readiness gate, but not a complete leaderboard storage, API, backfill, or rollout design.

## Goals

1. Provide public rankings for `today`, `this week`, and `all time`.
2. Update rankings only from server-confirmed authenticated XP grants.
3. Keep award totals and ranking projections atomically consistent.
4. Link every visible row to `/u/<handle>` without exposing email or Supabase UUID.
5. Return the signed-in user's position even when it is outside the current page.
6. Support deterministic pagination, ties, period boundaries, retention, and backfill.
7. Keep reads bounded and avoid Redis key scans in public requests.
8. Preserve existing XP caps, scoring, anonymous conversion, badge, and public-profile behavior.

## Non-goals

- Ranking anonymous guests.
- Per-game, poker-only, country, friend, or chips leaderboards.
- Historical charts or a public XP event ledger.
- Reconstructing arbitrary historical rankings before the rollout date.
- Replacing Redis with Postgres as the canonical XP store.
- Allowing clients to submit rank, score, XP delta, or leaderboard membership.
- Realtime subscriptions or guaranteed cross-device instant updates.
- Profile search or an endpoint listing all public profiles.

## Product decisions

### Periods

The MVP exposes:

- `today`: XP granted during the current canonical XP day, from 03:00 `Europe/Warsaw` until the next 03:00 reset;
- `week`: XP granted during the current ISO week of canonical XP days, Monday 03:00 through the next Monday 02:59:59.999 in `Europe/Warsaw`;
- `all_time`: canonical lifetime account XP.

The API response includes the normalized period key and `nextResetAt` for period rankings. `all_time` has no reset.

### Eligible identities

- Only authenticated Supabase accounts are ranked.
- Guests and anonymous IDs are never written to public leaderboard indexes.
- A visible row requires a matching `public.user_profiles` record.
- Every indexed production account must have a profile before public rollout. A separate, bounded profile-coverage preflight pages through accounts with the trusted Supabase Admin API and creates missing profiles through the existing trusted profile helper. It runs only as a guarded operation before rollout; public leaderboard reads must never create profiles.
- New users continue receiving profiles through the existing authenticated entry flow. The leaderboard writer must not add a database query to every XP award.
- If an exceptional indexed account has no profile, the API omits it, returns a shorter page, and records a `klog` diagnostic without public identifiers. It must not pull candidates from the next raw Redis page to fill the gap. Reconciliation removes or repairs the invalid member outside the public request.

There is no leaderboard opt-out in this MVP because every authenticated profile is currently public. This privacy decision must be reconfirmed before implementation. If product policy changes, eligibility must be designed before leaderboard indexes are enabled rather than filtering only in the browser.

### Anonymous conversion

Exactly-once anon-to-account conversion changes lifetime XP but does not represent a new award in the current day or week. Therefore:

- conversion synchronizes the account's `all_time` score to the resulting canonical lifetime total;
- converted XP is not added to `today` or `week`;
- later authenticated grants update all three indexes normally.

This prevents login or signup from creating a misleading period-ranking spike.

### Ties

- Public rank uses competition ranking by XP: `1, 2, 2, 4`.
- Rows with equal XP are returned in a deterministic internal order based on the sorted-set member. The member is never returned publicly.
- The displayed rank is derived from score counts, not merely array position.
- The API contract must test ties across page boundaries.

## Data model

### Canonical counters

Existing per-user counters remain canonical:

```text
<XP_KEY_NS>:total:<supabase-user-id>
<XP_KEY_NS>:daily:<supabase-user-id>:<warsaw-day-key>
```

Leaderboard sorted sets are derived, repairable projections. They do not replace canonical counters.

### Sorted-set keys

Use a versioned namespace independent from browser cache keys:

```text
<XP_KEY_NS>:leaderboard:v1:all_time
<XP_KEY_NS>:leaderboard:v1:day:<YYYY-MM-DD>
<XP_KEY_NS>:leaderboard:v1:week:<ISO-week-year>-W<week>
```

Each member is the internal Supabase user ID and each score is a non-negative integer XP total for that period. Internal IDs are permitted inside the trusted Redis store but must never cross the public API boundary.

### Retention

- `all_time`: no TTL.
- day indexes: expire after 14 days.
- week indexes: expire after 8 weeks.
- TTL is refreshed to a fixed period-end-plus-retention timestamp, not extended indefinitely from every award.
- Current canonical per-user key retention is unchanged by this feature.

The 03:00 boundary is required because the existing canonical daily counters cannot safely project a midnight-based ranking. The period helper owns Warsaw XP-day keys, ISO week keys, reset timestamps, and retention TTL calculations. Do not duplicate date logic in handlers or the browser.

## Authoritative write path

### Atomic award update

Extend the existing `XP_ATOMIC_AWARD_SCRIPT` and its memory-store test implementation. For a positive authenticated grant, the same Redis `EVAL` must:

1. enforce duplicate-window, daily-cap, and session-cap rules;
2. increment the canonical daily, session, and lifetime totals;
3. write `all_time` with `ZADD ... lifetimeTotal member` so it self-heals to the canonical total;
4. write `today` with `ZADD ... dailyTotal member` so it self-heals to the canonical day total;
5. increment `week` by the granted amount, or set it from a canonical weekly total if a weekly counter is introduced;
6. apply bounded TTLs to day/week indexes;
7. return the existing award snapshot without changing current client semantics.

No ranking write occurs when `granted` is zero. Failed, duplicate, capped, malformed, anonymous, or unauthorized requests cannot change a leaderboard.

Redis Cluster is not currently used by the Upstash REST deployment. If cluster mode is introduced later, all keys used by one Lua operation will require a compatible hash-tag strategy before rollout.

### Weekly correctness

There is currently no canonical per-user weekly counter. For MVP, `ZINCRBY granted` on the current week index is safe only because:

- the award Lua script is the sole XP writer;
- duplicate and cap checks complete before the increment;
- all mutations occur in one script;
- conversion does not affect weekly ranking.

The backfill/reconciliation tool computes the current weekly score from canonical daily keys. It may repair a user's weekly sorted-set score with `ZADD` when needed.

### Status reads

`operation: "status"` remains non-mutating except for the existing exactly-once conversion behavior. Normal status reads do not enroll, increment, or refresh leaderboard scores. If conversion succeeds, the conversion operation synchronizes only `all_time` in the same trusted mutation path.

### Failure policy

The award must not report success if canonical counters were updated but leaderboard projections were not. Counter and projection writes therefore remain in the same Lua transaction. Infrastructure or script errors preserve the current controlled award failure behavior.

Leaderboard read failures never fall back to fabricated empty ranks as a successful authoritative response. Return a controlled `503 leaderboard_unavailable` with `Cache-Control: no-store`.

## Store adapter changes

Extend the existing Upstash adapter rather than adding another Redis client. Required internal operations include bounded equivalents of:

- `ZADD`;
- `ZINCRBY` where used by reconciliation;
- `ZREM` for reconciliation of ineligible or missing-profile members;
- `ZREVRANGE ... WITHSCORES`;
- `ZREVRANK` and `ZSCORE`;
- `ZCOUNT` for competition-rank calculation;
- `ZCARD`;
- batched/pipelined reads where supported.

The in-memory adapter must implement the same ordering, tie, rank, and TTL behavior used by tests. Public handlers must not issue `KEYS` or unbounded `SCAN`.

## Public API

Add one endpoint:

```text
GET /.netlify/functions/xp-leaderboard?period=today|week|all_time&page=1&limit=25
```

### Request contract

- `period` defaults to `all_time`.
- `page` is a positive integer, initially capped at 20.
- `limit` defaults to 25 and is capped at 50.
- Authentication is optional.
- A supplied invalid Bearer token returns `401`; it never falls back to anonymous behavior.
- A valid token enables the `me` projection but does not change public rows.
- Apply the existing CORS conventions and a reusable public-IP rate limit.

Offset/rank pagination matches Redis sorted-set access and is sufficient for the current product scale. The raw Redis range is always `offset = (page - 1) * limit` through `offset + limit - 1`. Public projection may omit an exceptional member without a profile, but it must not over-fetch into the next page. Rankings can move between requests as XP is awarded; the API documents this eventual movement rather than pretending to provide a stable snapshot cursor.

### Response contract

```json
{
  "period": "today",
  "periodKey": "2026-07-12",
  "nextResetAt": 0,
  "generatedAt": 0,
  "page": 1,
  "limit": 25,
  "hasMore": false,
  "rows": [
    {
      "rank": 1,
      "handle": "blue-fox-123456",
      "displayName": "Blue Fox 123456",
      "avatar": { "type": "default", "variant": "fox-blue" },
      "xp": 300,
      "level": 3,
      "profileUrl": "/u/blue-fox-123456"
    }
  ],
  "me": {
    "rank": 42,
    "xp": 120,
    "handle": "pixel-panda-654321",
    "profileUrl": "/u/pixel-panda-654321"
  }
}
```

`me` is `null` for guests, zero-XP accounts, or accounts not currently eligible. It uses the same public projection and must not contain a UUID.

### Public allowlist

The endpoint may return only:

- rank;
- handle;
- display name;
- public avatar model/URL;
- period XP;
- level computed from lifetime XP;
- public profile URL.

For `today` and `week`, row `xp` is period gain while `level` is computed from the canonical lifetime total. Batch-read lifetime totals server-side for visible rows; do not infer level from period XP.

Never return email, Supabase UUID, auth metadata, IP, chips, ledger data, poker data, session IDs, Redis keys, bio, or XP event history.

### Profile join

1. Read a bounded candidate range and scores from Redis.
2. Batch-query `user_profiles` with the existing trusted SQL helper.
3. Preserve Redis ordering while projecting profiles through shared avatar/public-profile helpers.
4. Batch-read lifetime totals when period scores do not represent lifetime XP.
5. If a candidate has no profile, omit it from that response, return a shorter page, and emit an aggregate diagnostic. Do not read beyond the page's raw Redis range.
6. Derive `hasMore` from the raw sorted-set cardinality and raw page boundary, not from the number of projected rows.

Do not serialize raw Redis members or database rows.

This preserves deterministic page boundaries: a missing profile at raw position 10 cannot pull a position from page 2 into page 1. Until reconciliation removes the invalid member, public rank numbers may contain a gap, which is preferable to duplicate or skipped users across pages.

### Cache policy

- Public pages: `Cache-Control: public, max-age=15, stale-while-revalidate=30`.
- Authenticated responses containing `me`: `Cache-Control: private, no-store` unless `me` is fetched through a separate authenticated endpoint.
- Prefer splitting `me` into a second request if CDN behavior makes mixed public/private caching error-prone.
- Include `Vary: Origin` and, for mixed auth responses, `Vary: Authorization`.
- Never cache `401`, `429`, or `5xx` as a valid empty leaderboard.

The implementation PR must choose either a fully public cacheable endpoint plus a separate `xp-leaderboard-me` endpoint, or one private response whenever Authorization is present. The preferred design is two endpoints because it keeps the main ranking CDN-cacheable and avoids accidental cross-user `me` leakage.

## Backfill and reconciliation

Add an idempotent, manually invoked server-side tool. It must be guarded to the intended environment and must not accept arbitrary client-provided Redis namespaces.

### Profile coverage preflight

Profile coverage and XP-index backfill have different discovery sources and must remain explicit:

1. Use trusted, paginated Supabase Admin user listing to discover authenticated accounts; do not attempt to discover them with a Redis `KEYS` or unbounded `SCAN`.
2. Create a missing profile through `ensureUserProfile()` under the existing every-account-is-public policy.
3. Record aggregate processed/created/failed counts without logging email addresses or UUIDs.
4. Complete this preflight before ranking backfill and public activation.

If product policy no longer permits automatic public profiles for every account, stop the rollout and redesign eligibility rather than silently creating profiles. The ranking backfill itself starts from `user_profiles`; it does not discover or create auth accounts.

### Initial backfill

1. Page through `public.user_profiles` by internal user ID using trusted SQL.
2. Batch-read each account's canonical lifetime total.
3. `ZADD` non-zero totals to `all_time` using the canonical total as score.
4. For the current Warsaw day, read the canonical daily key and set `today`.
5. For the current Warsaw ISO week, sum the available canonical daily keys for Monday through the current day and set `week`.
6. Record counts and failures through aggregate `klog` fields without emails or public UUID output.
7. Re-running the tool converges to canonical values and creates no duplicate score.

Before relying on current-week backfill, verify production still retains the required daily keys. If any day is unavailable, do not invent a partial score as complete: launch weekly ranking at the next Warsaw week boundary or label a controlled warm-up state until then.

### Reconciliation

Provide a bounded admin/operations mode that checks sampled or paged profiles against canonical totals and repairs sorted-set scores. It is not a public endpoint and does not run on every leaderboard read.

The all-time index is a projection, so rollback may delete and rebuild it without changing user XP. Never modify canonical totals to match a leaderboard score.

## Frontend

### Route decision

Create `leaderboard.html` and route/sidebar links to it. Keep `xp.html` as the signed-in user's progress page. The current sidebar label `Leaderboard` incorrectly points to `xp.html`; update it only when the new page exists.

### Page layout

Build the leaderboard as the usable first screen, using existing Arcade Hub topbar, sidebar, public avatar renderer, number formatter, and PL/EN localization.

Required UI:

- segmented period control: Today / This week / All time;
- podium treatment for the top three without hiding exact rank or XP;
- dense, accessible rows for remaining users;
- avatar, display name, `@handle`, period XP, and level;
- links to `/u/<handle>`;
- highlighted signed-in user's row;
- separate "Your position" summary when the user is outside the loaded page;
- simple previous/next pagination;
- loading skeleton, empty warm-up state, rate-limit state, and retryable error state;
- no provisional zero scores while data is unknown.

Do not load gameplay XP scoring modules merely to render rankings. Reuse only the light auth, topbar hydration, profile/avatar, i18n, and number-format dependencies required by the page.

### Accessibility and localization

- Use a semantic heading and ordered ranking structure/table semantics appropriate to the final markup.
- Period controls must be keyboard operable and expose selected state.
- Announce loading/error/page changes through a restrained `aria-live` region.
- Avatar alternatives use the display name.
- Rank changes are not conveyed only by color.
- Provide complete PL/EN strings, including Warsaw period/reset wording.
- Number formatting follows the active locale.

## Security and abuse controls

- Clients cannot submit XP, rank, member IDs, or profile fields to the leaderboard.
- Invalid Bearer tokens always return `401` on authenticated ranking requests.
- Use explicit response projection and generic errors.
- Apply bounded page/limit values, rate limiting, request timeouts, and fixed raw Redis page ranges.
- Do not provide handle prefix search, full export, arbitrary historical period keys, or unbounded page traversal.
- Only current periods and `all_time` are public in MVP; callers cannot select an old Redis key.
- Use `klog` for diagnostics and never log JWTs, emails, raw UUIDs, or full response rows.
- Existing XP anti-abuse, caps, semantic game actions, and canonical game ID rules remain the security boundary for ranking integrity.

## Observability

Add aggregate diagnostics for:

- leaderboard reads by period and status;
- latency split between Redis and profile projection;
- missing-profile candidate count;
- backfill processed/repaired/failed counts;
- projection drift detected by reconciliation;
- rate-limit and invalid-request counts;
- award-script leaderboard update failures.

Do not create high-cardinality labels containing user IDs or handles.

## Delivery plan

### PR 1: Period and projection foundation

Implementation status: complete in PR #690. The shared 03:00 Warsaw/ISO period helper, sorted-set store parity, atomic authenticated award projections, and all-time conversion synchronization are included; public reads and UI remain disabled.

- Add shared Warsaw day/week period helpers.
- Extend store adapters with sorted-set behavior.
- Extend the atomic award script for authenticated leaderboard projections.
- Synchronize all-time projection during successful anon conversion.
- Add deterministic behavior tests for atomicity, zero grants, guests, conversion, periods, TTL, ties, and memory/remote command parity.
- No public API or UI yet.

### PR 2: Backfill and reconciliation

Implementation status: implemented on branch `feat/xp-leaderboard-backfill`; stage dry-run/apply verification remains required before merge. The maintenance endpoint is admin-only, bounded, dry-run by default, and does not expose leaderboard data publicly.

- Add the guarded idempotent backfill/reconciliation tool.
- Add and run the separate trusted profile-coverage preflight; verify retained daily keys on stage.
- Remove exceptional missing-profile members from projections rather than changing public page boundaries.
- Populate stage `all_time`, current day, and current week.
- Document exact stage/prod invocation, dry-run output, rerun behavior, and rollback.
- Do not expose leaderboard publicly yet.

### PR 3: Public leaderboard API

- Add public cacheable ranking endpoint.
- Add separate authenticated `me` endpoint if selected during implementation review.
- Add batch public-profile projection and lifetime-level reads.
- Add rate limiting, CORS, pagination, tie handling, response allowlist, and error policy.
- Complete API smoke tests against stage data before UI work.

### PR 4: Leaderboard UI

- Add `leaderboard.html`, external controller, scoped CSS, PL/EN strings, and sidebar route.
- Reuse topbar hydration and shared avatar/profile URL rendering.
- Add Today / This week / All time, podium, rows, `me`, pagination, and states.
- Verify root-absolute assets if a rewritten route is later introduced.
- No inline scripts; if any existing inline script changes, update the CSP hash allowlist.

### PR 5: Production rollout and cleanup

- Run production dry-run and idempotent backfill after PRs 1-3 are deployed but before public navigation is enabled.
- Verify counts and sampled canonical totals without exposing identities in logs.
- Enable the UI link after API smoke passes.
- Observe drift, latency, errors, and rate limits.
- Update completed implementation status in this document and related XP/profile docs.

Each PR must be independently reviewable and must not mix unrelated XP scoring changes with leaderboard presentation.

## Verification plan

### Existing checks

Run the repository's existing commands and guards, including:

- `npm test`;
- `npm run check:all`;
- syntax/static HTML checks from the repository test runner;
- game catalog validation;
- Netlify Deploy Preview checks;
- DB migration checks only if implementation later introduces a migration.

No database migration is expected for the Redis-first MVP unless profile eligibility or rollout state requires a persisted schema change.

### Required automated coverage

- One confirmed authenticated grant updates canonical totals and all relevant indexes once.
- Duplicate, zero, capped, guest, invalid-token, and failed grants do not alter rankings.
- Anon conversion updates all-time only and remains exactly once.
- Warsaw 03:00 XP-day and ISO-week/year boundaries choose correct keys and reset times.
- Day/week TTLs are bounded from period end.
- Equal scores produce competition ranks and deterministic ordering.
- Pagination handles ties across boundaries.
- A missing profile at a raw position produces a shorter page without borrowing from the next page; the following page starts at its documented raw offset and contains no duplicate.
- `hasMore` follows raw index cardinality/page boundaries even when public projection omits an invalid member.
- Public projection contains no UUID, email, Redis key, chips, or metadata.
- Invalid auth does not become a guest request.
- Missing profiles are bounded and never trigger profile creation from a public read.
- Redis/profile failure returns controlled non-cacheable errors.
- `me` cannot leak through shared cache.
- Backfill is idempotent and canonical totals win over stale projections.

### Stage smoke checklist

1. Create/use at least three authenticated stage profiles with known distinct XP and two tied scores.
2. Award XP and confirm lifetime, today, and week rows update once.
3. Confirm a guest award never appears.
4. Confirm conversion affects only all-time.
5. Compare badge, public profile all-time XP, leaderboard all-time XP, and canonical status for the same account.
6. Confirm today/week show period gain while level still uses lifetime XP.
7. Verify tie ranks, top three, pagination, and signed-in `me` outside page one.
8. Verify PL/EN, mobile/desktop layout, keyboard controls, loading, empty, `429`, and `503` states.
9. Inspect public payloads for forbidden identifiers and private fields.
10. Run backfill twice and confirm unchanged final scores.
11. Verify the next Warsaw day and week use new period indexes without manual activation.
12. Confirm expired historical indexes follow retention policy.

## Rollout and rollback

### Rollout

1. Deploy projection writes dark: no public route or navigation link.
2. Validate stage award atomicity and period boundaries.
3. Run stage backfill and API smoke.
4. Deploy API without navigation exposure and perform production backfill.
5. Compare sampled leaderboard totals with canonical status/public profile.
6. Enable the leaderboard page and sidebar link.
7. Monitor errors and projection drift through at least one Warsaw day reset and one ISO-week reset.

### Rollback

- Hide the navigation link and return a controlled unavailable response from leaderboard endpoints.
- Stop projection writes only through a reviewed feature flag if the added Lua keys cause operational issues.
- Keep canonical XP totals and award behavior intact.
- Derived sorted sets may be deleted and rebuilt after the writer is fixed.
- Never roll back by subtracting XP or rewriting canonical totals from leaderboard scores.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Ranking diverges from lifetime XP | Atomic `ZADD` of resulting lifetime total; idempotent reconciliation. |
| Week score duplicates | Same Lua as award, duplicate-window guard before `ZINCRBY`, reconciliation from daily keys. |
| Guest identity becomes public | Write projections only for verified authenticated identity. |
| UUID leaks through API or logs | Explicit projection, server-side profile join, response contract tests, aggregate logs. |
| Missing lazy-created profile creates rank gaps | Trusted Auth profile-coverage preflight, shorter deterministic page, non-public reconciliation/removal. |
| CDN leaks signed-in `me` | Separate public and authenticated endpoints preferred; no shared caching of private response. |
| Period keys use wrong timezone | One tested Warsaw/ISO period helper shared by writer, reader, and backfill. |
| Backfill overwrites canonical data | Sorted sets are projection targets only; canonical counters are read-only to backfill. |
| Large public scans increase cost | Sorted-set range reads, capped pages, bounded joins, no `KEYS`/unbounded `SCAN`. |
| Existing users expect historical week data | Backfill only when daily keys are complete; otherwise explicit warm-up until boundary. |

## Breaking impacts

- The existing sidebar `Leaderboard` destination will change from `xp.html` to the new page only in the UI PR.
- Authenticated XP awards will execute additional Redis sorted-set operations in the existing atomic Lua script, increasing script key count and cost.
- Production rollout creates new Redis keys and retention behavior but does not migrate Supabase schema or alter canonical XP totals.
- Every authenticated public profile is eligible for public ranking under the current no-opt-out policy.
- Handles, display names, avatars, XP gain, lifetime XP, level, and rank become more discoverable than a profile URL known in isolation; Terms/Privacy wording must be reviewed for leaderboard visibility before launch.
- Current-period rankings may begin with a controlled warm-up if retained daily data is incomplete.
- Ranking order can move between paginated requests as users earn XP.

## Remaining decisions before public rollout

1. Reconfirm that all authenticated public profiles participate without opt-out.
2. Approve competition ranking for ties.
3. Confirm whether the public API and authenticated `me` read will be separate endpoints; this plan recommends separation.
4. Verify retained production daily keys before promising current-week backfill.
5. Review Terms/Privacy wording for increased discoverability through rankings.

## Definition of done

Leaderboard MVP is complete when:

- every confirmed authenticated award updates canonical XP and ranking projections atomically;
- guests, invalid requests, duplicates, and zero grants cannot change rankings;
- today/week/all-time periods follow the documented Warsaw contract;
- public rows contain only allowlisted profile identity and XP fields;
- badge, status, public profile, and all-time leaderboard agree for sampled accounts;
- period level is derived from lifetime XP, not period gain;
- backfill and reconciliation are idempotent and never modify canonical totals;
- ties, pagination, `me`, caching, failures, and privacy boundaries are covered;
- stage and production smoke checks pass through day/week boundaries;
- the UI is fully localized, accessible, responsive, and linked to `/u/<handle>`;
- related XP, profile, operations, and legal documentation reflects the deployed behavior.
