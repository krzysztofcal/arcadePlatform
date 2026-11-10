# 1229 — Tasks

- [x] T001 Read-only identity and ruleset audit → `audit.md`.
- [x] T002 Agent routing to the App with fail-closed `gh` for Claude Code, Codex and Antigravity (local configs; backups kept). Verified: fresh Claude Code session `which gh` → App wrapper, plain `gh` not logged in; Codex and agy child environments the same; git push already App-only.
- [ ] T002-O OWNER credential removal from the VPS agent runtime — **OWNER GO** (draft, pending independent review):
  A. Personal connectors stay connected; only the VPS agent clients stop using them:
     1. Claude Code (VPS): already `permissions.deny: ["mcp__claude_ai_github"]` (claude.ai web/mobile unaffected).
     2. Codex (VPS): add `[features]` `apps = false` to `~/.codex/config.toml` and remove the two
        `apps.connector_76869538009648d5b282a4bb21c3d157` auto-approve blocks (ChatGPT itself unaffected).
     3. Limitation (not closable without changing personal integrations): both switches are enforced by the agent
        programs, but every agent runs as the same Unix user that holds the OWNER's Claude and ChatGPT logins
        (`~/.claude/.credentials.json`, `~/.codex/auth.json`). A deliberately misbehaving agent could still reach the
        connectors, and so act on GitHub as the OWNER (including PR approval), outside these clients. Options:
        accept this residual; or restrict the connector's GitHub repository access so it excludes this repository
        (also outside the VPS); or use separate non-OWNER Claude/ChatGPT accounts for the VPS (out of scope).
  B. GitHub CLI token (`~/.config/gh/hosts.yml`), without losing the OWNER's own access:
     1. Pre-check: github.com in the browser (2FA) and Termux `gh auth status` both work.
     2. VPS, OWNER's own shell (not an agent session):
        `GH_CONFIG_DIR=$HOME/.config/gh gh auth logout -h github.com -u krzysztofcal`.
        This removes the token from the VPS only. It does not invalidate it, so Termux is unaffected.
     3. Verify: `~/.config/gh/hosts.yml` has no `oauth_token`; `ghx api repos/krzysztofcal/arcadePlatform --jq .full_name`
        and agent pushes still work (git uses only the App helper).
     4. Optional hardening: revoking "GitHub CLI" under Authorized OAuth Apps invalidates **every** GitHub CLI token,
        Termux included. If chosen, do it after step 2 and re-login Termux at once with `gh auth login --web`
        (the browser is the independent channel). The 2026-11-10 audit found the token in no agent logs or transcripts,
        but agent processes could read it.
     5. Do not log `gh` in again on the VPS; OWNER actions go through the browser/Termux.
     Rollback: `gh auth login` on the VPS (OWNER only).
     The #1159 quarantine catalog is not needed: the file holds a revocable token, so logout is the simpler, existing
     path. A root-custody copy would need a catalog entry like `github-app-key-quarantine` (reviewed PR + `vps-admin`
     approval).
- [ ] T003 Ruleset activation — **OWNER GO**, after T002-O. Scope: it binds agents acting through the App and prevents mistakes; while T002-O A.3 holds it is not proof against a deliberately misbehaving agent. GitHub UI: Settings → Rules → Rulesets → New branch ruleset: name `main requires OWNER code owner review`; Enforcement **Active**; Bypass list: **Repository admin**, mode **For pull requests only**; Target: include `main`; rule **Require a pull request before merging** with Required approvals **1**, **Dismiss stale pull request approvals when new commits are pushed**, **Require review from Code Owners**. Nothing else; do not edit rulesets 12958021/12385707. Equivalent API from the OWNER channel: `gh api -X POST repos/krzysztofcal/arcadePlatform/rulesets --input main-owner-review.ruleset.json`. Read-back: the new ruleset has exactly one bypass actor `RepositoryRole 5 / pull_request`. Rollback: delete the new ruleset.
- [ ] T004 Acceptance (NOT RUN until T003):
  1. An App-authored PR (e.g. the #1229 PR) with green checks shows merge **blocked** until `@krzysztofcal` approves; `ghx pr merge` fails; an App review does not unblock it.
  2. A new push to that PR dismisses the OWNER approval.
  3. An OWNER-authored PR cannot be self-approved; the OWNER can merge it with the bypass option; `ghx pr merge` cannot.
  4. Required checks of 12958021 still apply; merging deploys nothing (unchanged #1159 evidence: `netlify.toml` ignore for `main`, WS deploy only by approved dispatch).
