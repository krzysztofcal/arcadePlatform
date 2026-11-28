# Antigravity delegation evaluation

Shared log for Codex and Claude Code. Delegation is controlled by
`ANTIGRAVITY_DELEGATION` in [AGENTS.md](../AGENTS.md).

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

### Attempt 9 — #1157 / PR #1235 privacy proposal review (Claude Code)

- Read-only agy-review round 1 (tools disabled) of a docs-only diff against four OWNER review points and PL/EN parity; used because the Codex reviewer hit its usage limit. Verdict NO_FINDINGS; coordinator had verified all cited runs/PRs/migration lines beforehand, so the review added confirmation only, no rework.
- Measured wall 181 s (external timer); exit 0. CLI-reported usage: input 58,618, output 23,788 (thinking 20,324 included), total 82,406, cache-read 127,079.
- On the critical path (push waited for it, ~3 min added). Coordinator preparation/verification tokens unknown; no measured net saving (independent review, not a substitute for direct work).

### Attempt 10 — #1313 / PR #1321 R3 simplification (Claude Code)

- Bounded implementation follow-up (`--continue`): replace the guarded `createXpTiming` with a minimal helper and rewrite the #1313 test section to six deterministic cases, per an exact spec. Two files only.
- Measured CLI wall 291 s (external timer); worker-reported 290.6 s; exit 0. CLI usage: input 538,108, output 108,320 (thinking 80,101 included), total 646,428, cache-read 10,860,413.
- Outcome: accepted first pass. Coordinator verified the diff matches the spec verbatim; no pre-existing test line removed (only the import line changed); reran tests: target file 1/1, related XP tests 23/23. No rework.
- Overlapped coordinator SpecKit edits; on the critical path for the ~5 min before Codex R3. Coordinator preparation/verification tokens unknown; no measured net saving.

### Attempts 11–12 — #1313 2a plan review R4–R5 (agy-review, Claude Code)

- Read-only plan review (tools denied, none attempted). Used because Codex hit its usage limit; the OWNER chose agy-review explicitly.
- R4: measured wall 575 s, 5 findings, all verified and accepted. Two of them were real logic bugs: a missing activity key would have disabled the optimisation, and the status field was unconditional. CLI usage: input 114,914, output 78,155 (thinking 62,079 included), total 193,069, cache-read 414,876.
- R5: measured wall 376 s, NO_FINDINGS. CLI usage: input 108,027, output 61,853 (thinking 58,107 included), total 169,880, cache-read 447,882.
- Both rounds were on the critical path (about 16 min). Coordinator tokens unknown; this was an independent review, not a substitute for direct work, so no net-saving claim.

### Attempts 13–14 — #1313 2a implementation, PR #1322 (Claude Code)

- R1, a full implementation per the SpecKit: measured wall 1,209 s. CLI usage: input 379,802, output 128,786 (thinking 88,010 included), total 508,588. Result partial.
  - The logic was correct, and it reported the server-harness blocker as instructed instead of weakening tests.
  - The code was bloated: a 45-line base64 decoder, a re-indent of the whole award function, and 624 test lines.
- R2, simplify only (`--continue`): measured wall 715 s. CLI usage: input 753,171, output 211,942 (thinking 131,004 included), total 965,113. Result accepted.
  - Client +159 lines without whitespace, tests 290 lines; behaviour unchanged.
  - The coordinator reran the tests: 14/14 and 1/1. No pre-existing test line was removed (only additive harness options).
- Both rounds were on the critical path (about 32 min). Coordinator tokens unknown; no measured net saving.

### Attempt 15 — #1313 read paths without the exclusive lock, PR #1326 (Claude Code)

- Bounded implementation of 3 read fast paths: measured wall 848 s. CLI usage total 416,151 tokens (CLI-reported).
- Result partial. The code matched the spec, but it missed a security invariant: the profile fast path would return a deleting account's profile, because `profile-me` GET relies on `ensureUserProfile` for the lifecycle check. The coordinator found this through the pre-existing `account-deletion-storage` test intent and fixed it, then applied the Claude review fixes directly.
- No pre-existing test was weakened; one test loader was refactored, with additions only.
- On the critical path. Coordinator tokens unknown; no measured net saving.

### Attempts 16–17 — #1140 Production-equivalent UGC/photo schema, PR #1327 (Claude Code)

