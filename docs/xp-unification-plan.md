# XP System Unification Plan

## Executive summary

Arcade Hub consolidated XP before implementing the leaderboard. The current product has one authoritative award/status route (`calculate-xp`) and one justified signed-session route (`start-session`). The legacy `award-xp` route has been removed.

Implementation status (2026-07-12): PRs 1-4 and the final compatibility cleanup are complete. Repository callers, redirects, local tooling, and tests use `calculate-xp`; `award-xp.mjs` no longer exists. The plan remains as the implementation record and invariant checklist.

This plan intentionally skips the observation/telemetry phase from `docs/xp-complexity-audit.md`. Arcade Hub is still early, has one active operator/user, and does not need a production usage window before removing internal legacy paths. Replacement confidence will come from repository-wide caller inspection, existing guards, deterministic behavior tests, Deploy Preview smoke tests, and a controlled compatibility adapter.

This is a consolidation, not a ground-up rewrite. Existing Redis keys, caps, conversion receipts, public response fields, and signed-session contracts remain stable until their callers are migrated and verified.

## Goals

1. Make `calculate-xp` the only owner of XP award and status orchestration.
2. Keep one atomic implementation for daily, session, and lifetime totals.
3. Keep one canonical status snapshot used by badge, public profile, and future leaderboard code.
4. Reduce `award-xp` to a compatibility adapter and then retire legacy client-delta awards.
5. Preserve guest XP, authenticated XP, one-time anonymous conversion, the 3,000 daily cap, and session rotation.
6. Make identity mismatch or invalid JWT fallback structurally impossible.
7. Reduce client branching without changing gameplay scoring semantics.

## Non-goals

- Do not implement a leaderboard, rankings, daily/weekly aggregates, or XP history.
- Do not change XP values, game scoring rules, daily reset time, or cap amounts.
- Do not merge `start-session` into the XP endpoint.
- Do not rename public payload fields in the first two implementation PRs.
- Do not migrate canonical XP totals to Postgres.
- Do not accept browser cache values as authenticated XP.
- Do not add telemetry infrastructure solely to decide whether legacy code can be removed.

## Fixed decisions

- Canonical authenticated total remains `kcswh:xp:v2:total:<Supabase user id>` in Upstash.
- `calculate-xp` remains the public authoritative route to avoid breaking playable pages.
- `start-session` remains separate because session issuance has distinct security and rate-limit behavior.
- Status reads use the same identity and conversion service as awards but never consume gameplay windows or grant XP.
- A missing Authorization header may use anonymous identity; a supplied invalid token always returns `401` and never falls back to anonymous identity.
- The removed `award-xp` endpoint must not be reintroduced; a static guard enforces its absence.
- Removal decisions use static caller verification and real smoke tests instead of a Phase 0 usage-observation period.

## Required invariants

Every implementation PR must preserve all of these:

1. Authenticated award, authenticated status, public profile, and future leaderboard resolve to the same Supabase user ID and lifetime total.
2. Anonymous and authenticated totals never share a key accidentally.
3. Anonymous-to-account conversion is atomic and exactly once when a positive transferable balance exists.
4. Daily, session, and lifetime updates remain atomic.
5. Daily cap remains 3,000 XP and resets at 03:00 Europe/Warsaw.
6. Session cap and session rotation continue allowing progress up to the daily cap.
7. Status operations do not award XP, consume activity, increment session counters, or trigger award animation. The new authoritative status operation also does not register or touch award/signed sessions; only the temporary `award-xp statusOnly` adapter may preserve that legacy side effect until PR 3.
8. Badge and overlay animate only after a positive authoritative award response.
9. Clearing cookies or local storage does not change authenticated account XP.
10. Guest play remains supported without a Supabase session.
11. Existing game aliases continue resolving to canonical game IDs.
12. Public responses never expose Supabase UUIDs, Redis keys, conversion markers, or signed-session identifiers.

## Target architecture

### Public endpoints

#### `POST /.netlify/functions/calculate-xp`

Support an explicit normalized operation:

- `operation: "award"`: validate a semantic gameplay window, calculate the grant, and execute the atomic ledger operation.
- `operation: "status"`: resolve identity, perform permitted one-time anonymous conversion, and return the canonical snapshot without gameplay mutation.

During migration, existing award payloads without `operation` normalize to `award`. Existing `statusOnly: true` normalizes to `status`.

#### `POST /.netlify/functions/start-session`

Retain the current responsibility: issue and validate signed anti-abuse sessions. It may call shared identity/session helpers but does not read or award XP totals unless required to construct its existing response contract.

#### Removed endpoint: `POST /.netlify/functions/award-xp`

Static caller inspection and Deploy Preview smoke tests proved that supported pages use `calculate-xp`. The compatibility endpoint and its redirects are removed; requests to the old route now receive the platform's normal missing-function response.

