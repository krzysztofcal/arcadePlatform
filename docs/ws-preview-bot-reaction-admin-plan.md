# WS Preview poker bot reaction control — implementation plan

Status: planning only  
Date: 2026-07-14  
Scope: one small preview-tooling PR before poker bust accounting and manual rebuy

## TL;DR

Add one compact card to the existing Admin **Ops** tab. The administrator enters a single fixed delay such as `500 ms`; the UI sends it as `minMs = 500` and `maxMs = 500`. **Set default** clears the in-memory override instead of storing `2000–4000` as an override.

Use the existing protected path:

```text
admin.html
  -> same-origin Netlify admin function
  -> POKER_WS_INTERNAL_TOKEN
  -> exact WS Preview internal HTTP endpoint
  -> one process-local override store
  -> accepted-bot-autoplay-adapter beforeBotActionStep
```

Do not add a public poker WS command. The Netlify function reuses `requireAdminUser()`, while the WS endpoint reuses the existing internal bearer token pattern. Preview-only behavior is enforced by all of these independent checks:

1. the Netlify function accepts only a verified `deploy-preview` + stage identity;
2. the proxy target is allowlisted to `https://ws-preview.kcswh.pl`;
3. Caddy exposes the exact internal path only under the preview host;
4. the WS process verifies its existing port/stage-project preview identity before every read or mutation;
5. the WS process requires `POKER_WS_INTERNAL_TOKEN`.

Production therefore cannot read or mutate the override even if a caller knows the route. No DB, migration, feature-flag system, poker-state property, or timing-value ENV is needed.

## Current repository analysis

### Bot reaction timing

`ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs` currently owns:

- `DEFAULT_BOT_REACTION_MIN_MS = 2000`;
- `DEFAULT_BOT_REACTION_MAX_MS = 4000`;
- `getBotAutoplayConfig(env)`, which resolves the reaction range and the unrelated bots-only hard cap;
- `resolveBotReactionDelayMs()`, which samples once and clamps the result to the remaining bot turn window;
- `beforeBotActionStep`, which calculates the delay, calls the injected `sleep()`, then reloads authoritative state and confirms that the turn still belongs to a bot.

`createAcceptedBotStepExecutor()` is created lazily from `loadAcceptedBotAutoplayExecutor()` in `ws-server/server.mjs`. One accepted executor invocation runs at most one bot action (`maxActions: 1`). The current `cfg` snapshot is resolved before that action's `beforeBotActionStep`.

This gives a clean change boundary: inject one `getBotReactionOverride()` callback into the existing adapter and call it immediately before `resolveBotReactionDelayMs()`. The callback returns either a validated range or `null`; `getBotAutoplayConfig()` remains responsible for the normal static range. The sampled `reactionDelayMs` remains a local immutable value for the already-started `sleep()`. A later admin update affects only the next delay calculation.

Human timing is separate. Human turn deadlines and timeout handling use `TURN_MS`, `poker-turn-timeout.mjs`, and server timeout sweeps. The override must not be passed to, imported by, or read from those paths.

### Admin authentication and UI

`admin.html` already contains an **Ops** tab with runtime identity, health, and manual operational actions. `js/admin-page.js`:

- obtains the current Supabase access token;
- sends it through the shared `apiFetch()` helper;
- calls same-origin `/.netlify/functions/admin-*` endpoints;
- loads Ops data with `Promise.allSettled()`;
- uses `klog()` and controlled UI errors;
- is an existing external script, so this feature needs no new script tag.

`netlify/functions/_shared/admin-auth.mjs` already provides `requireAdminUser()` backed by Supabase JWT verification and the `ADMIN_USER_IDS` allowlist. Existing admin handlers consistently apply CORS, method checks, and `adminAuthErrorResponse()`.

`netlify/functions/admin-stage-identity.mjs` already derives a sanitized deployment identity from the generated deploy context and Supabase project configuration. It distinguishes `deploy-preview`, stage, production, and unknown without exposing secrets. The new proxy can reuse `buildStageIdentity()` rather than inventing another Netlify preview detector.

### Existing Netlify-to-WS path

The repository already has a server-to-server pattern:

