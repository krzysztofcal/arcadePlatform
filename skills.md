# skills.md — ArcadePlatform Skills Map

This file tells AI agents **what capabilities (skills) exist in this repo** and where to find them.  
For **how to code** (JS/CSS style, JSP safety, project rules, roles) always read `agents.md` first.

---

## 0. How to use this with `agents.md`

- **agents.md** = behaviour & rules  
  Roles, JS/CSS style, JSP compatibility, testing expectations, “no git commands in speckit”, etc.

- **skills.md** = capabilities & entry points  
  What commands to run, which functions/modules to use, and which docs/specs are the source of truth.

When in doubt:  
1. Check `agents.md` for *how* to do it.  
2. Check `skills.md` for *where* and *what* to use.

---

## 1. Commands & Automation Skills

### 1.1 Test / check commands

**What you may assume and/or run (when the environment allows):**

- Full test suite:  
  - `npm test`  
- XP-specific tests (embedded in test suite):  
  - `tests/xp-award-session-daily.test.mjs` (XP caps, daily/session behaviour).   
  - `tests/xp-client.test.mjs`, `tests/xp-client.cors.test.mjs` (XP client contract & CORS).   
  - `tests/xp-game-hook.test.mjs`, `tests/xp-game-hook-idempotent.test.mjs`.   

- Playwright end-to-end:  
  - `tests/e2e-portal-smoke.spec.ts` (portal basic flows, catalog).   
  - `tests/e2e-game.spec.ts`, `tests/e2e-security-*.spec.ts` (game shell + security).   

- Guard / lint-style checks:  
  - Lifecycle guard: `npm run check:lifecycle` (lifecycle listeners centralised in `js/xp/core.js`).   
  - XP badge guard: `npm run check:xpbadge` (one `#xpBadge` per page).   
  - XP bridge guard: `npm run check:games-xp-hook` + `npm run wire:xp`.   
  - Aggregate: `npm run check:all` (lifecycle + badge + XP bridge, wired via Husky and CI).   

- Schema / syntax helpers:
  - Validate games catalog: `scripts/validate-games.js` (validates `js/games.json` against `js/games.schema.json`).   
  - Syntax check JS + inline `<script>` in HTML: `scripts/syntax-check.mjs`.   

**Skill rule:** when describing or planning tests in a speckit, reference these existing commands/scripts instead of inventing new ones.

---

## 2. XP System Skills

### 2.1 XP frontend (client)

**What this skill covers**

- Using the existing XP client to:
  - Post XP deltas to the backend (`postWindow`).
  - Refresh the XP badge from server state.
  - Wire games via `GameXpBridge.auto()` and XP bridge scripts.
- Extending XP behaviour without breaking the contract in `docs/xp-contract.md`.

**Main entry points**

- `js/xp.js` — XP shell & public `window.XP` surface.   
- `js/xp/core.js` — lifecycle, timers, state machine (guarded by `check:lifecycle`).   
- `js/xp/combo.js`, `js/xp/scoring.js`, `js/xp/server-calc.js` — combo and scoring logic.   
- `js/xp-game-hook.js` — bridge from games to XP, including `GameXpBridge.auto()`.   
- `js/ui/xp-overlay.js` — overlay UI and in-page XP badge/summary behaviour.   
- `js/xpClient.js` — server-facing XP client used by UI pages (badge refresh, status only calls, postWindow).   

**Docs**

- `docs/xp-contract.md` — XP client contract (`window.XP`, lifecycle, postWindow protocol).   
- `docs/xp-calculation-rules.md` — how server applies caps, deltas, and status-only calls.   
- `docs/xp-service.md` — XP service overview + environment configuration.   

**Validation skill**

- Use `XPClient.postWindow` and `XPClient.refreshBadgeFromServer` rather than rolling your own fetches.   
- Keep new lifecycle hooks inside `js/xp/core.js` unless explicitly waived by the guard.   

---

### 2.2 XP backend (Netlify functions)

**What this skill covers**

- Editing and extending the XP Netlify functions:
  - Daily/session caps.
  - CORS and origin checks.
  - Session tokens (`start-session`).
  - Hard XP for logged-in Supabase users (JWT path).
- Ensuring behaviour stays compatible with docs & tests.

**Main functions**

- `netlify/functions/award-xp.mjs`  
  - Main XP endpoint (statusOnly + award).  
  - Enforces `XP_DAILY_CAP`, `XP_SESSION_CAP`, `XP_DELTA_CAP`, lock TTL, etc.   
  - Handles CORS behaviour verified in `tests/xp-client.cors.test.mjs`.   

- `netlify/functions/start-session.mjs`  
  - Issues server-side session tokens keyed by `XP_KEY_NS` and `XP_DAILY_SECRET`.  
  - Enforced by tests under `tests/helpers/xp-test-helpers.mjs` & session tests.   

- `netlify/functions/calculate-xp.mjs`  
  - Central scoring rules (e.g. `GAME_XP_RULES`).   

- `netlify/functions/_shared/store-upstash.mjs`  
  - Upstash backing store (used by all XP functions + tests).   