### Status/session compatibility decision

Current `award-xp` requests with `statusOnly: true` are not read-only. They call `registerSession()`, may call `touchSession()` for a valid signed session, generate a `sessionId` when the request has none, and return that ID. This behavior must not be removed implicitly while status ownership moves.

The migration contract is:

1. New `calculate-xp` requests with `operation: "status"` do not call `registerSession()`, `touchSession()`, create signed-session state, or generate a new session identifier. They may temporarily echo a caller-supplied `sessionId` to preserve the response shape, but the field is not authoritative and `XPClient.fetchStatus()` must not consume it.
2. The `award-xp statusOnly` compatibility adapter delegates canonical identity, conversion, totals, and snapshot projection to the new status service, but temporarily retains legacy session registration/touch and generated `sessionId` behavior during PR 2. Those side effects live only in the adapter and are not part of the authoritative status service.
3. Anonymous-to-account conversion remains an explicitly permitted status mutation because it is atomic and idempotent. Updating a derived profile snapshot may also remain, but it happens after the canonical read and never mutates daily, session, or lifetime XP totals.
4. PR 3 removes legacy status session registration/touch and generated response IDs together with client-delta awards. At that point `award-xp` either delegates a fully read-only status response or is removed.
5. Gameplay signed-session creation remains owned by `start-session`; award-session initialization remains owned by the award path. A status read must never be required to make a later `calculate-xp` award valid.

This staged rule preserves cached legacy callers without allowing hidden session mutations to become part of the new status contract.

### Internal modules

Prefer small concrete modules under `netlify/functions/_shared/`:

- `xp-request.mjs`: normalize operation and legacy request shapes.
- `xp-identity.mjs`: existing JWT/anon identity, canonical game IDs, and atomic conversion ownership.
- `xp-calculator.mjs`: pure semantic activity-window to requested grant calculation.
- `xp-ledger.mjs`: canonical keys and one atomic award operation.
- `xp-status.mjs`: canonical non-mutating snapshot projection.
- `xp-response.mjs`: allowlisted response and controlled error mapping.
- existing session helper(s): signed-session validation and issuance.

Do not create a framework or class hierarchy. Handlers should parse HTTP, call one service operation, and serialize the result.

## Delivery plan

### PR 1: Centralize XP domain operations

Objective: remove duplicated server orchestration while preserving every current route and client contract.

Implementation status in PR #681: the canonical Redis key factory, totals reader, atomic Lua award operation, normalized result mapping, status projection, and derived profile persistence now live under `netlify/functions/_shared/`. Both current handlers use those shared owners. The legacy `award-xp` adapter still owns its request compatibility, session registration/touch, lock retry, and response mapping; `calculate-xp` still owns gameplay scoring. Moving status traffic and removing the adapter are intentionally left to PR 2 and PR 3 below.

Work:

- Inventory duplicated logic in `calculate-xp.mjs` and `award-xp.mjs` before moving it.
- Extract canonical identity/conversion invocation into one service boundary using `_shared/supabase-admin.mjs` and `_shared/xp-identity.mjs`.
- Extract Redis key construction and the atomic award operation into one owner.
- Extract a normalized canonical status snapshot containing the currently supported totals, caps, reset fields, level inputs, and session fields.
- Separate canonical status projection from legacy `statusOnly` session setup. Add explicit adapter hooks so `registerSession()`, `touchSession()`, and generated `sessionId` cannot leak into the shared status service.
- Keep current Lua semantics and Redis key names unless a proven defect requires a separately reviewed change.
- Make both handlers call shared operations; retain request and response compatibility.
- Keep `calculate-xp` gameplay calculation separate from ledger mutation so status cannot invoke calculation accidentally.
- Make public profile reads use the same strict canonical total/status reader where practical, without exposing internal fields.

Verification:

- Existing XP test suite and guards remain green.
- Add parity tests that run equivalent identities and totals through both route adapters and compare canonical snapshots.
- Test invalid bearer token plus anon ID returns `401` with no anon mutation.
- Test concurrent awards cannot exceed daily or session caps.
- Test conversion conflict/retry remains idempotent.
- Add characterization tests for current `statusOnly`: requested/generated `sessionId`, registry creation, signed-session touch, conversion, and derived profile persistence. These define what the adapter temporarily preserves, not the target status behavior.
- Real stage smoke: guest award, authenticated award, conversion, status, public profile, cookie/storage clearing.

Exit criteria:

- There is one implementation of canonical keys, conversion orchestration, atomic cap enforcement, and status projection.
- Handler-specific code is limited to HTTP compatibility and gameplay calculation selection.
- No scoring behavior or response contract changes are observed.

