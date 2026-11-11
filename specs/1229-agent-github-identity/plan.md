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

This routing is a workflow guarantee, **not credential isolation** (verified 2026-11-11, audit.md):
- the OWNER `gh` token (`~/.config/gh/hosts.yml`) is readable by the agents' Unix user until T002-O B removes it;
- the OWNER's claude.ai and ChatGPT logins (`~/.claude/.credentials.json`, `~/.codex/auth.json`, mode 0600, same
  user) keep the personal GitHub connectors reachable: the client switches are user-level settings that a same-user
  process can bypass (`claude --setting-sources`, `codex -c`), so a deliberately misbehaving agent could still act on
  GitHub as the OWNER, including approving a PR.
Minimal option without new infrastructure, accounts or disconnecting the connectors: on GitHub, limit the repository
access of the connectors' GitHub App installations so they exclude `krzysztofcal/arcadePlatform`, but only if they are
GitHub App installations and the OWNER does not need them for this repository. Otherwise the OWNER accepts the residual
in writing before T003. Either way, T003 then protects the normal workflow and prevents mistakes; it is not proof
against a deliberately misbehaving agent.

## T003 — ruleset (OWNER activation GO)
New ruleset [main-owner-review.ruleset.json](main-owner-review.ruleset.json): `main`, 1 approval, code owner review,
dismiss stale approvals; bypass only the user `krzysztofcal` (`actor_type: User`, id 31594949) in `pull_request` mode.
The GitHub REST docs list `User` as a bypass actor type (with `pull_request` mode) and exclude only `OrganizationAdmin`
for personal repositories; it cannot be tested without creating a ruleset, so T003 verifies it by read-back. Existing rulesets
12958021 and 12385707 are not modified, so required checks, PR requirement and no-force-push/deletion stay enforced
without bypass. If GitHub rejects the `User` actor here, the equivalent fallback is `RepositoryRole` 5 (admin), since in this personal
repository only the owner can hold `admin` (audit); that fallback needs the OWNER's decision. The App is neither a
bypass actor nor admin, and a review by the App or by a PR author never satisfies a code-owner
review. Activate only after T002-O (no OWNER credential reachable by agents).

## Breaking impacts
- Open PRs authored by `krzysztofcal` (#1228, #1217, #1215, #1211, #1208, #1171, #1165, #1160, #1155, #1142,
  #1097): after activation they can be merged only through the OWNER's PR-only bypass (no self-approval), or
  re-opened by an agent as App-authored PRs. #1228 was created by Claude Code with the OWNER `gh` login before this
  change.
- Agent PRs need an OWNER approval before merge; every new push dismisses it.
- Claude Code no longer has the claude.ai GitHub MCP tools; agents use `ghx` for all GitHub reads and writes.
