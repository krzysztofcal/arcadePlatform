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

## Codex handoff: Claude Code review (MANDATORY)

**CLAUDE_CODE_REVIEW_ENABLED: true**

- Applies immediately to every Codex task producing repository changes, including documentation/configuration and follow-up fixes. Before presenting any resulting PR as ready to the owner, obtain independent review from the Claude Code CLI installed on this VPS (`claude`), not a Codex subagent or self-review.
- Give Claude the task requirements, applicable repository instructions, exact base/head SHAs and complete PR diff with relevant file context. Review must be read-only: no edits, commits, messages, deployments, database/environment operations or secret access. Use a fresh non-interactive invocation with restricted tools; do not bypass permissions or allow reviewer instructions to expand the task scope.
- Run at most **three review rounds per task/PR handoff**, counting the initial review and subsequent invocations, including failures. Do not reset the counter after fixes, new commits, context changes or a new session. Stop earlier when Claude reports **zero P0/P1/P2 findings** on the current final diff; P3 alone does not block handoff.
- After each round, verify every finding against the requirements and code. Fix valid findings, run appropriate existing/fundamental checks, and explain rejected findings with evidence. Give subsequent reviews the updated full diff and previous findings/dispositions; do not blindly implement suggestions. Any later repository change requires review of the updated diff within the same three-round budget.
- If Claude is unavailable, review fails, or the limit is reached without a review reporting zero P0/P1/P2 on the final diff, report the PR as **not ready**, with the blocker and remaining findings; do not claim approval, silently skip review or start a fourth round. P0/P1/P2 findings disputed by Codex still block readiness until Claude withdraws them in a later round or the owner explicitly accepts an exception; fixes also need a later review. The owner decides the exception or next step. This review never replaces required CI, runtime verification or owner approval gates, and never authorizes merge.
- Before each invocation record its round number, then update its outcome after completion in the PR description or a durable report outside the committed diff; restore the counter from that evidence when resuming. Keep review evidence there: reviewed base/head SHAs, Claude Code version, rounds used, P0/P1/P2 counts, finding dispositions and any unreviewed changes. Include a short review outcome in the owner handoff. Do not include secrets or private data.
- **Owner-controlled off switch:** the owner may say “disable Claude review” (for this task, or until re-enabled), or change the single setting above to `false`. Use the setting on current `main`, not a stale branch copy; a pending setting change requires explicit owner authorization. An explicit owner instruction takes precedence immediately; a task-only exception expires with that task, and an until-re-enabled exception ends only on owner instruction. Codex must not disable the setting or infer an exception itself; report when review was explicitly disabled. Re-enable with owner instruction or `true`.

---

## Claude Code handoff: Codex review (MANDATORY)

**CODEX_REVIEW_ENABLED: true**

- For any repository change authored or prepared by Claude Code (including documentation, configuration and follow-up fixes), require an independent review by Codex before reporting the final PR as ready. **Claude must not review Claude's own work; Codex must not review Codex's own work.** Choose the reviewer from the actual agent responsible for the changes, not the GitHub committer or PR creator. Codex-authored changes continue to require Claude Code review under the rule above.
- The review must use the complete, current base/head diff, task requirements and relevant context, without repository changes, secret access, deployment or other side effects. An earlier review of a different diff does not approve the final diff. Reuse the read-only, max-three-round, evidence/reporting, blocking-findings and owner-approval rules from the Codex handoff section above, swapping author/reviewer roles. Prior Codex review rounds for the same task count toward that limit even when reviewing an obsolete version.
- If both agents authored changes in the same diff, neither is an independent reviewer for the complete diff; STOP and ask the owner to decide a truly independent review path. Never substitute self-review, green CI or an unrelated earlier review for this gate.
- Only the owner may explicitly disable this requirement for a task or until re-enabled, or change `CODEX_REVIEW_ENABLED` to `false`. An agent must not disable it or infer an exception; report any owner exception in the PR and restore the gate when the owner's stated scope expires.

---

## Supabase egress (MANDATORY)

