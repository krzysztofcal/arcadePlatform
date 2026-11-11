# 1229 — Separate OWNER identity from AI agents; OWNER CODEOWNER review for `main`

Issue: #1229. Reuses #1159 (GitHub App `arcade-code-agent`, `ghx`, git credential helper, root-owned signer).

## Requirements
- R1 Claude Code, Codex and Antigravity perform normal GitHub writes (push to feature branches, PRs, comments,
  Actions operations they are allowed to request) as `arcade-code-agent[bot]`, never as `@krzysztofcal`.
- R2 In the normal agent workflow (the agents' own CLIs with their configured settings) GitHub auth uses only the
  App and fails closed when the App token is unavailable; there is no fallback to OWNER credentials.
- R3 The OWNER GitHub CLI token is removed from the VPS only after a separate OWNER GO and a verified replacement
  path; the OWNER keeps an independent login/recovery channel (browser, Termux).
- R3a Residual (not closed by this issue): the OWNER's personal claude.ai/ChatGPT logins on the VPS keep their GitHub
  connectors reachable by any process of the shared Unix user. R2 is therefore a workflow guarantee, not credential
  isolation. T003 needs the OWNER's informed acceptance of this residual (tasks.md T002-O A).
- R4 Agent PRs into `main` need an approval by the code owner `@krzysztofcal`; a new push dismisses it; the App
  cannot approve as code owner or bypass. OWNER PRs cannot be self-approved; only the user `krzysztofcal` may merge
  them through a `pull_request`-only bypass. Existing required checks, no-force-push/deletion rules and deploy gates are unchanged.
- R5 No new App, service, credential infrastructure, runner or approval bot. Ruleset activation and credential changes
  need separate OWNER GO; no merge or deploy.

## Non-goals
Production environment reviewer policies (`production-ledger`, `production-poker-refill`), App scopes, signer
custody, Docker/AppArmor, #1228 delegation content.