**Hard XP & anon→account**

- `docs/hard-xp-logged-in-users.md` — Hard XP spec (UserProfile, key layout, JWT rules).   
- `docs/xp-anon-to-account-conversion.md` — anon → account conversion spec & phases (future work).   

**Validation skill**

- When changing caps, response shape or error codes:
  - Update or add tests in `tests/xp-award-session-daily.test.mjs`, `tests/xp-client*.test.mjs`, and relevant E2E tests.   
- Keep backend as **single source of truth** for:
  - userId (from JWT), profile totals, caps, and day boundaries (03:00 Europe/Warsaw).   

---

## 3. Portal & Game Shell Skills

### 3.1 Portal UI & catalog

**What this skill covers**

- Working with the main portal UI (categories, cards, recently played, etc.).
- Using existing services instead of new ad-hoc logic.

**Key files**

- `js/core/PortalApp.js` — categories, cards, main grid behaviour.   
- `js/core/catalog.js` + `js/games.json` + `js/games.schema.json` — catalog & schema.   
- `js/core/game-utils.js` — `isPlayable` + URL/same-origin protections used by tests and portal.   
- `js/core/RecentlyPlayedService.js` + `js/recently-played-page.js` / `js/recently-played-tracker.js`.   
- `js/search-popup.js`, `js/search-popup-bootstrap.js`, `js/core/search-utils.js`.   

**Validation skill**

- When adding games:
  - Update `js/games.json` and re-run `scripts/validate-games.js`.   
- When touching portals/cards:
  - Keep tests in `tests/e2e-portal-smoke.spec.ts` passing (categories, card count, slugs).   

---

### 3.2 Game shells & XP bridge

**What this skill covers**

- Wiring games into the XP system through the **XP bridge snippet stack** and `GameXpBridge.auto()`.

**Key pieces**

- Playable shells: `game*.html`, `play.html`, `games/**/index.html`, `games-open/**/index.html`.   
- XP bridge assets:
  - `/js/xp/combo.js`  
  - `/js/xp/scoring.js`  
  - `/js/xp/core.js`  
  - `/js/xp.js`  
  - `/js/xp-game-hook.js`  
  - Inline bootstrap calling `GameXpBridge.auto()`.   

- Guard script & docs:
  - `scripts/check-games-xp-hook.mjs` and `docs/guards.md` (XP bridge wiring).   

**Validation skill**

- Use `npm run wire:xp` to fix XP snippet issues instead of hand-editing script stacks.   
- Make sure `npm run check:games-xp-hook` passes after changes to playable pages.   

---

## 4. Security & CSP Skills

**What this skill covers**

- Working with security headers, CSP, and security docs/tests.

**Key assets**

- `_headers` — Netlify headers including CSP.   
- `docs/csp-implementation.md` — how to maintain CSP, add script hashes, and handle inline scripts.   
- `SECURITY-ISSUES.md` / `SECURITY-PATCHES.md` — documented security issues and remediations.   
- E2E security tests: `tests/e2e-security-*.spec.ts`.   

**Validation skill**

- When adding **inline scripts**, you must:
  - Keep them minimal and JSP-safe (as per `agents.md`).  
  - Recompute and add the correct script SHA to CSP in `_headers`, following `docs/csp-implementation.md`.   

- When adding new third-party resources:
  - Adjust CSP (`script-src`, `frame-src`, etc.) and document the reasoning in security docs if relevant.   

---

## 5. Styling & Layout Skills

**What this skill covers**

- Updating portal and game styling in line with existing look & feel and CSS rules from `agents.md`.

**Key CSS**

- `css/portal.css`, `css/site.css`, `css/search-popup.css`, `css/xp.css`, `css/xp-badge.css`, `css/xp-overlay.css`.   
- `games-open/game-shell.css` and per-game `style.css` files.   

**Validation skill**

- Follow CSS rules from `agents.md`:
  - One selector per line, blank line between selectors, no hard returns inside declaration blocks.  
- Don’t break grid, XP badge, or overlay layout; run UI-related tests where applicable.

---

## 6. Cross-cutting Project Conventions

These apply whenever you use any skill above:

1. **Follow `agents.md` for style & workflow**  
   - JS: IIFE/vanilla, JSP-friendly, no ES modules in browser code.  
   - CSS: single-line selectors, spacing rules.  
   - Speckits: no git commands unless explicitly requested.   

2. **Logging**  
   - For new debugging logs, use the project’s `klog`/KLog-style logging helpers instead of `console.log`, so logs can be surfaced on the “about” page and aren’t noisy in production.

3. **CSP & security**  
   - When you add inline or external scripts, also update CSP hashes and/or sources according to `docs/csp-implementation.md` and `_headers`.   

4. **Tests and guards**  
   - Any change in XP behaviour, lifecycle, XP bridge wiring, or badge structure should keep:
     - XP unit tests, XP client tests, and XP bridge tests passing.   
     - Guard checks & E2E tests (`npm run check:all`, `npm test`) passing.   

This document does **not** change behaviour by itself; it only describes existing capabilities and where they live.
