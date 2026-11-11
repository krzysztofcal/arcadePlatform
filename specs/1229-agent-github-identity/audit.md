# T001 audit (read-only, 2026-11-11)

No secret values were displayed or copied. Methods: file reads, `--info` metadata, GitHub API reads, `/proc/*/environ`
variable **names** and public key fingerprints.

## Repository and GitHub settings
| Item | Finding |
|---|---|
| Repository | personal (`owner.type=User`), public; collaborators: only `krzysztofcal` (`admin`); no invitations, no deploy keys |
| `.github/CODEOWNERS` | `* @krzysztofcal` |
| Ruleset 12958021 `main is protected` | `main`; deletion, non_fast_forward, required checks `netlify/playkcswh/deploy-preview` + `actionlint` (strict), pull_request with `required_approving_review_count=0`, `require_code_owner_review=true`, `dismiss_stale_reviews_on_push=true`; **no bypass actors** |
| Ruleset 12385707 `bypass` | `main`; deletion, non_fast_forward; bypass `RepositoryRole` 5 (admin) `always` — unchanged |
| Admin-role holders | only `krzysztofcal` (personal repositories cannot grant `admin` to collaborators), so a `RepositoryRole` admin bypass applies to the OWNER only |
| App installation (`--info`) | selected repo `krzysztofcal/arcadePlatform`; contents/pull_requests/issues/actions **write**, checks/metadata read; one-hour tokens. Can push branches and create PRs; it is not a bypass actor and its approval does not satisfy a code-owner review |
| Client scripts | installed `~/.arcade-code-agent/{ghx,git-credential-arcade-agent,arcade-agent-token.mjs}` are byte-identical to `infra/vps/github-app-client/` on `main` |
| Recent PR authorship | #1202–#1226 mostly `app/arcade-code-agent`; #1228 and several 1140/android PRs authored as `krzysztofcal` |

## Effective agent credentials (same Unix user `copilot`)
| Path | Claude Code | Codex | Antigravity |
|---|---|---|---|
| `git push` (https) | global credential helper → App (helper list resets first; `quit=1` on failure, no fallback) | same | same |
| `gh` | `~/.local/bin/gh` with **OWNER** OAuth token (`~/.config/gh/hosts.yml`, scopes repo/workflow/read:org/gist) | `ghx` first on PATH (`shell_environment_policy`) → App; plain `/home/copilot/.local/bin/gh` would still read the OWNER token | `agy-implement` puts `ghx` first → App; the interactive `agy --dangerously-skip-permissions --remote-control` process has `~/.local/bin` first → **OWNER** |
| MCP / connectors | claude.ai GitHub connector authenticates as **`krzysztofcal`** (`get_me`) | ChatGPT GitHub connector configured with auto-approved `create_pull_request`/`update_pull_request` (identity managed by OpenAI, presumed OWNER OAuth) | none for GitHub |
| Env tokens | no `GH_TOKEN`/`GITHUB_TOKEN` in any agent process | none | none |
| SSH | `~/.ssh/id_ed25519` is **not** an OWNER GitHub key (fingerprint not in `github.com/krzysztofcal.keys`; `ssh -T` denied) | same | same |

## Verified 2026-11-11 (after T002 routing)
- Real GitHub CLI: `/home/copilot/.local/bin/gh` (ELF, gh 2.45.0); `ghx` execs the same binary. With
  `GH_CONFIG_DIR=$HOME/.config/gh` its `auth status` shows `krzysztofcal` from `hosts.yml` (2 `oauth_token` entries,
  token masked). `~/.arcade-code-agent/bin/gh` (ghx) rejects `gh auth`, so logout must use the real binary.
- `~/.claude/.credentials.json` and `~/.codex/auth.json`: mode 0600, owner `copilot` (the agents' user).
- Claude Code offers `--setting-sources` and Codex offers `-c key=value`, so user-level deny/disable settings do not bind a
  same-user process. A test run of `claude --setting-sources project` against the OWNER connector was itself blocked
  by Claude Code's auto-mode classifier as a bypass attempt; the residual follows from the CLI options and file access,
  not from an executed bypass.
- Bypass actor `User` is documented by GitHub REST (`actor_type` enum includes `User`; `OrganizationAdmin` is the only
  type excluded for personal repositories); `krzysztofcal` id 31594949.

## Blockers before T003 activation
1. OWNER OAuth token in `~/.config/gh/hosts.yml` is readable by every agent process (same UID); PATH routing alone
   does not isolate it.
2. claude.ai GitHub connector (Claude Code) and the ChatGPT GitHub connector (Codex) act as the OWNER and stay
   reachable by a same-user process; needs a GitHub-side repository restriction or the OWNER's written acceptance.
3. #1228 is OWNER-authored, so after activation it can only be merged through the OWNER PR-only bypass.

## Rollback
- Local agent configuration (T002): restore the backed-up `~/.claude/settings.json`, `~/.codex/config.toml` and
  `~/.claude/skills/agy-implement/agy-implement.sh` (backups listed in the handoff).
- Ruleset (T003): `DELETE /repos/krzysztofcal/arcadePlatform/rulesets/<new id>` (or set `enforcement=disabled`);
  rulesets 12958021/12385707 are never modified.
- OWNER credentials: `gh auth login` again from the OWNER channel; nothing is revoked before a verified replacement.
