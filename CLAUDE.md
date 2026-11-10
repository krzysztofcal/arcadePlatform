# Shared project instructions

@agents.md
@skills.md

Claude Code follows the shared instructions above. The `ANTIGRAVITY_DELEGATION`
switch and the coordinator/worker rules in `agents.md` are the single source of
truth for Antigravity delegation (Claude Code and Codex); do not keep a separate
switch here.

- Claude Code is the coordinator; Antigravity (`agy`) is the full
  implementation agent (runs tests, commits and pushes `agy/*`). Delegate with the `agy-implement`
  skill, verify every result yourself, then integrate and open the Draft PR.
- Check Antigravity availability at session start (user SessionStart hook). If it
  is unavailable, report the concrete problem; never skip delegation silently.
- Follow later OWNER stop/disable instructions immediately.