### PR 2: Move status to `calculate-xp`

Objective: make reads and writes enter through the same authoritative endpoint.

Implementation status: `XPClient.fetchStatus()` now sends `operation: "status"` to `calculate-xp`. The authoritative status branch runs after identity resolution and optional idempotent anonymous conversion, but before award rate limiting, signed-session validation/touch, gameplay validation, or scoring. `award-xp statusOnly` remains the temporary mutating compatibility adapter described below.

Work:

- Add explicit `operation: "status"` handling to `calculate-xp`.
- Accept `statusOnly: true` as a temporary normalization alias if required by cached clients.
- Change `XPClient.fetchStatus()` to call `calculate-xp` with the authenticated bearer token and current anon identity.
- Ensure status bypasses award-specific activity, stale-window, and signed-session mutation paths.
- Do not call `registerSession()` or `touchSession()` and do not generate a new `sessionId` in `calculate-xp operation=status`. Echo a supplied ID only if response compatibility requires it.
- Change `award-xp` status handling to delegate to the same service, not duplicate it.
- Keep legacy session registration/touch and generated `sessionId` only in the `award-xp statusOnly` adapter for this PR. Mark that adapter behavior for removal in PR 3.
- Keep response fields compatible with badge, migration notice, public profile consistency tests, and non-game pages.
- Update `docs/xp-service.md`, `docs/xp-system.md`, and `docs/xp-anon-to-account-conversion.md` to identify the new status owner.

Verification:

- Badge remains loading until authoritative status is known and never flashes a provisional authenticated zero.
- Login, logout, account switch, multi-tab, focus/BFCache, and auth-token refresh resolve the correct identity.
- Badge XP, public profile XP, and computed level match for the same account.
- Clearing all browser data and signing in again preserves account XP.
- Network/status failure does not overwrite a known value with zero or delete migration cache prematurely.
- Status requests produce no award animation and no XP mutation.
- A new status request followed by normal `start-session` and `calculate-xp operation=award` succeeds without any registry side effect from status.
- A legacy `award-xp statusOnly` request still returns its compatible `sessionId` and allows the existing legacy award flow during PR 2.
- Removing `registerSession()` from the new status path does not alter session rotation, the 300 XP session ceiling, or progress toward the 3,000 daily ceiling.

Exit criteria:

- All supported clients read status from `calculate-xp`.
- `award-xp` status is only a thin delegating adapter.
- Any remaining status-triggered session mutation is isolated in that adapter and has a mandatory removal task in PR 3.
- Leaderboard implementation may begin after this PR is stable on production and the identity-consistency smoke passes.

### PR 3: Retire legacy client-delta awards

Objective: remove the second executable award algorithm without waiting for production telemetry.

Implementation status: supported client methods and XP core always call `postWindowServerCalc()`. After the compatibility cycle and successful smoke tests, `award-xp`, its redirects, local server wiring, and adapter-only tests were removed. `check-xp-authoritative-transport.mjs` prevents restoring the function or reconnecting playable code to the retired transport.

Work:

- Use `rg`, the XP hook guard, catalog validation, and playable-page inspection to prove every supported game uses semantic activity and server calculation.
- Verify no production page calls `XPClient.postWindow()` or sends client-authoritative deltas to `award-xp`.
- Remove the obsolete `postWindowAuto` alias after all supported callers use `postWindowServerCalc` directly.
- Keep a controlled compatibility response for direct legacy attempts during one deploy cycle, without mutating XP.
- Remove legacy delta policy, cap, conversion, and Lua orchestration from `award-xp`.
- Remove adapter-only `statusOnly` calls to `registerSession()`/`touchSession()`, stop generating status `sessionId`, and update compatibility responses after proving no supported client consumes that field.
- Update tests and docs to reject new references to the legacy award path.
- Remove the adapter entirely only if static repository checks and Deploy Preview smoke prove it has no supported callers.

Verification:

- Exercise every game category except poker through representative semantic actions; poker retains its established XP contract.
- Verify paused, idle, background, and random-click states do not earn XP.
- Verify restarts and score resets continue producing valid semantic activity.
- Confirm session rotation continues after the 300 XP session ceiling and stops at 3,000 daily XP.
- Confirm status followed by award works without a status-created registry entry and that `start-session` remains the only signed-session initializer.
- Add a guard that fails when playable code references the retired transport.

Exit criteria:

- Only `calculate-xp` can mutate gameplay XP.
- `award-xp` cannot grant a client-provided delta.
- No supported client references the retired award transport.

### PR 4: Reduce XP client state

Objective: simplify browser code after server ownership is unambiguous.