- Netlify reads `POKER_WS_INTERNAL_BASE_URL` and `POKER_WS_INTERNAL_TOKEN`;
- `netlify/functions/_shared/poker-ws-runtime-notify.mjs` calls an internal WS HTTP route;
- `ws-server/server.mjs` checks the same bearer token in `handleInternalLobbyMaterialize()`;
- `/healthz` and internal HTTP routing already share the WS process's HTTP server.

This is the smallest existing authorization boundary to reuse. The browser never receives the internal token.

### Preview runtime identity

The preview deployment already has a fail-closed identity contract:

- `PORT=3001`;
- `WS_AUTHORITATIVE_JOIN_ENABLED=1`;
- a non-empty `SUPABASE_STAGE_PROJECT_REF`;
- `SUPABASE_URL` and `SUPABASE_DB_URL` matching that stage project ref;
- preview-specific service, filesystem root, and Caddy host.

`.github/workflows/ws-preview-deploy.yml` verifies these values before replacing or restarting the preview runtime. Production uses port `3000` and the production Caddy host.

The implementation should reuse this conjunction inside the WS runtime. It must not treat `NODE_ENV=production`, a hostname header, or port `3001` alone as sufficient proof of preview.

## Options considered

| Option | Reuse | Security and complexity | Decision |
| --- | --- | --- | --- |
| Protected admin WS command | Reuses normal WS auth, but the WS runtime does not currently own the admin allowlist and the admin page does not maintain a poker WS session | Adds a public protocol message, admin authorization to WS, token mint/client lifecycle, request IDs, and production message handling | Reject |
| Browser-facing preview-only WS HTTP endpoint | Reuses the HTTP server | Requires browser CORS, Supabase JWT verification, admin allowlist configuration, and public endpoint security inside WS | Reject |
| Netlify admin function proxy to protected WS Preview HTTP endpoint | Reuses `apiFetch()`, `requireAdminUser()`, deployment identity, internal base URL/token, and WS HTTP routing | One narrow same-origin admin API plus one exact internal route; browser never sees service credentials | Select |

The selected design does not change `docs/ws-poker-protocol.md`, `PROTECTED_MESSAGE_TYPES`, the public WebSocket envelope, or the poker browser client.

## Final architecture

### Process-local state

Add one small closure-backed store created exactly once during `ws-server/server.mjs` startup:

```text
defaults = { minMs: 2000, maxMs: 4000 }
override = null

override, when set = {
  minMs,
  maxMs,
  updatedAt,
  updatedBy
}
```

Required store operations:

- `read()` returns the mode, default range, active range, and optional override;
- `setOverride({ minMs, maxMs, updatedBy })` validates and atomically replaces the in-memory object;
- `clearOverride({ updatedBy })` sets `override = null`;
- `getOverrideRange()` returns a fresh `{ minMs, maxMs }` copy or `null` for autoplay;
- every administrative read/write checks the preview runtime guard;
- creating a new store always starts with `override = null`.

Do not mutate `process.env`, persist the object, attach it to a table, or copy default values into `override`.

### Input contract

Backend validation is authoritative:

- both values are integers;
- `100 <= minMs <= 10000`;
- `100 <= maxMs <= 10000`;
- `minMs <= maxMs`;
- `updatedBy` comes from the authenticated Netlify function, never from browser JSON;
- unknown keys/modes are rejected with controlled `invalid_request` or `invalid_range` responses.

The first UI intentionally exposes one numeric **Reaction delay (ms)** field with `min=100`, `max=10000`, and an appropriate integer step. Applying `500` sends `{ minMs: 500, maxMs: 500 }`. The backend and store retain a range-shaped contract so separate min/max controls can be added later without changing autoplay.

### Read response

The sanitized admin response is additive and contains no secret:

```json
{
  "ok": true,
  "environment": "ws-preview",
  "mode": "default",
  "defaults": { "minMs": 2000, "maxMs": 4000 },
  "active": { "minMs": 2000, "maxMs": 4000 },
  "override": null
}
```

Override mode additionally returns the in-memory `updatedAt` and `updatedBy`. The UI needs to display only mode and active range; identity/timestamp are useful for diagnostics but must not be persisted.

### Timing semantics

For each new bot action:

1. `beforeBotActionStep` verifies that the authoritative turn belongs to a bot;
2. it reads one effective range snapshot;
3. existing `resolveBotReactionDelayMs()` samples and clamps the value;
4. existing `sleep(reactionDelayMs)` begins;
5. changes made after step 2 do not alter that promise;
6. the next bot action repeats the lookup and sees the latest override.

No timer registry, cancellation token, rescheduling, or mutation of a pending sleep is allowed.

## Implementation phases and exact touchpoints

### Phase 1 — runtime store and autoplay injection

#### New `ws-server/poker/runtime/bot-reaction-override.mjs`

Add pure validation plus `createBotReactionOverrideStore({ env, now })`.

Responsibilities:

- own the `2000–4000 ms` defaults and `100–10000 ms` validation bounds;
- keep the optional override in a closure;
- derive preview identity from the existing `PORT`, `WS_AUTHORITATIVE_JOIN_ENABLED`, `SUPABASE_STAGE_PROJECT_REF`, `SUPABASE_URL`, and `SUPABASE_DB_URL` contract;
- require both configured Supabase targets to match the declared stage project ref;
- return `preview_only` without state disclosure on production, unknown, or partially configured runtimes;
- return copies, never the mutable internal object;
- use injected `now()` for deterministic timestamps;
- contain no DB, file, Redis, timer, or network access.

Move the two default reaction constants out of `accepted-bot-autoplay-adapter.mjs` into this module and import them into the adapter. There must be one source of truth, not duplicated `2000` and `4000` literals.

Keep the existing startup `WS_BOT_REACTION_MIN_MS/MAX_MS` hooks for current non-preview tests and deployment compatibility. `getBotAutoplayConfig(env, runtimeOverride)` uses a validated runtime override first and otherwise preserves the current ENV-or-constant resolution. WS Preview deployment must reject those legacy timing ENV values, so its default and every process restart are deterministically `2000–4000 ms`. Do not add another timing ENV.

#### `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs`

Change `createAcceptedBotStepExecutor()` to accept an injected `getBotReactionOverride` callback whose default returns `null`.

Change only the reaction-delay part of `beforeBotActionStep`:

- read the callback immediately before `resolveBotReactionDelayMs()`;
- call `getBotAutoplayConfig(env, runtimeOverride)` and pass its resolved range into the existing sampler;
- retain the deadline clamp, authoritative bot-turn checks, sleep, post-sleep refresh, request IDs, persistence, and bot decision logic unchanged.

Do not read the store while handling a human turn and do not modify `TURN_MS` or `turnDeadlineAt`.

#### `ws-server/server.mjs`

Create one store at module startup and pass `() => botReactionOverrideStore.getOverrideRange()` from `loadAcceptedBotAutoplayExecutor()` into the adapter.

Add `handleInternalBotReactionConfig(req, res)` and route only exact `/internal/admin/bot-reaction` requests:

- `GET` reads the sanitized snapshot;
- `POST` accepts `mode: "override"` with min/max, or `mode: "default"`;
- reuse `internalRuntimeToken` and the current bearer comparison pattern;
- reject missing token configuration with `503`;
- reject an invalid bearer with `401`;
- reject a non-preview process with `403 { error: "preview_only" }` before reading or changing state;
- use bounded JSON body parsing and reject invalid JSON/ranges with `400`;
- pass the trusted `updatedBy` supplied by the Netlify service call;
- return `cache-control: no-store` for reads, mutations, and errors;
- use `klogSafe` for successful mutations and controlled failures; never log the bearer token or request body.

The endpoint is operational HTTP, not part of the public poker WS protocol.

### Phase 2 — protected Netlify admin proxy

#### New `netlify/functions/admin-ws-preview-bot-reaction.mjs`

Follow the existing admin handler shape:

