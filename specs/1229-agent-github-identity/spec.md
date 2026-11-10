# 1229 — Separate OWNER identity from AI agents; OWNER CODEOWNER review for `main`

Issue: #1229. Reuses #1159 (GitHub App `arcade-code-agent`, `ghx`, git credential helper, root-owned signer).

## Requirements
- R1 Claude Code, Codex and Antigravity perform normal GitHub writes (push to feature branches, PRs, comments,
  Actions operations they are allowed to request) as `arcade-code-agent[bot]`, never as `@krzysztofcal`.
- R2 No fallback to OWNER credentials: agent GitHub auth fails closed when the App token is unavailable.
- R3 OWNER credentials are removed from the agent-accessible runtime only after a separate OWNER GO and a verified
  replacement path; the OWNER keeps an independent login/recovery channel.
- R4 Agent PRs into `main` need an approval by the code owner `@krzysztofcal`; a new push dismisses it; agents cannot
  approve for the OWNER or bypass. OWNER PRs cannot be self-approved; the OWNER alone may merge them through a
  `pull_request`-only bypass. Existing required checks, no-force-push/deletion rules and deploy gates are unchanged.
- R5 No new App, service, credential infrastructure, runner or approval bot. Ruleset activation and credential changes
  need separate OWNER GO; no merge or deploy.

## Non-goals
Production environment reviewer policies (`production-ledger`, `production-poker-refill`), App scopes, signer
custody, Docker/AppArmor, #1228 delegation content.