Implementation status: the client now has one gameplay award method, `postWindowServerCalc()`, and one status method, `fetchStatus()`, both targeting `calculate-xp`. The legacy aliases, runtime feature flags, dynamic module loader, duplicate retry implementation, and `js/xp/server-calc.js` have been removed. A static guard prevents these paths from being reintroduced.

Work:

- Separate transport/auth/session acquisition from badge presentation and gameplay accumulation using existing plain-script modules.
- Keep one status reconciliation function and one confirmed-award application function.
- Remove obsolete legacy transport selection and duplicate retry branches.
- Remove obsolete cache fields only after compatibility reads have shipped for one release.
- Clarify internal names for anon identity, award session, signed session, and gameplay run without changing public payload names unnecessarily.
- Preserve IIFE/plain-script loading and JSP compatibility.
- Keep `klog` for runtime diagnostics; do not add `console.log`.
- If an inline script changes, update the CSP SHA allowlist.

Verification:

- Existing lifecycle, badge, XP hook, BFCache, auth-transition, cap, and game behavior tests remain green.
- Multi-tab and multi-device status convergence remains server-authoritative.
- Award overlay and badge bump happen exactly once per positive confirmed response.
- Non-game pages perform no award/session-start requests.

Exit criteria:

- Client has one production award transport and one status transport targeting the same endpoint.
- Identity-bound caches cannot cross account transitions.
- Obsolete legacy state and branches are removed or explicitly documented as temporary compatibility reads.

## Verification matrix

Run for every implementation PR:

- `npm test`
- `npm run check:all`
- syntax checks from the repository test runner
- Netlify Deploy Preview
- existing XP contract, identity, conversion, cap, BFCache, and game-hook tests

Manual smoke matrix:

1. Guest starts at the canonical guest total and earns XP from a real semantic game action.
2. Random clicks, paused gameplay, idle tabs, and background tabs do not award XP.
3. Authenticated user earns XP and receives the same total in badge, status, and public profile.
4. Anonymous XP converts once after login and does not convert twice after refresh or concurrent requests.
5. Invalid bearer token with a valid anon ID returns `401` and mutates neither identity.
6. Logout/login and switching between two accounts do not leak badge or cache state.
7. Clearing cookies and local storage does not reduce authenticated XP.
8. Two tabs converge to the same canonical total.
9. A second device reads the same authenticated total.
10. Session cap rotates correctly; daily cap stops at 3,000 XP and resets at 03:00 Europe/Warsaw.
11. Status reads do not animate, grant XP, or consume gameplay state.
12. Public profile returns controlled failure rather than a cacheable false zero when Upstash is unavailable.

## Rollout and rollback

- Each PR must be independently deployable and preserve the previous public HTTP contracts until its exit criteria are met.
- Do not combine centralization, status migration, and legacy removal in one PR.
- PR 1 rollback restores handler wiring while retaining shared modules; Redis keys and data require no rollback.
- PR 2 rollback points `XPClient.fetchStatus()` back to the delegating `award-xp` status adapter, which must remain functional during that PR.
- PR 3 rollback may temporarily restore the compatibility adapter, but must not restore duplicated identity or atomic ledger implementations.
- Never roll back by deleting canonical XP totals, conversion receipts, daily keys, or session counters.

## Breaking impacts

Potential breaking impacts requiring explicit review:

- A status request accidentally routed through award validation may fail or mutate counters.
- Response-shape drift may break badge reconciliation, migration notices, public profiles, or later leaderboard consumers.
- Incorrect identity normalization may split account XP back into anonymous keys.
- Lua/key changes may allow duplicate awards or cap races.
- Retiring client-delta awards may break an uninspected cached page; static checks and one compatibility deploy reduce this risk.
- Client-state cleanup may reintroduce provisional zeroes or stale cross-account values.
- Tight invalid-token handling intentionally changes malformed authenticated requests from anonymous success to `401`.

## Leaderboard readiness gate

Leaderboard work must wait until PR 1 and PR 2 are merged, deployed, and pass the identity-consistency smoke. At that point there is one canonical status snapshot and one authoritative identity path suitable for server-side ranking reads.

PR 3 and PR 4 should still be completed, but leaderboard data design may proceed after the PR 2 gate if no XP mismatch remains. The leaderboard must aggregate server-side, expose only rank/handle/display name/avatar/XP/level, and never query Redis or `auth.users` directly from the browser.

## Definition of done

XP unification is complete when:

- `calculate-xp` owns award and status operations;
- `start-session` remains the only separate session responsibility;
- `award-xp` is removed and guarded against reintroduction;
- all playable pages use semantic server-calculated awards;
- badge, public profile, and status always agree for authenticated users;
- authenticated XP survives browser-data deletion and device changes;
- all invariants and smoke checks pass;
- documentation no longer describes `award-xp` as the status owner;
- the system is ready to provide one canonical server-side input to the future leaderboard.