- apply `corsHeaders()` and method handling;
- call `requireAdminUser(event, env)` for both `GET` and `POST`;
- reuse `buildStageIdentity(env)` and require `environmentContext === "deploy-preview"`, stage DB target, and matching configured stage project refs;
- resolve `POKER_WS_INTERNAL_BASE_URL` and require the exact allowlisted origin `https://ws-preview.kcswh.pl` with no credentials or unexpected path;
- require `POKER_WS_INTERNAL_TOKEN` and send it only server-to-server;
- use an `AbortController` timeout consistent with existing WS runtime notification;
- forward only the allowlisted mode/min/max fields;
- set `updatedBy` from `admin.userId` after authentication;
- map upstream `preview_only`, auth, validation, unavailable, and timeout results into controlled admin errors;
- return `cache-control: no-store` and call the upstream with cache disabled;
- never query or write the database;
- log through `klog` without token, raw body, email, or profile data.

Public Netlify API contract:

- `GET /.netlify/functions/admin-ws-preview-bot-reaction`;
- `POST /.netlify/functions/admin-ws-preview-bot-reaction` with `{ "mode": "override", "minMs": 500, "maxMs": 500 }`;
- `POST` with `{ "mode": "default" }` clears the override.

Production and branch-deploy Netlify contexts must return a controlled `preview_only` response without calling any WS target. A non-admin must receive the existing `401/403` admin response.

### Phase 3 — existing Admin Ops UI

#### `admin.html`

Add one card inside `#adminTabOps` using existing admin card, field, pill, action, and status classes.

Required controls and labels:

- title: **WS Preview · Poker bot reaction**;
- visible **WS Preview** pill;
- current mode: **Default** or **Override**;
- active range such as `2000–4000 ms` or `500 ms`;
- one numeric fixed-delay input;
- **Apply delay** button;
- **Set default** button;
- card-local `aria-live` result/error area.

The card remains visible outside preview and shows a controlled **Available only on WS Preview** state. It must not imply that hiding controls is the security boundary.

#### `js/admin-page.js`

Extend existing structures rather than adding a script:

- `state.ops.botReaction` and `state.ops.botReactionError`;
- new cached nodes selected in `selectNodes()`;
- `renderBotReactionControl()`;
- `loadBotReactionControl()` or a third settled request inside `loadOps()`;
- `submitBotReactionOverride()`;
- `clearBotReactionOverride()`;
- event wiring in `wireStaticEvents()`.

Behavior:

- a read failure must not fail the other Ops cards;
- `preview_only`, `ws_preview_unavailable`, and `invalid_range` render inside the card;
- genuine `401` or `admin_required` can continue to use the page-level unauthorized behavior;
- disable both mutation buttons while a request is pending;
- re-render from the server response after every mutation;
- load the current runtime value with `cache: "no-store"`;
- do not optimistically claim an override is active;
- use the existing `apiFetch()` and `klog()` helpers;
- keep the current IIFE/browser style compatible with JSP-served pages.

#### `css/admin.css`

No new CSS is expected: existing Ops grid, card, field, button, pill, and note classes are sufficient. If implementation reveals one unavoidable layout rule, add it to this existing stylesheet with one line per selector. Do not add inline styles.

### Phase 4 — preview routing and deployment guard

#### `infra/vps/Caddyfile`

Under `ws-preview.kcswh.pl` only, proxy the exact `/internal/admin/bot-reaction` path to `127.0.0.1:3001`.

Do not add the route to `ws.kcswh.pl`, do not proxy a wildcard `/internal/*`, and retain the default response for every other unknown path. The endpoint still requires the internal bearer and the in-process preview guard.

#### `.github/workflows/ws-preview-deploy.yml`

Extend the existing remote preflight to require:

- the existing non-empty `POKER_WS_INTERNAL_TOKEN` in `.env.preview`;
- the existing port/stage identity checks;
- absence of `WS_BOT_REACTION_MIN_MS` and `WS_BOT_REACTION_MAX_MS` in preview configuration, so a restart returns to the declared `2000–4000 ms` default.

This adds no timing ENV. It makes the already-existing internal token mandatory for this preview control.

#### `infra/vps/ws-preview.env.example`

Document the existing preview identity and internal-token variable names required by the workflow. Do not add min/max values or an enable flag for the override.

#### `docs/poker-deployment.md`

Document:

- the process-local and restart-reset behavior;
- the exact preview-only internal route;
- deploy-preview-scoped `POKER_WS_INTERNAL_BASE_URL=https://ws-preview.kcswh.pl` and matching `POKER_WS_INTERNAL_TOKEN` owner configuration;
- that production Netlify variables must not inherit the preview target;
- the manual Apply → test → Set default scenario;
- that this tooling PR must be deployed and verified before beginning bust-accounting implementation.

