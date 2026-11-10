# 1229 — Plan

Reuse only #1159 assets: App `arcade-code-agent`, `ghx`, `git-credential-arcade-agent`, root-owned signer. No new
service, App, token store, runner or bot. Evidence: [audit.md](audit.md).

## T002 — agent routing (done locally, reversible) and OWNER credential removal (OWNER GO)
Agent launch configuration (outside the repository, per agent):
- Claude Code `~/.claude/settings.json`: `env.PATH` starts with `/home/copilot/.arcade-code-agent/bin`,
  `env.GH_CONFIG_DIR=/home/copilot/.arcade-code-agent/gh`, `permissions.deny` contains `mcp__claude_ai_github`.
- Codex `~/.codex/config.toml` `[shell_environment_policy.set]`: existing PATH (ghx first) + `GH_CONFIG_DIR`.
- Antigravity `agy-implement`: ghx first on PATH + `GH_CONFIG_DIR`.
`GH_CONFIG_DIR` points plain `gh` at the empty App config, so a bypass of the wrapper finds no OWNER login (fail
closed); `ghx` refuses `gh auth`; git already uses only the App helper (`quit=1` on failure).

This routing is not isolation. The OWNER OAuth token in `~/.config/gh/hosts.yml` stays readable by the shared Unix
user until the OWNER logs it out on the VPS (no revoke needed, so Termux keeps working). The OWNER's Claude/ChatGPT
logins on the VPS keep their GitHub connectors technically reachable by agents. The VPS clients disable them, but the
personal integrations are not changed (tasks.md T002-O).

## T003 — ruleset (OWNER activation GO)
New ruleset [main-owner-review.ruleset.json](main-owner-review.ruleset.json): `main`, 1 approval, code owner review,
dismiss stale approvals; bypass only `RepositoryRole` 5 (admin) in `pull_request` mode. Existing rulesets
12958021 and 12385707 are not modified, so required checks, PR requirement and no-force-push/deletion stay enforced
without bypass. In this personal repository only the owner can hold `admin` (audit), so the bypass is OWNER-only;
the App is neither admin nor a bypass actor, and a review by the App or by a PR author never satisfies a code-owner
review. Activate only after T002-O (no OWNER credential reachable by agents).

## Breaking impacts
- Open PRs authored by `krzysztofcal` (#1228, #1217, #1215, #1211, #1208, #1171, #1165, #1160, #1155, #1142,
  #1097): after activation they can be merged only through the OWNER's PR-only bypass (no self-approval), or
  re-opened by an agent as App-authored PRs. #1228 was created by Claude Code with the OWNER `gh` login before this
  change.
- Agent PRs need an OWNER approval before merge; every new push dismisses it.
- Claude Code no longer has the claude.ai GitHub MCP tools; agents use `ghx` for all GitHub reads and writes.
