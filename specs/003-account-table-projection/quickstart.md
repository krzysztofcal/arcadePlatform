# Validation

Run from the feature worktree.

1. Run the focused existing contract and behavior tests:

   `node --test tests/public-profiles.behavior.test.mjs`

   `node --test ws-server/poker/table/table-manager.behavior.test.mjs`

   `node --test ws-server/server.behavior.test.mjs`

   `node --test tests/public-profile-ui.contract.test.mjs`

2. Run repository syntax and fundamental checks:

   `npm run syntax`

   `npm test`

3. Review `git diff --check`, the feature checklist, and the complete diff for:

   - exact full `tableId` preservation in backend and internal responses;
   - Account-only abbreviation in visible text, verified by the existing preview E2E rather than a new unit/VM UI-rendering test;
   - correct balance plus `poker: null` on WS failure;
   - no private state, token, console logging, schema, dependency, or ignore-file changes.

4. Because `ws-server/**` and browser/WS protocol behavior change, dispatch the manual **WS Preview Deploy** workflow from `main` with the implementation commit SHA as its `ref` input. Verify that the workflow succeeded for that exact SHA and inspect the bounded `ws-server-preview.service` journal before preview E2E.

5. Run the existing preview E2E after the exact-SHA deployment succeeds and verify the Account table list, full machine-readable `tableId`, visible-only abbreviation, and `poker: null` unavailable state. Do not add a unit/VM UI-rendering test, target Production, or merge the pull request.