## Security invariants

1. Browser code never receives `POKER_WS_INTERNAL_TOKEN`.
2. Netlify authenticates the Supabase user and applies the existing admin allowlist before proxying.
3. The Netlify function allows only deploy-preview + stage identity and a fixed WS Preview origin.
4. Caddy exposes only one exact preview-host path, never a general internal prefix and never the production host.
5. The WS process independently proves preview identity and checks the bearer before returning state or mutating it.
6. Production/unknown runtime returns no active/default/override payload.
7. Inputs are integers in `[100, 10000]` and `minMs <= maxMs`.
8. Logs contain mode/range/timestamp/admin user ID only; never bearer tokens or raw auth data.
9. Override state cannot cross a process restart and cannot affect another WS instance.
10. No human deadline, legal action, bot strategy, request ID, persistence, settlement, or ledger path reads this setting.

## Focused test plan

Use existing Node behavior/contract runners. Do not add Playwright.

### `ws-server/poker/runtime/accepted-bot-autoplay-adapter.behavior.test.mjs`

Extend the existing suite to cover:

- no override resolves to `2000–4000 ms`;
- fixed `500–500 ms` is read by the next bot action and calls `sleep(500)` when the turn window permits;
- clearing the store returns the next action to the normal sampled range;
- updating the store from inside the injected `sleep()` does not change the already captured sleep duration;
- a later executor invocation sees the new range;
- a human turn does not call the bot range provider and retains its normal deadline behavior;
- a newly created store has no override, proving restart/new-instance reset;
- invalid integers, negative/NaN/out-of-range values, and `min > max` are rejected without changing the prior state;
- production and incomplete preview identities reject administrative read/write and reveal no snapshot.

Keep these tests in the already registered adapter suite unless a separate file materially improves clarity; avoid expanding runner registration for a tiny pure module.

### `ws-server/server.behavior.test.mjs`

Add internal HTTP behavior cases:

- valid preview identity + internal bearer can read and set `500–500`;
- **Set default** returns `mode: default` and `override: null`;
- missing/wrong bearer is rejected;
- production runtime is `preview_only` for both GET and POST and cannot read prior values;
- invalid range returns `400` and leaves the prior value unchanged;
- a second server process starts in default mode.

### `tests/admin-endpoints.behavior.test.mjs`

Extend the existing admin endpoint suite:

- allowlisted deploy-preview admin can GET and POST through an injected fetch;
- `updatedBy` forwarded upstream is taken from authenticated admin identity;
- non-admin is rejected before fetch;
- production/branch/unknown context is rejected before fetch;
- a non-allowlisted base URL is rejected before fetch;
- upstream preview-only/unavailable/invalid-range errors are mapped to controlled responses.

### `tests/admin-page.contract.test.mjs` and `tests/admin-page.behavior.test.mjs`

Add small checks for:

- required card, fixed-delay input, Apply, Set default, and `aria-live` nodes;
- Default/Override and active-range rendering;
- fixed input sends equal min/max;
- pending state disables duplicate mutations;
- Set default sends only default mode;
- preview-only error stays local to the card and does not hide the rest of Admin Ops.

### Preview infrastructure guards

Update existing:

- `ws-tests/infra-vps-caddy.guard.test.mjs` to require the exact route only in the preview block and forbid it in production;
- `ws-tests/ws-preview-deploy.remote-shape.guard.test.mjs` to require internal token preflight and forbid timing ENV overrides;
- protocol compliance tests only to assert that no public WS admin message was added, if an existing negative guard can express this without brittle source matching.

## Acceptance criteria

- An allowlisted administrator on Netlify Deploy Preview sees **WS Preview**, current mode, and active range.
- Initial/new-process state is **Default · 2000–4000 ms**.
- Applying `500` produces **Override · 500 ms** and each subsequently calculated bot reaction uses `500 ms`, subject only to the existing turn-deadline safety clamp.
- A bot sleep already in progress is not cancelled, shortened, or restarted.
- **Set default** removes the override and restores random `2000–4000 ms` calculations.
- Invalid ranges do not mutate the prior state.
- Non-admin users cannot read or mutate the setting.
- Production Netlify and production WS cannot read or mutate the setting.
- Human turn timing is unchanged.
- Restart/redeployment clears the override without cleanup work.
- No DB row, migration, timing-value ENV, poker snapshot field, or public WS protocol message is added.

