# 1229 — Tasks

- [x] T001 Read-only identity and ruleset audit → `audit.md`.
- [x] T002 Agent routing to the App with fail-closed `gh` for Claude Code, Codex and Antigravity (local configs; backups kept). Verified: fresh Claude Code session `which gh` → App wrapper, plain `gh` not logged in; Codex and agy child environments the same; git push already App-only.
- [ ] T002-O OWNER credential removal — **OWNER GO**, in this order:
  1. Confirm the OWNER channel works outside the VPS (browser and/or Termux `gh auth status` as `krzysztofcal`).
  2. claude.ai → Settings → Connectors → GitHub: disconnect (Claude Code already denies these tools; disconnecting removes the OWNER identity from agent reach).
  3. ChatGPT/Codex → Settings → Connectors (Apps) → GitHub: disconnect; optional: remove the two `apps.connector_76869538009648d5b282a4bb21c3d157` auto-approve blocks from `~/.codex/config.toml`.
  4. On the VPS, in the OWNER's own shell (not an agent session): `gh auth logout -h github.com -u krzysztofcal` (removes the OWNER token from `~/.config/gh/hosts.yml`).
  5. github.com → Settings → Applications → Authorized OAuth Apps → GitHub CLI: revoke (the token was readable by agents). Do this only after step 1.
  6. Verify read-only: `ls ~/.config/gh/hosts.yml` absent or without `oauth_token`; `ghx api repos/krzysztofcal/arcadePlatform --jq .full_name` still works.
  Rollback: `gh auth login` again (OWNER only).
- [ ] T003 Ruleset activation — **OWNER GO**, after T002-O. GitHub UI: Settings → Rules → Rulesets → New branch ruleset: name `main requires OWNER code owner review`; Enforcement **Active**; Bypass list: **Repository admin**, mode **For pull requests only**; Target: include `main`; rule **Require a pull request before merging** with Required approvals **1**, **Dismiss stale pull request approvals when new commits are pushed**, **Require review from Code Owners**. Nothing else; do not edit rulesets 12958021/12385707. Equivalent API from the OWNER channel: `gh api -X POST repos/krzysztofcal/arcadePlatform/rulesets --input main-owner-review.ruleset.json`. Read-back: the new ruleset has exactly one bypass actor `RepositoryRole 5 / pull_request`. Rollback: delete the new ruleset.
- [ ] T004 Acceptance (NOT RUN until T003):
  1. An App-authored PR (e.g. the #1229 PR) with green checks shows merge **blocked** until `@krzysztofcal` approves; `ghx pr merge` fails; an App review does not unblock it.
  2. A new push to that PR dismisses the OWNER approval.
  3. An OWNER-authored PR cannot be self-approved; the OWNER can merge it with the bypass option; `ghx pr merge` cannot.
  4. Required checks of 12958021 still apply; merging deploys nothing (unchanged #1159 evidence: `netlify.toml` ignore for `main`, WS deploy only by approved dispatch).
