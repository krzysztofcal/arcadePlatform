# Validation

Run from the feature worktree.

1. Run the focused existing contract and behavior tests:

   `XP_CORS_ALLOW=https://arcade.test node --test tests/public-profiles.behavior.test.mjs`

   `node --test ws-server/poker/table/table-manager.behavior.test.mjs`

   `node --test ws-server/server.behavior.test.mjs`

2. Run repository syntax and fundamental checks:

   `npm run syntax`

   `npm test`

3. Review `git diff --check`, the feature checklist, and the complete diff for:

   - exact full `tableId` preservation in backend and internal responses;
   - Account-only abbreviation in visible text, verified by the existing preview E2E rather than a new unit/VM UI-rendering test;
   - correct balance plus `poker: null` on WS failure;
   - no private state, token, console logging, schema, dependency, or ignore-file changes.

4. Because `ws-server/**` and browser/WS protocol behavior change, dispatch the manual **WS Preview Deploy** workflow from `main` with the implementation commit SHA as its `ref` input. Verify that the workflow succeeded for that exact SHA and inspect the bounded `ws-server-preview.service` journal before preview E2E.

5. On the real Deploy Preview, sign in with a Stage smoke account, claim the existing welcome bonus if needed, create/join a 100 CH table, wait for buy-in, and promptly navigate to Account without cash-out. Assert the ledger debit, wallet delta, full machine-readable table ID, non-null poker projection, and separate `Poker: <sum of WS stacks> CH` badge. With no active stack, the extra segment is hidden.

6. Verify public `/internal/account/poker` returns token-protected JSON (401 without token, 200 matching-user projection with the configured internal token). Never print tokens. A generic 200 `OK` text response is a routing failure, not successful projection.

7. Exercise a temporary preview proxy 503 scoped only to the smoke user's UUID; verify real Netlify still returns the same wallet and `poker: null`, and the poker badge hides. Restore the route in a finally block and confirm projection recovery. Inspect bounded `journalctl -u ws-server-preview.service --since <smoke-start> --no-pager -n 200`. No Production changes or merge. Local test-server E2E does not substitute for this real runtime smoke.

## Real preview verification — 2026-09-12

- Continued PR #983 on `agent/account-table-projection-contract` from
  `079fbf4d3ed61422dcc151f9d9b9b1ded742920a`; no reset or replacement PR.
- The original failure was the preview Caddy catch-all: public
  `/internal/account/poker` returned HTTP 200 text `OK` instead of WS JSON.
  The adapter rejected the non-JSON response and correctly preserved the wallet
  with `poker: null`. The internal URL/token were not the cause.
- The infrastructure step is separate from WS Preview Deploy: update only the
  `ws-preview.kcswh.pl` block in `/etc/caddy/Caddyfile`, validate with
  `sudo caddy validate --config /etc/caddy/Caddyfile`, then reload Caddy.
  WS Preview Deploy packages/restarts WS; it does not apply this proxy file.
  On resumption, that route was already installed and loaded. The Caddy admin
  API configuration exactly matched the adapted disk configuration, and the
  preview host block matched `infra/vps/Caddyfile`. Public unauthenticated GET
  returned 401 JSON, not the catch-all 200.
- Real Chromium smoke used Deploy Preview #983 and observed the WebSocket target
  `wss://ws-preview.kcswh.pl/ws`. A Stage smoke account signed in, claimed the
  existing welcome bonus, created a table, explicitly clicked Join and bought
  in for 100 CH. Creating a table alone does not buy in; the earlier smoke
  script omitted Join and timed out before any debit.
- Wallet changed 500 → 400. Immediate navigation to Account retained full table
  ID `cfef89e7-18cf-4a06-b0cf-eaa6153eb96c`, authoritative stack 100, and the
  rendered badge `CH: 400 · Poker: 100 CH`. No DB membership/stack fallback.
- A real preview proxy 503 scoped to the smoke user's UUID produced HTTP 200
  profile data with balance 400 and `poker: null`; the Poker segment hid while
  CH remained 400. The temporary rule was removed in a finally block, Caddy
  was validated/reloaded, and the authoritative projection recovered.
- Review also corrected global return-to-page refresh: `js/ui/xp-overlay.js` emits
  `ui:visible` from its existing global visibility/persisted-pageshow handlers.
  Topbar consumes that signal; native listeners remain centralized and XP
  session gating stays unchanged. The remaining new VM/simple-glue client
  test was removed; existing tests are retained.
- Full WS validation exposed existing delivery-order test races. Untouched
  main reproduced the hello timeout (2/6 targeted runs); delayed observer delivery
  reproduced an old broadcast being mistaken for the explicit snapshot reply.
  Existing tests now register reaction/join listeners before sending and correlate
  the requested observer snapshot by request ID, preserving assertions/timeouts.
- Constitution remains 1.1.0: intentional automatic Stage migration policy,
  fundamental-test review before implementation, and real target-runtime
  verification. `agents.md` carries the same three rules. No migration, schema,
  dependency, new UI-rendering/VM test, or Production change is included.
- Breaking impact: additive opt-in API and topbar segment; existing profile
  GET/PATCH callers remain compatible. Preview proxy application is required
  separately from the WS release. Other environments will keep the existing
  unavailable behavior until their independently authorized route is deployed.

Final commit-specific test results, exact-HEAD WS Preview Deploy URL, bounded
service journal review and repeated authenticated smoke evidence are recorded
in the existing PR #983 description after the final commit is deployed.

## Completed implementation verification

- Implementation SHA `c7e176e22f4b87dc9ee001b034011e16cfca2453`: fundamental
  backend/WS tests 249/249 passed; `npm run syntax` passed (218 files);
  `npm test` passed (142 runner groups, 680 TAP passes, three optional skips,
  zero failures). `npm run check:all`, `npm run ci:guards`, commit hooks and
  diff whitespace checks passed. Independent review findings were resolved.
- [WS Preview Deploy 34726298617](https://github.com/krzysztofcal/arcadePlatform/actions/runs/34726298617)
  succeeded for that exact SHA; deployed WS metadata and Netlify Deploy Preview
  `6aa5e4636347760008a38658` both matched it.
- Repeated real authenticated smoke passed with full table ID
  `6cd5d0d3-5537-44a7-a453-cfa380001320`: wallet 500 → 400, authoritative
  stack 100, immediate Account row present, and `CH: 400 · Poker: 100 CH`
  on Account and home. Empty projection hid the extra badge.
- Real per-user proxy failure returned `poker: null` with wallet 400;
  restoration recovered the table, and a visible-page event refreshed the
  badge. The script asserted byte-for-byte restoration of the entire proxy
  file, including all other hosts. Bounded preview service journal reviewed.
- The closing documentation commit changes no application/test code. It must
  still receive its own exact-final-HEAD WS Preview Deploy and repeated real
  authenticated smoke; that final release evidence is kept in PR #983 so
  recording the run URL does not change the verified HEAD again.
