# Antigravity delegation evaluation

Shared log for Codex and Claude Code. Delegation is controlled by
`ANTIGRAVITY_DELEGATION` in [agents.md](../agents.md).

Track useful work, quality and total overhead, including failures. Unknown
measurements stay unknown. Never infer token savings merely from delegation.
No extra tooling, permissions changes or duplicate benchmark runs are required.

Report a preliminary result after the first attempt in each task: usefulness,
elapsed time, coordinator overhead and a directional savings estimate with its
basis and uncertainty, or unknown when evidence is insufficient. Aggregate
evaluation follows each five new attempts; the first report must not wait for it.
These are reporting windows, not call-count limits.

| Attempt | Coordinator / task | Elapsed / critical path | Verified result and rework | Coordinator / worker tokens | Savings assessment |
| --- | --- | --- | --- | --- | --- |
| 1 (initial setup session) | Codex / read-only review of delegation instructions from repository files | Unknown (not timed) / yes | Failed: headless command permission denied; exit code 0 did not mean task success. No review delivered. Replaced with a text-only task. | Unknown / unknown | No demonstrated savings; setup overhead. |
| 2 (initial setup session) | Codex / text-only review of delegation instructions, no tools | Unknown (not timed) / yes | Partial: 3 findings. File-case warning rejected after checking that lowercase agents.md exists; cancellation wording and headless permission handling clarified by coordinator. | Unknown / unknown | No demonstrated savings; preparation, review and edits required. |
| 3 (permission diagnostic) | Codex / report delegation switch using exact permitted `cat agents.md` command | 9.6 s / yes | Returned the correct switch value without a permission error using session-only `permissions.allow`. No file edits or persistent permission changes. Preparation/check overhead not timed. | Unknown / unknown | Diagnostic success; no demonstrated token savings. Directly reading one value would be cheaper; this attempt tested task-scoped access. |
| 4 (#1155/#1160 audit) | Codex / extract historical legal and Android prerequisites from four supplied documents | 29.7 s / overlapped coordinator audit | Partial: useful list with source paths and historical-evidence caveat. Branch tasks were stale; coordinator reconciled later Android/Preview acceptance instead of reopening those gates. Input 19,014 characters; preparation/review time not timed. | Unknown / unknown | Unknown; compressed reading, but selection and fact-checking overhead prevent a defensible net estimate. |
| 5 (#1155/#1160 audit) | Codex / run eight existing isolated fundamental suites through one exact permitted Python command | 29.6 s total; 18.8 s underlying checks; about 10.8 s orchestration / overlapped audit and independent review | Accepted: coordinator checked saved JSON and raw TAP: 90 PASS, 0 FAIL, 1 SKIP (91 total). No source edits. Session permissions allowed only the bounded runner. | Unknown / unknown | No measured token savings. This offloaded execution/reporting, but a direct runner could emit the same short summary; about 10.8 s extra elapsed versus the underlying run. |

For future attempts, follow the current re-enabled policy below and append one row with measured elapsed time, evidence-backed
acceptance and approximate coordinator overhead (label estimates). Include
existing check results when relevant, without copying full output. Record an
existing task/run reference when available; do not create an issue just for logging.

## First five attempts: historical preliminary aggregate

- Two accepted results (one diagnostic, one verification), two partial document
  reviews, one permission failure. This is a small mixed sample, not a general
  correctness benchmark; three attempts (1–3) tested setup/diagnostics rather than product work.
- Timed calls: 9.6 s, 29.7 s, 29.6 s. The first two attempts were not timed, so
  total session overhead is unknown. The test delegation added about 10.8 s to
  an 18.8 s runner; it overlapped other work; its effect on final task completion time was not measured.
- Coordinator preparation, prompt/result tokens, worker usage and a comparable
  direct-work baseline are unavailable. No percentage or net token saving is
  established. Repeated invocation and permission diagnostics cost extra work.
- Historical recommendation (superseded by the re-enabled policy below): keep delegation enabled as a narrow trial for bounded
  extraction and checks during independent work. Avoid delegating trivial
  commands or treating historical document extraction as a current audit.
  Prefer direct execution when a short deterministic summary is already enough.
  Reassess after ten additional attempts, sooner on material delay/failure or
  OWNER request; still report the first attempt of each task immediately.


## OWNER re-enabled use — 2026-11-06

The previous stop-after-five instruction is superseded. Delegation is enabled
for Codex and Claude Code with no total use limit. Keep the original attempts
1–5 and continue numbering; do not reset unsuccessful history. The shared switch
is still the immediate way to stop new delegations. No accepted feature PR,
permission, credential, deployment or global review rule is changed by this policy.

For each attempt log: coordinator/task and bounded input size; externally timed
CLI wall time and separately any worker-reported duration; verified acceptance,
first-pass result and rework; preparation/verification overhead and critical-path
impact; coordinator and worker token usage with provenance, or unknown. Mark
estimates and their basis explicitly. Reasoning/cache fields may be subsets of
reported totals: never sum overlapping fields. Aggregate accepted/partial/failed
counts, rework, delay and available usage over each five new attempts. Never
run duplicate paid work solely to invent a baseline or infer savings from fewer
coordinator-written words. Routine verification is not a duplicated benchmark.

| Attempt | Coordinator / task | Elapsed / critical path | Verified result and rework | Coordinator / worker tokens | Savings assessment |
| --- | --- | --- | --- | --- | --- |
| 6 (re-enabled policy) | Codex / draft two bounded shared-policy bullets from supplied non-sensitive text; input 1,410 characters | Measured CLI wall 15.749 s; CLI-reported agent duration 12.309 s / critical path yes; added total-task delay unknown | Partial: useful 2-bullet draft, about 113 words, within 170-word bound; re-enable/no-cap scope correct. Coordinator rewrote/expanded both bullets and clarified CLI versus worker duration. Rework yes, effort not timed; no further worker call. No file access/edit requested; response SUCCESS, one reported turn. | Coordinator unknown; worker CLI-reported input 11,887, output 1,124, total 13,011; thinking 955 reported separately (not added to total, which equals input + output); cache-read 0 | Net savings unknown: no metered coordinator overhead or comparable direct baseline. Large context for a small draft; prefer chunkier bounded work over tiny drafting tasks. No positive savings claim. |

Preliminary result after attempt 6: useful draft input / partial, with measured latency and
worker usage now available. The reported agent duration and CLI wall differ by
3.440 s; that difference is not a measure of coordinator preparation/verification
or whole-task delay. Monitoring/rule-update/independent-review setup is separate
one-time work and is not included in the worker token figure. It also has no
metered coordinator token baseline. Next normal aggregate: attempts 6–10, then
11–15, without any stop at those boundaries. Reassess sooner on material delay,
verified errors or OWNER request; use direct fallback after a failed call rather
than retrying indefinitely.

### Attempt 7 — #1197/#1199 integration catalog inventory

- Read-only supplied-text task: identify missing approval entries and supplied test candidates; no repository tools, writes or safety decisions delegated.
- CLI wall: 15.503 s; exit 0; input 11,900, output 1,444 (thinking 1,181 included), total 13,344 CLI-reported tokens.
- Outcome: accepted factual inventory; four missing Preview operation descriptions independently confirmed. Test inventory was explicitly bounded to supplied filenames.
- Coordinator preparation/verification tokens and direct-work baseline: unknown. No measured net token saving. Execution overlapped coordinator audit, outside critical path; total-task time benefit remains unmeasured.
- Evidence: /tmp/ops1197-1199-prepare/agy-7.*. Aggregate next after attempt 10.

### Attempt 8 — #1199 merge / supplied installer inventory

- Read-only supplied-text extraction, no tools/edits/security decisions: eight installed source/destination/owner/mode mappings and final status-operation name. Accepted first pass after independent comparison; no rework.
- Measured CLI wall 20.512 s; worker-reported 17.328 s; exit 0. CLI usage: input 10,441, output 2,339 (thinking 1,769 included), total 12,780, cache-read 0.
- Overlapped main CI and coordinator audit; not on critical path. Coordinator preparation/verification tokens/time and comparable direct-work baseline unknown; no measured net saving or whole-task delay claim.
- Evidence: /home/copilot/work/stage1159-safe-stop-review/merge-20261106/agy-8/. Next aggregate after attempt 10.

## OWNER decision — Antigravity as default implementation worker (2026-11-10)

Scope changed from "simple bounded tasks" to "default implementation worker" (features, fixes, tests,
refactors; coordinator plans, verifies and integrates). See `agents.md`. Root cause of the earlier
silent stop: this policy, `CLAUDE.md` and this log existed only as uncommitted files in one local
checkout, so sessions started in fresh git worktrees never loaded them; the only global agy tool was
the review-only `agy-review` skill. Setup diagnostics (permission probes in a throwaway directory) are
not counted as attempts. Finding: headless agy ends the turn on any command outside the session
allowlist (exit 0, empty response), so implementation runs use `command(*)` plus a PreToolUse guard.

### Attempt 9 — delegation pipeline verification (throwaway helper + tests), Claude Code

- First wrapper run with a narrow session allowlist. CLI wall 85.7 s; exit 0 but empty response: `node -v` was outside the allowlist and headless mode aborted the turn. Rejected, no files written. Worker CLI usage: input 48,726, output 8,947 (thinking 8,659 included), total 57,673. Fixed by moving the policy into the guard.

### Attempt 10 — same task after the fix, Claude Code

- Implemented `formatChipsCompact` (k/M rules, rounding boundary, TypeError cases) with 5 `node:test` tests in a dedicated `agy/*` worktree. Measured wall 230.1 s; DONE; no guard denials.
- Coordinator verification: read the diff, reran tests (5/5 pass) and 17 independent boundary/error cases (0 mismatches). Accepted first pass, no rework. Worker CLI usage: input 90,648, output 26,159 (thinking 23,477 included), total 116,807; cache-read 724,051 reported separately. Coordinator usage unknown. Throwaway: not merged.

### Attempt 11 — follow-up fix via `--continue`, Claude Code

- Coordinator review follow-up in the same conversation: add billions (`B`) incl. the 999,950,000 boundary, with tests. Measured wall 56.3 s; DONE. Coordinator reran tests (6/6 pass) and 7 independent cases (0 mismatches). Accepted first pass. Worker CLI usage: total 138,653 (input 106,985, output 31,668 incl. thinking 26,333). Coordinator usage unknown; no savings claim.

Preliminary assessment (attempts 9–11): the pipeline delegates, runs, returns a structured report and accepts follow-up fixes; 2/3 accepted after one infrastructure fix. Worker latency was 1–4 min for a small task; net token savings are unmeasured. Next aggregate after attempt 13.

### Attempt 12 — security re-verification after hardening, Claude Code

- Default no-exec mode. Real task (`clampBet` + tests) plus four access probes. Measured wall 266.8 s; DONE. Guard denied `gh auth status`, `git fetch origin`, `call_mcp_tool` (supabase-stage) and `node --test`, plus two unrequested worker reads under `~/.gemini`. Worker reported tests as "not run".
- Coordinator review found no network/child_process/env/fs use; coordinator ran tests (16/16 pass) and 14 independent cases (0 mismatches). Accepted first pass. Worker CLI usage: total 137,144 (input 105,964, output 31,180 incl. thinking 27,182). Coordinator usage unknown.
- Finding: `agy --sandbox` does not confine child processes, so worker-side code execution is now opt-in and unisolated (`--allow-exec`).
