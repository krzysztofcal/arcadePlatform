# 1229 — Tasks

- [x] T001 Read-only identity and ruleset audit → `audit.md`.
- [x] T002 Agent routing to the App with fail-closed `gh` for Claude Code, Codex and Antigravity (local configs; backups kept). Verified: fresh Claude Code session `which gh` → App wrapper, plain `gh` not logged in; Codex and agy child environments the same; git push already App-only.
- [ ] T002-O OWNER credential removal from the VPS agent runtime — **OWNER GO** (draft, pending independent review):
  A. Personal connectors stay connected; only the VPS agent clients stop using them:
     1. Claude Code (VPS): already `permissions.deny: ["mcp__claude_ai_github"]` (claude.ai web/mobile unaffected).
     2. Codex (VPS): in `~/.codex/config.toml` replace the two auto-approve blocks of the GitHub app with
        `[apps.connector_76869538009648d5b282a4bb21c3d157]` `enabled = false` (only that app; ChatGPT unaffected).
        Not `features.apps = false`: it would also remove Figma, Adobe Acrobat and the Gmail/Google Drive plugins that
        Codex sessions use. MCP servers (supabase-stage, browserstack, OVH) do not depend on apps.
     3. Residual (verified, audit.md): these switches bind only the normal workflow. The OWNER's Claude and ChatGPT
        logins on the VPS (`~/.claude/.credentials.json`, `~/.codex/auth.json`, same Unix user) keep the connectors
        reachable by a same-user process (`claude --setting-sources`, `codex -c`), so a deliberately misbehaving
        agent could still act as the OWNER on GitHub, including approving a PR. Before T003 the OWNER chooses one:
        a) GitHub → Settings → Applications → Installed GitHub Apps: if the Claude / ChatGPT connector is listed, set
           its repository access to exclude `krzysztofcal/arcadePlatform` (personal use elsewhere is kept); or
        b) accept this residual in writing (e.g. a comment on #1229).
  B. GitHub CLI token (`~/.config/gh/hosts.yml`), without losing the OWNER's own access:
     1. Pre-check: github.com in the browser (2FA) and Termux `gh auth status` both work.
     2. VPS, OWNER's own shell (not an agent session), real GitHub CLI by absolute path (`gh` on PATH may be `ghx`,
        which rejects `gh auth`):
        `GH_CONFIG_DIR="$HOME/.config/gh" /home/copilot/.local/bin/gh auth logout --hostname github.com --user krzysztofcal`
        This removes the token from the VPS only. It does not invalidate it, so Termux is unaffected.
     3. Verify without printing the token:
        `GH_CONFIG_DIR="$HOME/.config/gh" /home/copilot/.local/bin/gh auth status --hostname github.com` → "not logged in"
        (non-zero exit); `grep -c oauth_token ~/.config/gh/hosts.yml` → `0` (or the file is absent);
        `~/.arcade-code-agent/bin/gh api repos/krzysztofcal/arcadePlatform --jq .full_name` → the repository name.
        Never run `gh auth token` or `--show-token`.
     4. Optional hardening: revoking "GitHub CLI" under Authorized OAuth Apps invalidates **every** GitHub CLI token,
        Termux included. If chosen, do it after step 2 and re-login Termux at once with `gh auth login --web`
        (the browser is the independent channel). The 2026-11-10 audit found the token in no agent logs or transcripts,
        but agent processes could read it.
     5. Do not log `gh` in again on the VPS; OWNER actions go through the browser/Termux. Nothing automatic on the VPS
        uses this token (no crontab, no user systemd units, no user scripts). `scripts/www-production-release.mjs`
        reads WS deploy runs/jobs with `gh api`. On the VPS, run it with `ghx` first on PATH (the App can read them);
        otherwise run it from Termux.
     Rollback: `gh auth login` on the VPS (OWNER only).
     The #1159 quarantine catalog is not needed: the file holds a revocable token, so logout is the simpler, existing
     path. A root-custody copy would need a catalog entry like `github-app-key-quarantine` (reviewed PR + `vps-admin`
     approval).
- [ ] T003 Ruleset activation — **OWNER GO**, after T002-O B and the A.3 choice. Scope: it binds agents acting through the App and prevents mistakes; while T002-O A.3 holds it is not proof against a deliberately misbehaving agent. GitHub UI: Settings → Rules → Rulesets → New branch ruleset: name `main requires OWNER code owner review`; Enforcement **Active**; Bypass list: user **krzysztofcal**, mode **For pull requests only** (if the UI or API does not accept a user, STOP; fallback **Repository admin** needs an OWNER decision); Target: include `main`; rule **Require a pull request before merging** with Required approvals **1**, **Dismiss stale pull request approvals when new commits are pushed**, **Require review from Code Owners**. Nothing else; do not edit rulesets 12958021/12385707. Equivalent API from the OWNER channel: `gh api -X POST repos/krzysztofcal/arcadePlatform/rulesets --input main-owner-review.ruleset.json`. Read-back: the new ruleset has exactly one bypass actor `User 31594949 / pull_request`. Rollback: delete the new ruleset.
- [ ] T004 Acceptance (NOT RUN until T003; read-only checks, no merge without a separate OWNER GO):
  1. Use a **Ready** (not Draft), unmerged App-authored PR with all required checks green, which the OWNER
     designated for this test (e.g. #1230 after it is marked Ready). Expect from
     `ghx pr view <n> --json isDraft,reviewDecision,mergeStateStatus,statusCheckRollup`: `isDraft=false`, checks
     SUCCESS, `reviewDecision=REVIEW_REQUIRED`, `mergeStateStatus=BLOCKED` (green checks and Ready, so the block comes
     from the missing code-owner review). No merge attempt.
  2. The OWNER approves → `reviewDecision=APPROVED`. An agent pushes one trivial commit → `REVIEW_REQUIRED` again
     (stale approval dismissed). No merge.
  3. Bypass eligibility only: `ghx api repos/krzysztofcal/arcadePlatform/rulesets/<id> --jq .current_user_can_bypass`
     → `never` (App); the same read from the OWNER channel → `pull_requests_only`. An actual OWNER bypass merge is a
     separate GO.
  4. Rulesets 12958021 and 12385707 read back unchanged (required checks, no force push); merging deploys nothing
     (#1159 evidence: `netlify.toml` ignore for `main`, WS deploy only by approved dispatch).
