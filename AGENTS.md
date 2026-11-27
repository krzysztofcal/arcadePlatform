# AGENTS.md — AI Agent Guidelines & Operations

## 🎯 Purpose
Defines how agents (Codex / AI / Antigravity / Claude Code) should operate in the Arcade Platform repo.

Before starting any task in this repository, you MUST read and comply with:
1. This file (`AGENTS.md`) — primary source of detailed development, runtime, logging, and deployment rules.
2. `skills.md` — codebase architecture and directory mapping.
3. `.specify/memory/constitution.md` — binding project constitution and safety gates.

This is a real-time gaming platform (poker + arcade), not a typical CRUD app.

---

## 🔒 Deployment & Administrative Authority

> **Binding Operational Principle**:
> Wszystkie wdrożenia i operacje administracyjne Arcade Hub muszą korzystać wyłącznie z zatwierdzonych dla danego komponentu procedur. Dostęp agenta do GitHub nie stanowi autoryzacji do deploymentu Production. Każde wymagane OWNER GO pozostaje obowiązkowe. Zabronione jest obchodzenie procedur przez agentów przez ręczne SSH, sudo, root, bezpośredni restart, publikację lub alternatywne skrypty (co nie wyklucza istniejącej awaryjnej procedury odzyskiwania przez OWNERA — C7 w `docs/ws-production-restart-gate.md`).

- **Agent GitHub access is NOT authorization for Production deployment.**
- Every required **OWNER GO** remains strictly mandatory.
- Never bypass procedures via manual SSH, sudo, root, direct service restart, Netlify publish, or ad-hoc scripts (does not preclude OWNER emergency recovery C7).

### Official Approved Pathways
- **WS Production Deploy**: `.github/workflows/ws-server-deploy.yml` (exact SHA, GitHub App dispatch, OWNER approval in `ws-production`).
- **WWW Production Release**: `Create WWW Candidate` by OWNER or, after T007 activation, `arcade-code-agent[bot]` only following explicit OWNER conversation GO; `Publish WWW Production` stays OWNER-only with `www-production` approval. See [WWW release SOP](docs/www-production-release.md). Both reuse `scripts/www-production-release.mjs`; the existing OWNER manual procedure remains until validated cutover.
- **VPS Admin Operations**: `.github/workflows/vps-admin-operation.yml` (helper catalog, OWNER approval in `vps-admin`).
- **DB Stage Migrations**: `.github/workflows/db-stage-apply-pr.yml` (wymaga jawnego `workflow_dispatch` z `main`, operacja `apply` uruchamiana przez OWNERA dla dokładnego zatwierdzonego `sourceSha` i zestawu migracji w środowisku `stage-automation`).
- **Release Record**: `.github/workflows/release-record.yml` (rejestr wersji; `publish=true` requires direct OWNER dispatch or the verified OWNER WWW publication chain; never deploys).
- **Android / Google Play**: Separate publishing track with independent review and signing.

### OWNER device for manual steps
- The OWNER performs OWNER-only manual steps (Netlify discard/publish scripts, `gh`, Supabase CLI) from an **Android phone in Termux**, not a desktop. `netlify`, `supabase`, `gh` and `git` are already logged in there; Node may need `pkg install nodejs`. Mobile GitHub UI covers workflow dispatch and Environment approval.
- Write OWNER instructions as copy-paste Termux commands: fetch single scripts from `main` with `gh api -H "Accept: application/vnd.github.raw" "repos/krzysztofcal/arcadePlatform/contents/<path>?ref=main"` instead of a full clone; read credentials from the logged-in CLI config without echoing them; end by unsetting variables and removing temporary files.

---

## 🔀 GitHub PR Merge Policy (Always Binding)

- **NEVER merge a pull request yourself.**
- You may create PRs, run checks, and prepare them for review/merge.
- Only merge if the user explicitly commands you to merge in that specific task.

### Agent GitHub identity (#1229)