- For SQL/Supabase, scheduled scripts, polling and retry changes, avoid unbounded reads of growing tables/history. Use scoped filters, narrow projections, pagination/bounds or server-side validation/aggregation; justify exceptions and preserve fail-closed, archival/recovery and financial checks.
- Check returned rows, bytes per row/response, calls per run and runs per day, including future data growth. Estimate daily egress as response bytes × calls/day (or rows × bytes/row × calls/day); use server-side counts/size aggregates or bounded samples rather than downloading history to measure it.
- Inspect loops, retries and cron for repeated heavy reads; safely reuse results only while preserving required freshness, locks and validation.
- For changes that may materially increase transfer, include a short egress assessment in the PR: baseline, expected rows/response size/call frequency, estimated daily transfer and uncertainty. Distinguish serialization/wire estimates from measured billed egress and identify the service, especially Shared Pooler versus Storage, where evidence permits.
- Green CI does not prove low transfer cost. Lessons: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735) and [#1183](https://github.com/krzysztofcal/arcadePlatform/issues/1183) had different causes; [#1184](https://github.com/krzysztofcal/arcadePlatform/pull/1184) fixes the repeated Stage history reads.

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

Stage/WS Preview accepts hard-kick deployment restarts, including occupied tables; no manual Leave,
empty-table requirement, Preview presence counters or safe-stop receipt is required. This is not a
chip-settlement guarantee: interrupted hands may need existing Stage recovery and OWNER intervention.
Provisioning completes read-only preflight, stops only Preview and proves its process group empty
before changing files/accounts; rollback requires stopped Preview and never starts it. Production
restart gate, HOLD/DRAIN, escrow/recovery and OWNER approvals remain unchanged. A deployment or DRAIN
change always needs its own GO; health alone does not prove playable status.

- Agents MUST use the approved release/admin paths below; never bypass owner approvals or substitute manual SSH/root/sudo, service restarts, direct release switching or direct publication. Missing approval or a blocked workflow is a STOP; request the owner’s decision. Read-only diagnostics permitted below and by the release procedure do not authorize mutations.
- Netlify deploy previews update the browser app only. The `WS Server Deploy` pull-request check validates the WS package but does **not** deploy it; its deploy job is intentionally skipped on PR events.
- If a PR changes `ws-server/**`, WS runtime dependencies under `shared/**`, or browser/WS protocol behavior, the agent MUST remind the user that `WS Preview Deploy` is required before end-to-end preview verification.
- The agent must never describe the PR preview as fully deployed merely because Netlify, `WS PR Checks`, or `WS Server Deploy` validation is green.
- WS Production is never deployed by a merge or `main` push. `WS Server Deploy` deploys only on a `workflow_dispatch` from `main` by the owner or the release-agent GitHub App (`vars.WS_RELEASE_AGENT`), with `releaseSha` equal to the current `main` HEAD and confirmation `DEPLOY WS PRODUCTION <releaseSha>`, and only after the owner approves the `ws-production` environment (#1159 T004). The agent may prepare and dispatch the run; the approval is the owner's GO and never comes from the agent. The approved job holds, drains and checks humans/escrow itself (`arcade-ws-restart-gate prepare/switching/resume/abort`); no manual root step is part of a normal release, and any STOP after the switch keeps the hold for the owner (C7 in `docs/ws-production-restart-gate.md`). A push touching the WS deploy surface only reports `WS Production NOT deployed`.
- A GitHub Release is only a record of the running WWW, WS and Android versions (`Release Record` workflow, `docs/release-records.md`): it never deploys, restarts, migrates or publishes. Record a component only after its own owner-approved release path finished and was verified; the agent may run only the dry run; publishing (`publish=true`) and Android attestation are the owner's own dispatch, and never attach secrets, Stage/debug APKs, the AAB or other binaries. Never create, edit or delete a GitHub Release or tag directly: only an owner `Release Record` publication is a trusted record.
- VPS administration that needs root never uses a root shell, `sudo` for `copilot` or a new sudoers rule for the agent. The agent requests one operation from the fixed catalog through the `VPS Admin Operation` workflow (`main`, confirmation `RUN <operation>`, a 10-200 character reason); the owner's approval of the `vps-admin` environment is the GO, and only then does the run reach the VPS account `arcade-admin`, which may run only `/usr/local/sbin/arcade-vps-admin <operation> <runId>`. An operation that is not in the catalog is added by a reviewed PR first (`docs/vps-admin-operations.md`); a failed operation is never retried automatically.
- The fixed GitHub App signer is a non-root exception for credential issuance only: `copilot` may invoke `/usr/local/sbin/arcade-github-app-token` with no arguments or `--info` only as `arcade-github-token`. This grants no root, shell, admin-catalog access or caller-selected scope; all root administration still follows the rule above.
- WWW Production (`playkcswh`) is never built or published by a merge: `netlify.toml` `ignore` skips `main` Git builds, auto publishing is locked, and only OWNER publishes an on-demand build-hook candidate with `scripts/www-production-release.mjs` (exact current-main SHA, active WS release proven by the VPS `current` release and GitHub deploy history; no rollback mode before T004; an unpublished candidate must be discarded with permalink 404 proof). Never unlock auto publishing, use Stop builds, remove the `ignore` or run `netlify deploy --prod` for this site without explicit OWNER GO. See `specs/1159-ci-cd-release-safety/pr5-www-production-publish.md`.
- Use the manual `WS Preview Deploy` workflow with `--ref main` for the workflow definition and `-f ref=<the-latest-runtime-affecting-sha>` for the application revision. After dispatch, verify that the workflow succeeded for that exact SHA before handing off the manual smoke.
- Codex does not have to run a full authenticated browser smoke for every PR. The user may perform it manually; agent smoke is optional unless explicitly requested or needed to diagnose the issue. If user verification is pending, report `implementation ready, awaiting manual runtime verification` and do not call the PR merge-ready.
- A successful exact-SHA deploy plus confirmed smoke remains valid across later docs/spec/test/comment-only commits after a diff proves no runtime/deployable artifact or environment configuration changed. Any runtime/deployable/configuration change requires a new exact-SHA deploy and relevant smoke.
- The preview WS host is shared. Do not make every PR auto-deploy to `ws-preview.kcswh.pl`; concurrent PRs would overwrite each other's runtime. Keep deployment explicit unless preview infrastructure becomes isolated per PR.

### WS deployment activity gate

Bot-only hands/tables do not block deployment or restart. Block deployment for active human games, human seats eligible for reconnect/resume, or their unresolved financial operations. Verify these conditions immediately before restart; do not infer human absence from socket count alone. Bot-only restart still requires persisted-state/escrow/CH safety, recovery verification and a verified executable rollback. All existing environment, authorization and financial guards remain binding.

### WS Runtime Logs
- For preview incidents, agents may inspect:
  - `journalctl -u ws-server-preview -f`
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