## Manual verification

Both Netlify Deploy Preview and a manual WS Preview Deploy of the implementation branch are required.

Preconditions:

- the implementation ref is deployed to `ws-preview.kcswh.pl`;
- the Caddy preview-only route is applied;
- deploy-preview Netlify variables point only to the WS Preview origin and use the matching internal token;
- the administrator is present in the existing `ADMIN_USER_IDS` allowlist.

Scenario:

1. Open the implementation Netlify Preview and sign in as an administrator.
2. Open **Admin → Ops** and confirm **Default · 2000–4000 ms · WS Preview**.
3. Set **Reaction delay** to `500` and apply.
4. Open a preview poker table and observe several consecutive bot actions at approximately 0.5-second intervals.
5. Change the override while one bot delay is already sleeping; confirm that action keeps its sampled delay and the following bot action uses the new value.
6. Return to Admin → Ops and press **Set default**.
7. Confirm **Default · 2000–4000 ms** and observe varied bot delays in that range.
8. Restart or redeploy WS Preview and confirm the UI still reports Default with no retained override.
9. Open production Admin and confirm the card reports preview-only/unavailable without exposing a range or breaking other Ops cards.
10. Confirm normal human turn deadline behavior before and after override changes.

## Rollout and rollback

Rollout order:

1. merge/apply the preview-only Caddy route;
2. verify deploy-preview-scoped internal base URL/token configuration;
3. deploy the implementation branch through WS Preview Deploy;
4. deploy/open Netlify Preview;
5. run the manual scenario;
6. press **Set default** before starting bust-accounting manual tests;
7. merge only after default and override behavior are both verified.

Rollback is simple:

- restart immediately clears any active override;
- reverting the UI/function leaves no durable state;
- reverting the WS code restores the existing `2000–4000 ms` path;
- the exact Caddy route can be removed independently;
- no data rollback or migration rollback exists.

## Breaking-impact analysis

No intended product or protocol break:

- no DB migration or production data change;
- no public WS protocol change;
- no change to bot decisions, legal actions, request IDs, persistence, settlement, ledger, or human timeouts;
- no new browser script, inline script, external origin, or CSP SHA;
- existing admin APIs remain compatible;
- override state is additive and preview-process-local.

Operational changes requiring attention:

- preview Caddy gains one exact token-protected route; production must not gain it;
- `POKER_WS_INTERNAL_TOKEN` becomes required on the preview WS process and must match the deploy-preview-scoped Netlify value;
- preview deployment rejects legacy `WS_BOT_REACTION_MIN_MS/MAX_MS` values to guarantee reset to `2000–4000`;
- changing the injected adapter factory signature is internally breaking for tests/custom adapters unless the callback has a safe default;
- a globally shared WS Preview instance means one administrator's override affects all preview poker tables until cleared or restarted.

## Explicitly out of scope

- production timing controls;
- per-table, per-bot, or per-admin settings;
- database persistence or audit tables;
- feature-flag infrastructure;
- interrupting active sleeps;
- modifying human deadlines;
- bot strategy or action-frequency changes;
- bust accounting, `OUT_OF_CHIPS`, manual rebuy, or auto-rebuy implementation;
- Playwright coverage.

## Definition of Done

- The selected Netlify admin proxy architecture is implemented without a public WS command.
- Preview-only reads and writes are enforced by server-side runtime identity and bearer checks.
- The Admin Ops card accurately shows Default/Override and the active range.
- `500` becomes `500–500` for the next delay calculation.
- **Set default** stores `null`, not copied defaults.
- Restart returns to `2000–4000`.
- The focused behavior, admin, UI contract, and preview infra guard tests pass.
- Netlify Preview and WS Preview manual verification pass.
- Production cannot read or change the override.
- The override is reset to default before poker bust-accounting work begins.
