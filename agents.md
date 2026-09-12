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
- Use the manual `WS Preview Deploy` workflow with `--ref main` for the workflow definition and `-f ref=<pr-branch-or-sha>` for the application revision. After dispatch, verify that the workflow succeeded for the intended ref before asking the user to retest.
- The preview WS host is shared. Do not make every PR auto-deploy to `ws-preview.kcswh.pl`; concurrent PRs would overwrite each other's runtime. Keep deployment explicit unless preview infrastructure becomes isolated per PR.

### WS Runtime Logs
- For preview incidents, agents may inspect:
  - `sudo journalctl -u ws-server-preview -f`
  - `journalctl -u ws-server-preview.service`
- For production WS incidents, agents may inspect:
  - `journalctl -u ws-server.service`
- When debugging a specific poker table, filter by `tableId` and correlate `ws_state_persist_*`, `ws_settled_rollover_*`, `ws_bot_autoplay_*`, `ws_table_janitor_*`, and cleanup logs with `poker_state`, `poker_actions`, `poker_seats`, and `poker_tables`.

### Intentional automatic Stage migrations
- A same-repository PR touching `supabase/migrations/**` can trigger `DB Stage Apply PR` and mutate shared Stage; this is not a read-only check.
- Agents may intentionally use automatic Stage apply without a separate GO for each ordinary migration. Before push/PR, spec/plan/tasks must explicitly declare that intended shared Stage effect.
- Never include migrations accidentally. Applied Stage migrations are immutable; corrections use new, forward-only migrations. Production still requires separate explicit authorization.

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
- For WS-affecting work, exact-final-HEAD `WS Preview Deploy` and real preview verification are required. Deploy Preview → WS Preview calls must be exercised between the actual environments; green CI does not prove configuration/integration.
- Changes depending on Stage DB/runtime require safe Stage smoke/read-only validation or an explicit reason Stage mutation/testing is unnecessary. Verify only relevant targets; not every PR needs all Stage deployments. Production requires separate explicit authorization.
- Never mark a PR READY/merge-ready with missing required runtime evidence or a failing manual smoke.