- Claude Code, Codex and Antigravity act on GitHub only as the GitHub App `arcade-code-agent[bot]` (#1159): `git push` through the global credential helper, `gh` through `~/.arcade-code-agent/bin/gh` (`ghx`) with `GH_CONFIG_DIR=/home/copilot/.arcade-code-agent/gh`. Never use the OWNER's `gh` login, OWNER GitHub connectors (claude.ai / ChatGPT) or any other OWNER credential; if the App token is unavailable, stop and report — there is no fallback. This routing is not credential isolation: agents share the OWNER's Unix user, so OWNER logins on the VPS stay technically reachable (see `specs/1229-agent-github-identity/`); never use or work around them.
- Agents may implement, test, commit, push feature branches and open or update PRs as the App. Push to `main` and force push are forbidden.
- Merging into `main` requires the code owner `@krzysztofcal`: an OWNER approval of an agent PR (a new push dismisses it), or the `pull_request`-only bypass of the user `krzysztofcal` for OWNER PRs. Agents never approve, bypass or merge on the OWNER's behalf. Activation of this rule and OWNER credential changes follow `specs/1229-agent-github-identity/`.

### Netlify Deploy Preview

- PRs with no needed WWW testing MUST by default have `[skip netlify]` in the PR title from creation.
- Build a Deploy Preview when actual WWW, UI or Netlify function testing is needed; relevant required validation uses exact PR HEAD.
- Never skip required browser verification just to save a build.
- **Preview feature flags (OWNER standing GO, 2026-11-27):** when a Deploy Preview test needs a feature flag (for example `UGC_SAFETY_ENABLED`, `GOOGLE_PHOTO_IMPORT_ENABLED`, `POKER_TABLE_PHOTO_ENABLED`), the agent sets its value itself in the Netlify `deploy-preview` context of the WWW site `playkcswh`, without asking the OWNER. Steps:
  - Confirm that the account and `site_id` belong to `playkcswh`, the site that builds the tested PR's preview.
  - Read the variable first and record the values of all its contexts. If the read fails or does not show the full state, stop before writing and report to the OWNER.
  - Change only the `deploy-preview` value with the Netlify API endpoint for one context value: `PATCH /api/v1/accounts/<account>/env/<KEY>?site_id=<site>` with `{"context":"deploy-preview","value":"<value the test needs>"}` (for example `"1"` to enable).
  - Read it again: the `deploy-preview` value must equal the value the test needs and every other context must match the recorded values. On any mismatch or failed read, stop and report the state to the OWNER.
  - Rebuild the preview, because functions read the value at build time: push to the tested PR's branch, or retry that PR's `deploy-preview` deploy for its current HEAD SHA. Never use a site build hook or any Production/Candidate path. If the right deploy cannot be identified, stop and report to the OWNER.
  - Report the change to the OWNER.
  - Do not use a whole-variable upsert (such as the Netlify MCP `manage-env-vars` upsert): it may replace the values of other contexts.
  - This GO covers only the flag value in that context. It never covers other contexts (including `branch-deploy` and `production`), secrets, other Netlify settings or a Production publish. A feature activation that needs its own scope, and tests that write shared Stage data, JOIN tables or change the ledger, still need their own GO.

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

## Task workspace lifecycle

- Reuse the task's existing isolated checkout across reviews and follow-ups; do not create another worktree for each round.
- **New VPS tasks (Codex, Claude Code and Antigravity):** every NEW checkout/worktree must be a direct child of the host's verified workspace root: `/mnt/HC_Volume_107462648/copilot-work` on current Hetzner, or `/mnt/agent-work/copilot-work` after separate OWNER-approved filesystem provisioning per `docs/agent-work-directories.md`. Before creation, run `node scripts/ops/agent-workdir-preflight.mjs <unique-task-name>` from a trusted current checkout and use its successful stdout as the explicit Git destination. Any nonzero exit means STOP; never fall back to `/home/copilot/work`, `/tmp`, `.worktrees`, `.claude/worktrees` or another root-disk path. Recheck immediately before each creation; the preflight never creates a directory or mounts a volume.
- Before heavy agent launches/builds/tests, use the reviewed current `agent-workdir-preflight.mjs --check` for advisory capacity reporting. Root emits WARN at 85%, CRITICAL at 90% or below 4 GiB free; Volume below 4 GiB emits CRITICAL. Missing capacity metrics emit WARN. Capacity never blocks allocation or continued work. Fail closed only on unsafe/unverifiable destinations for new workspace writes, without root fallback; do not interrupt existing tasks, sessions, builds or services. Prefer task-scoped TMPDIR/cache and explicit verified-filesystem artifact outputs per `docs/agent-work-directories.md`; do not redirect HOME or session/config stores.
- Reuse an existing task checkout at its original location, including legacy root-disk paths; do not move or recreate it to comply with the new-task rule. If that checkout is unavailable, STOP and report it. Verified-filesystem placement applies to new allocation; the pre-heavy `--check` still applies to legacy task resumes.
- Keep using native Git (`git worktree add` / `git clone`) with an explicit checked destination. Use a native agent worktree tool only if it can select and honor that destination; otherwise use Git directly. Do not invoke an automatic default worktree/clone mode that allocates outside the verified workspace root before reading these instructions. For Antigravity delegation, pass the already selected task worktree to the existing `agy-implement.sh --worktree`; installed path/hash pins must be reviewed for the host and do not override this repository rule. See [agent work directories](docs/agent-work-directories.md) for the inventory, commands and launcher limitations.
- This is a checkout placement policy, not migration or cleanup authorization. Do not move/delete existing checkouts, sessions, caches, credentials, Git common directories or Production data; do not change global HOME/TMPDIR, agent settings, services or GitHub identity to implement it.
- At task handoff, identify any retained worktree and why it is still needed. Once the work is merged, propose its cleanup through the approved procedure after checking tracked, untracked and ignored files and process/dependency use. Preserve branches and shared Git history. Missing evidence or approval means retain it; age alone never authorizes removal.
- Tests must clean only their own newly allocated synthetic fixtures when the test process finishes, including assertion failure. Do not apply test cleanup to operational ledger evidence, existing temporary directories, sessions, secrets or backups. Forced termination can leave fixtures behind; it does not authorize a periodic prefix-wide purge.

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

## Application dialogs (mandatory)

All application-owned confirmations, alerts, prompts and popups MUST use custom, accessible UI components consistent with Arcade Hub's design system. Do not use `window.alert()`, `window.confirm()` or `window.prompt()` for application UX. Reuse existing dialog components before creating new ones. Native browser/OS security and permission prompts are exempt.

This applies to new and modified code. It does not require a wholesale rewrite of historical dialogs.

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
- A GitHub Release is only a record of the running WWW, WS and Android versions (`Release Record` workflow, `docs/release-records.md`): it never deploys, restarts, migrates or publishes. Record a component only after its own owner-approved release path finished and was verified; the agent may run only the dry run; publishing (`publish=true`) requires the owner's own dispatch or the narrowly verified OWNER WWW publication chain; Android attestation remains direct OWNER-only, and never attach secrets, Stage/debug APKs, the AAB or other binaries. Never create, edit or delete a GitHub Release or tag directly: only an owner `Release Record` publication is a trusted record.
- VPS administration that needs root never uses a root shell, `sudo` for `copilot` or a new sudoers rule for the agent. The agent requests one operation from the fixed catalog through the `VPS Admin Operation` workflow (`main`, confirmation `RUN <operation>`, a 10-200 character reason); the owner's approval of the `vps-admin` environment is the GO, and only then does the run reach the VPS account `arcade-admin`, which may run only `/usr/local/sbin/arcade-vps-admin <operation> <runId>`. An operation that is not in the catalog is added by a reviewed PR first (`docs/vps-admin-operations.md`); a failed operation is never retried automatically.
- The fixed GitHub App signer is a non-root exception for credential issuance only: `copilot` may invoke `/usr/local/sbin/arcade-github-app-token` with no arguments or `--info` only as `arcade-github-token`. This grants no root, shell, admin-catalog access or caller-selected scope; all root administration still follows the rule above.
- WWW Production (`playkcswh`) is never built or published by a merge: `netlify.toml` `ignore` skips `main` Git builds, auto publishing is locked, and only the approved Candidate workflow (OWNER, or the separately activated T007 App path after explicit conversation GO) may create an on-demand build-hook candidate; publication stays OWNER-only through `scripts/www-production-release.mjs` and the protected Publish workflow (exact current-main SHA, active WS release proven by the VPS `current` release and GitHub deploy history; no rollback mode before T004; an unpublished candidate must be discarded with permalink 404 proof). Never unlock auto publishing, use Stop builds, remove the `ignore` or run `netlify deploy --prod` for this site without explicit OWNER GO. See `specs/1159-ci-cd-release-safety/pr5-www-production-publish.md`.
- Before dispatching `WS Preview Deploy`, the agent MUST receive explicit OWNER GO in the conversation for the exact application SHA. The agent uses only existing `ghx` as `arcade-code-agent[bot]` after separate OWNER activation of `WS_PREVIEW_AGENT_DEPLOY_ENABLED=true` and with `WS_RELEASE_AGENT=arcade-code-agent[bot]`. Activation and dispatch require independently verified `ws-preview` protection (sole reviewer `krzysztofcal`, self-review allowed, admin bypass disabled, only branch `main`). Dispatch once with `--ref main`, `-f ref=<full SHA>` and `-f xpRedisVersion=3`. Never rerun or fall back to OWNER credentials. Correlate the run by both actors, attempt 1 and the exact application SHA. Report RUN ID and URL when `deploy` is waiting for OWNER approval in GitHub. The agent never approves. After OWNER approval, verify deploy/health success and report the outcome. See `docs/poker-deployment.md`.
- Codex does not have to run a full authenticated browser smoke for every PR. The user may perform it manually; agent smoke is optional unless explicitly requested or needed to diagnose the issue. If user verification is pending, report `implementation ready, awaiting manual runtime verification` and do not call the PR merge-ready.
- A successful exact-SHA deploy plus confirmed smoke remains valid across later docs/spec/test/comment-only commits after a diff proves no runtime/deployable artifact or environment configuration changed. Any runtime/deployable/configuration change requires a new exact-SHA deploy and relevant smoke.
- The preview WS host is shared. Do not make every PR auto-deploy to `ws-preview.kcswh.pl`; concurrent PRs would overwrite each other's runtime. Keep deployment explicit unless preview infrastructure becomes isolated per PR.

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
- Every AI review (Claude Code, Codex, Antigravity) follows [REVIEW.md](REVIEW.md): the five finding questions, impact-based severity, accepted OWNER trade-offs, and proportional fixes. Review tooling passes `REVIEW.md` to the reviewer with the material under review.

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

### WWW release automation (#1254)

- Implementation/merge never authorizes activation, a build hook, candidate creation or publication. First activation/run needs separate OWNER GO.
- Candidate admits only matching OWNER or `arcade-code-agent[bot]` actor/triggering_actor, exact current main and attempt 1. OWNER uses protected `www-candidate`; the disabled-by-default T007 agent path uses separately audited `www-candidate-agent`, main only, after explicit activation/risk GO. Never reuse deployment SSH keys. `www-production` stays OWNER-only and requires actual OWNER approval; never remove its protection.
- Failed/cancelled/abandoned/stale candidates use only the existing guarded discard with API + permalink 404 proof. Unknown hook outcomes, interrupted runners or uncertain restore mean explicit STOP and owner reconciliation; never guess, retry restore or delete published candidates.
- Automatic Release Record is restricted to the successful approved `www-publish.yml` chain, with verified LIVE receipt. Agents may dispatch Candidate only under the T007 operating procedure below; they must never dispatch Publish or use a generic reusable-workflow bypass. Existing direct Release Record remains OWNER-only for publication.

### Agent Candidate operating rule (T007 / #1268)

Codex, Claude Code and Antigravity may request Candidate only after explicit OWNER GO in the current conversation
and separate activation of the audited main-only agent Environment. No automatic Candidate on merge/CI. Use only
existing `ghx` as `arcade-code-agent[bot]`; no OWNER credential fallback or local Netlify token/hook call.
Read current main, the published deploy commit/lock, active Candidate/Publish runs and existing eligible candidates first;
if exact main is already LIVE, report that fact and STOP unless OWNER explicitly requested a rebuild; queue conflicts or an
existing unpublished candidate mean STOP for verified reuse/reconciliation, never silently build a duplicate.
Dispatch `www-candidate.yml --ref main -f sha=<exact-current-main>` once, wait boundedly for completion and verify
run identity/SHA/attempt, authentic unexpired artifact, `candidate_ready`, matching `dry_run_pass` and
`candidate_static_verified`, Netlify target/commit/unpublished/lock and WS evidence before returning its immutable
permalink plus concise PASS evidence. Recheck current main and current Netlify metadata at handoff; drift means STOP.
Missing/failed/ambiguous evidence means STOP without guessed URLs or reruns; inspect guarded-discard + 404 receipts.
Never approve an Environment, dispatch Publish, restore/publish Netlify, or expand credential permissions. Chat GO is
an operating rule, not cryptographic authorization from GitHub. Audit limitations/activation GO are in the WWW SOP.