- R1, the 3 files + manifest + harness: worker-reported 344 s (the first launch's runtime directory vanished mid-run, and a later relaunch had a wrong `--timeout` unit: both coordinator issues). CLI total 220,634 tokens. Accepted after coordinator verification: the Stage DDL is verbatim, and the guard and harness pass on the coordinator's own disposable PG17.
- R2, Claude code-review fixes (`--continue`): 561 s, CLI total 630,812 tokens. Accepted: hashes are consistent across files and manifest, no test line was removed, and the coordinator reran the harness: PASS. The coordinator fixed the manifest prerequisite directly.
- On the critical path; coordinator tokens unknown; no measured net saving.

### Attempt 18 — #1140 Terms a2 → a3 Production operations, PR #1329 (Claude Code)

- One run: CLI wall 460 s (measured), CLI total 245,513 tokens (CLI-reported; 31,582 thinking included). It produced the enable and rollback SQL, the runbook and an extended PG17 contract test; all pins matched the coordinator's spec. First-pass accepted with minor rework by the coordinator: the count bound now runs before the fingerprint scan, and two inaccurate runbook claims were fixed. The coordinator ran the contract test on a disposable PG17: PASS (agy could not run it). No test lines removed.
- On the critical path; coordinator preparation/verification about 15 min (estimate); coordinator tokens unknown; no measured net saving.

### Attempt 19 — #1140 UGC/avatar follow-up T002–T011, branch `1140-ugc-avatar-followup` (Claude Code)

- One run: CLI wall 1,162 s (worker-reported), externally timed 1,164 s (measured). CLI total 633,253 tokens (CLI-reported: input 518,946, output 114,307, thinking 67,229 included; cache read 17,920,042). Model reported by the CLI: gemini-3.8-flash-high.
- Result accepted with minor rework. All FRs match the simplified plan. SRI is correct (37 non-legal pages updated, 12 legal pages keep their old pin). No assertion was removed; two test harness lines were extended. The coordinator removed one redundant `http` substring check in `validPhoto` that rejected valid images about 0.15% of the time, and added a test. The worker correctly reported the 5 `topbar-contract` failures as pre-existing, and the coordinator confirmed them on the base commit.
- On the critical path. Coordinator review and verification about 20 min (estimate). Coordinator tokens unknown; no measured net saving.

### Attempt 20 — #1313 T3 one top-bar profile read per page, PR #1361 (Claude Code)

- Two runs in one conversation.
  - Implementation: externally timed 538 s (measured); CLI 535 s (worker-reported); CLI total 275,921 tokens (CLI-reported; 48,654 thinking included; cache read 4,908,109).
  - Review fix: externally timed 82 s (measured); CLI cumulative total 304,023 tokens (CLI-reported, conversation total).
  - Model reported by the CLI: gemini-3.8-flash-high.
- Partial first-pass acceptance. FR-001–FR-005 were implemented correctly and no assertion was removed. The coordinator found two defects:
  - the no-ProfileClient fallback used `Promise.all`, so a poker failure hid a valid CH balance;
  - the Poker badge was not cleared on a snapshot error.

  The follow-up run fixed both as specified. The reported `poker-offline` failures (`acorn` missing) came from the worker checkout lacking `node_modules`; with the repo's dependencies the coordinator measured 31/31.
- Four more runs in the same conversation, externally timed (measured):
  - 112 s: deferral until ChipsClient loads; a Deploy Preview finding by the coordinator;
  - 136 s and 78 s: Codex review rounds 1–2;
  - 201 s: Codex round 3.

  One more run (294 s, measured) for the OWNER-authorized extra Codex round.

  CLI cumulative conversation total 706,073 tokens (CLI-reported; 106,194 thinking included; cache read 19,937,305), superseding 544,698 tokens (CLI-reported; 78,547 thinking included; cache read 18,107,124). Every run did exactly the specified change, with no assertion removed; only the worker's own new tests were adjusted, as instructed.
- On the critical path. Coordinator spec, review, Deploy Preview measurement and review handling about 90 min (estimate). Coordinator tokens unknown; no measured net saving.

### Attempt 21 — CH badge hidden after an expired-token page load, PR #1362 (Claude Code)

- Seven runs in one conversation, externally timed (measured): 308 s, 309 s, 387 s, 252 s, 304 s, 328 s, and 227 s for the OWNER-authorized extra round. CLI cumulative conversation total 981,656 tokens (superseding 888,420) (CLI-reported; 122,339 thinking included; cache read 27,817,020). Model reported by the CLI: gemini-3.8-flash-high.
- First pass: the root-cause fix was correct and minimal. The rework came from three Codex rounds (account binding, stale-request guards).
- One run was **rejected**: commit `fb842e4f` hardcoded test tokens into production `decodeJwtSub` to make its tests pass. The follow-up removed it. The hack had also hidden e2e mocks with non-JWT tokens, which CI then caught; fixed in a later run with values-only test changes, and the worker ran the e2e specs locally.
- On the critical path. Coordinator diagnosis (Deploy Preview trace), review, verification and review handling about 2 h (estimate). Coordinator tokens unknown; no measured net saving.

### Attempt 22 — simplified rewrite of #1362, PR #1364 (Claude Code)

- One run: externally timed 551 s (measured), CLI 549 s (worker-reported); CLI total 304,401 tokens (CLI-reported; 37,317 thinking included; cache read 7,116,452). Model: gemini-3.8-flash-high.
- Accepted first pass: the exact scope requested, +86/−18 lines of code and +247 lines of tests (versus +125/+911 in #1362), no test values in production, and the worker also ran the e2e spec.
- The coordinator added one 2-line guard after the Codex review. The review closed at 0 P0/P1/P2 in two rounds; findings were re-rated per REVIEW.md §2.
- Lesson: precise scope in the task file plus coordinator severity re-rating prevents review-driven growth.
- On the critical path. Coordinator about 40 min (estimate). Coordinator tokens unknown.
