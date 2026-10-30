# agents.md

## 🎯 Purpose
Defines how agents (Codex / AI) should operate in the Arcade Platform repo.

This is a real-time gaming platform (poker + arcade), not a typical CRUD app.

---

## 🧠 Core Rules (CRITICAL)

1. **Live GitHub repository is the primary source of truth**
   - Treat the live GitHub repository as authoritative for current code.
   - Use the current checkout and branch to inspect the change under review,
     and verify current behavior against the live repository when needed.
   - `arcadePlatform-repomix*.txt` is only a historical/offline snapshot and
     fallback for context when the live repository is unavailable.
   - If the live repository and a snapshot disagree, the live repository wins.

2. **Keep solutions simple**
   - No over-engineering
   - No unnecessary abstractions

3. **Do not blindly generate new code**
   - Prefer modifying existing files
   - Follow existing patterns

4. **JSP compatibility required**
   - No browser modules/imports
   - Use global JS or IIFE

5. **Logging**
   - NEVER use `console.log`
   - ALWAYS use `klog(...)`

---

## 🏗️ Architecture Overview

### Frontend
- Plain JS
- JSP-rendered pages
- CSS in `/css/`

### Backend
- Netlify functions (`/netlify/functions`)
- Shared logic in `_shared/`

### Realtime Layer (CRITICAL)
- `ws-server/` is authoritative
- Handles:
  - game state
  - table lifecycle
  - reconnect
- DB is NOT source of truth

### WS Preview Deploy Gate (CRITICAL)
- Netlify deploy previews update the browser app only. The `WS Server Deploy` pull-request check validates the WS package but does **not** deploy it; its deploy job is intentionally skipped on PR events.
- If a PR changes `ws-server/**`, WS runtime dependencies under `shared/**`, or browser/WS protocol behavior, the agent MUST remind the user that `WS Preview Deploy` is required before end-to-end preview verification.
- The agent must never describe the PR preview as fully deployed merely because Netlify, `WS PR Checks`, or `WS Server Deploy` validation is green.
- WS Production is never deployed by a merge or `main` push. `WS Server Deploy` deploys only on an OWNER `workflow_dispatch` from `main` with `releaseSha` equal to the current `main` HEAD and confirmation `DEPLOY WS PRODUCTION <releaseSha>`; the operator completes the existing active-human/escrow restart preconditions first. A push touching the WS deploy surface only reports `WS Production NOT deployed`.
- WWW Production (`playkcswh`) is never built or published by a merge: `netlify.toml` `ignore` skips `main` Git builds, auto publishing is locked, and only OWNER publishes an on-demand build-hook candidate with `scripts/www-production-release.mjs` (exact current-main SHA, active WS release proven by the VPS `current` release and GitHub deploy history; no rollback mode before T004; an unpublished candidate must be discarded with permalink 404 proof). Never unlock auto publishing, use Stop builds, remove the `ignore` or run `netlify deploy --prod` for this site without explicit OWNER GO. See `specs/1159-ci-cd-release-safety/pr5-www-production-publish.md`.
- Use the manual `WS Preview Deploy` workflow with `--ref main` for the workflow definition and `-f ref=<the-latest-runtime-affecting-sha>` for the application revision. After dispatch, verify that the workflow succeeded for that exact SHA before handing off the manual smoke.
- Codex does not have to run a full authenticated browser smoke for every PR. The user may perform it manually; agent smoke is optional unless explicitly requested or needed to diagnose the issue. If user verification is pending, report `implementation ready, awaiting manual runtime verification` and do not call the PR merge-ready.
- A successful exact-SHA deploy plus confirmed smoke remains valid across later docs/spec/test/comment-only commits after a diff proves no runtime/deployable artifact or environment configuration changed. Any runtime/deployable/configuration change requires a new exact-SHA deploy and relevant smoke.
- The preview WS host is shared. Do not make every PR auto-deploy to `ws-preview.kcswh.pl`; concurrent PRs would overwrite each other's runtime. Keep deployment explicit unless preview infrastructure becomes isolated per PR.

### WS Runtime Logs
- For preview incidents, agents may inspect:
  - `sudo journalctl -u ws-server-preview -f`
  - `journalctl -u ws-server-preview.service`
- For production WS incidents, agents may inspect:
  - `journalctl -u ws-server.service`
- When debugging a specific poker table, filter by `tableId` and correlate `ws_state_persist_*`, `ws_settled_rollover_*`, `ws_bot_autoplay_*`, `ws_table_janitor_*`, and cleanup logs with `poker_state`, `poker_actions`, `poker_seats`, and `poker_tables`.

### Explicit Stage migrations
- PR creation, Draft/Ready and synchronize never authorize or execute shared Stage SQL. Keep ordinary DB Migration Check read-only/local.
- Only an explicitly authorized main-definition DB Stage Apply PR dispatch may apply the exact approved source SHA/file/hash set. Executor comes from trusted main; source PR supplies only approved SQL data, never runner code.
- Inspect must not create metadata/backfill hashes. DDL/version/hash receipts commit atomically; wrong identity/history, additional pending, locks or missing confirmation fail closed. No automatic retry or schema rollback.
- Applied migrations are immutable. Stage apply, Production equivalents and feature activation require separate explicit scope; a green PR is not proof of applied schema.

---

## 🧩 Agent Roles

### Architect
- Decide correct layer:
  - UI vs Netlify vs WS
- Ensure consistency with WS runtime

### Implementer
- Modify existing code
- Keep changes minimal

### Debugger
- Trace flow:
  UI → WS → runtime → shared logic
- Look for:
  - state mismatch
  - stale UI
  - race conditions

### Reviewer
- Validate:
  - simplicity
  - no regressions
  - consistency with patterns

---

## 🧪 Testing Policy (IMPORTANT)

Only fundamental, deterministic tests for critical logic are required.

### Optional real-device validation

- BrowserStack is a targeted diagnostic/verification tool for browser- or device-specific behavior; see [the real-device workflow](docs/browserstack-real-device-testing.md).
- It does not replace fundamental tests or the exact-SHA WS Preview Deploy gate, and is not a universal PR requirement.
- Do not create broad UI/CSS/layout suites because BrowserStack is available. Prefer temporary ad-hoc tooling outside the repo unless the current spec explicitly requires maintained automation.

### ✅ When to write tests
- Poker engine logic (reducers, state transitions)
- WebSocket runtime behavior
- Table lifecycle (create / close / cleanup)
- Reconnect / resync logic
- Backend business rules

### ❌ When NOT to write tests
- UI rendering
- CSS / layout
- Simple glue code
- JSP views

### Rules
- Before `$speckit-implement`, Constitution Check must inspect planned test tasks and correct any prohibited requirements in spec/plan/tasks. TDD/test-first and generated Spec Kit tasks cannot override fundamental-tests-only policy; verify UI presentation through existing preview/E2E/manual preview where appropriate.
- Prefer extending existing test files
- Keep tests deterministic
- Focus on edge cases and failure scenarios
- Do NOT introduce heavy test frameworks
- Do NOT add broad, speculative, UI, CSS, layout, JSP-view, or simple-glue
  test suites

---

## 📦 Speckit Mode (for plans)

When writing a plan:
- Use file paths
- Use function names
- Be concise
- DO NOT include git commands
- DO NOT write full code unless trivial
- `$speckit-implement` MUST NOT create or modify generic ignore files,
  tooling/configuration files, dependencies, or perform setup cleanup unless
  the current specification, plan, and tasks explicitly require that exact
  change

---

## ⚠️ High-Risk Areas

Extra caution required:

- WebSocket reconnect
- Poker state transitions
- Table lifecycle
- UI ↔ WS sync
- Global CSS

---

## 🚫 Anti-Patterns

- Rewriting working code
- Adding frameworks
- Creating duplicate logic paths
- Treating DB as source of truth for poker
- Using console.log

---

## ✅ Definition of Done

Task is complete when:

- Works with existing architecture
- No regressions
- WS state and UI are consistent
- Critical paths are covered with tests
- Code is simple and readable
- For WS-affecting work, deploy the exact latest runtime-affecting SHA with `WS Preview Deploy`; full authenticated smoke may be performed by the user, and pending user verification must be reported explicitly. Deploy Preview → WS Preview calls remain the required manual scenario before calling the PR merge-ready; green CI does not prove configuration/integration.
- Docs/spec/test/comment-only commits after a verified runtime SHA do not require another WS deploy or smoke when a diff proves no runtime/deployable artifact or environment configuration changed. Runtime/deployable/configuration changes require a new exact-SHA deploy and relevant scenario. Stage smoke may be user-run and should not be broad or redundant unless requested or needed for diagnosis. Production requires separate explicit authorization.
- Never mark a PR READY/merge-ready with missing required runtime evidence or a failing manual smoke.
