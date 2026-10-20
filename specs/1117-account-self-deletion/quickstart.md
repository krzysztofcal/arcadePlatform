# Account Deletion V2 — shortest remaining Stage path

## Current release status — 20 October 2026 (supersedes historical checkpoints)

Redis V3 operational migration is **COMPLETED** on Stage and Production, independently of Account Deletion. Owner merged #1129 as `82aee39d5b0bd006e72a199cc89963beaf5665c1`; closure is recorded in #1130 and `docs/ops/redis-v3-cutover.md`. Actual journal:570 exact legacy XP keys deleted,0 uncertain,0 V2 repopulation; protected backup/journal retained. Production Netlify/WS exact82aee39d, Stage avatar-v3 source134818252375239acb8356163a0b454222d99ef8 preserved; real XP/profile/ranking/refresh/WS smoke PASS in both environments. Do not repeat reset, rotate credentials, recreate epochs or roll back to V2. Old audit statements below about pending reset/ProductionV2 are historical, not current instructions.

Account Deletion remains **OFF**, #1124 **DRAFT**, MVP **not merge-ready**. Existing runtime/Stage proofs do not cover newly integrated runtime or pending deletion migrations. The accepted theoretical post-expiry upload limitation is #1128, not an MVP blocker; real unknown operations/ownership remain blocking. No Stage mutation/deploy or Production change is authorized by this review.

## Already done — do not repeat

- Redis V3: both environments operational;570 historical XP keys reset once, old credential rejected, no dual-read/V2 import. Canonical operational evidence/recovery: `docs/ops/redis-v3-cutover.md` (#1129/#1130). Keep protected backup/journal; no new Redis reset or credential change is needed.
- Stage avatar v3 guards ENABLED/ready, tracking ON,115 migrations previously applied including20261020082604. Ordinary upload/finalize, legacy/fault campaign and real exact-object API delete/absence in both buckets PASS. Historical API absence is HTTP400+body statusCode404/codeNoSuchKey; permission/bucket errors are not absence.
- Financial Poker component tests (JOIN/all-in/showdown/side-pot/cash-out/idempotency), retention compatibility and nonfinancial exact-SHA WS smoke already have evidence in research.md. Full deletion E2E has NOT run. Do not rerun completed smoke unless runtime/configuration changes require it.

## 1. Owner decisions before the next execution window

1. Accept temporary protected-payout unavailability for unverifiable historical identities. Welcome<=3 lifetime, Daily UTC and once/campaign remain enforced; signup/re-registration stays available. No honest technical backfill exists without verified-email-at-payout provenance; current email is not evidence. Alternative is to supply actual historical provenance; resetting quotas is not an approved alternative.
2. Approve purpose-bound minimal HMAC policy after legal/LIA review (candidate Art6(1)(f), not a legal opinion): Welcome proof through programme life, once through campaign operation/reopening, annual necessity review; Daily minimal UTC period evidence with a separately reviewed safe prune policy, not an unimplemented automatic promise. No raw email in proofs; assess erasure/objection/restriction individually. Keep one versioned key plus restricted recovery backup; no rotation/erasure that silently resets recognition.
3. Authorize read-only provenance retrieval for the five historical no-SHA Netlify artifacts identified in research; if impossible, separately authorize their exact retirement after published/alias safety checks. Three are historical Production-context artifacts; their retirement is not Stage-only. Never retire current Production or1626known deployments wholesale.
4. Authorize a disposable confirmed-email mailbox for genuine password re-registration, or explicitly accept Admin-confirmed fixture evidence with actual email delivery NOT TESTED. Dedicated Google identity is separate; absence does not block password tests but Google remains NOT TESTED.

## 2. Preflight (read-only; next separate GO)

Pin Stage project `krydukthwdvccggbyjfw`, system7656985631720456337; compare every applied migration/hash. Expected115 applied and exactly two pending:20261020094224_account_avatar_reconciliation.sql and20261020094949_account_reward_legacy_writer_fence.sql (117repository migrations). Unexpected drift/pending -> NO-GO. Do not invoke migrator as a read-only check.

Verify guards ready, Netlify/WS deletion0 and DB releasefalse, tracking1, Stage V3 LIVE and current epoch; active/shared Preview conflicts absent. Scope every object to proven owner; retain original manifest evidence. `epochPresent=1` proves neither Storage nor deletion release readiness. Read current proof, do not manufacture timestamps.

## 3. Prepare schema/runtime and honest readiness records (separate scoped GO)

Apply only the two reviewed forward migrations after hash check. Keep guards ON/deletion OFF. Deploy matched Netlify Preview and main-defined WS Preview with ref=<reviewed exact runtime SHA>, xpRedisVersion=3; verify both generated deploy-preview/3/stage contexts, LIVE, health and browser Auth/ping/lobby. Green PR WS checks are not deployment evidence. No Production deploy is needed for Stage E2E.

Reconcile existing campaign global totals under release row FORUPDATE while OFF using actual hot/registry/archive receipts. Preserve existing idempotency/history; new SQL owns quota increments, old JS must not also increment. With missing history/key, keep protected payouts unavailable and history_ready false/unset; acceptance of that degradation does not approve fake coverage.

Bind the existing completed Redis migration evidence to Stage deletion-specific redis_cutover fields (actual endpoint hash, epoch, reviewed manifest hash, real writer drain/reset evidence). No Redis data mutation or new epoch. Inspect rather than overwrite an existing valid proof.

After legacy authority provenance/drain and exact inventory, record genuine Storage cutoff/inventory; wait at least cutoff+7200s and all recorded capability_until (longer old horizons preserved). Known unfinished signing/output operations require real terminal observations and reviewed scoped reconciliation. The new canonical reconciliation RPC operates only under a genuine request/owner/lease, preserves original receipts, checks exact DELETE and authenticated absence. Do not generate a synthetic request/lease to force readiness. Unprovable ownership/terminal state -> NO-GO for that subject, not permission for a global sweep. New clean disposable subject still needs the global truthful cutover/inventory prerequisite.

## 4. One conditional Stage E2E window (explicit destructive GO required)

Only after preceding gates: approve temporary Stage acceptance/release, canonical fixture funding for subject+two unequal-stack players/control, UI confirmation and lost-HTTP-response one-shot recovery, old JWT/WS/admission denial, automatic Leave without folding all-in, showdown/side-pot, cash-out, exactly one balanced BURN including winnings. Browser signs out after durable acceptance and is unnecessary for recovery.

Observe indexed UUID Redis cleanup, exact avatar/profile cleanup, receipts/lease retries, official Auth hard-delete LAST; re-register same verified email -> new UUID, no CH/XP/profile inheritance. Check protected bonus denial with history/key unavailable; this is negative anti-farming evidence, not positive bonus eligibility proof. Google only with dedicated identity. Compare control UUID/objects/balances and ledger conservation. Service restart/fault affecting others requires explicit window authorization. Existing retained fixtures are excluded unless individually authorized.

At end feature OFF, preserve financial/bonus/history evidence and report PASS/FAIL/NOT TESTED. Financial mismatch -> incident/STOP, no manual repair. No false done/COMPLETED, guard disable or rewritten historical receipts.

## Failure / forward fix

Keep feature OFF until readiness. A failed schema/runtime check stops activation; preserve manifests, backups and receipts. Applied migrations are immutable; use a reviewed forward fix. Never restore legacy XP, downgrade V3, undo ledger history or make markers pass by changing booleans without evidence. Production Account Deletion and merge remain separate decisions.

Historical campaigns, hashes, hosted source SHAs, API formats and test limitations remain in research.md; current tasks are in tasks.md. This preparation authorizes no remote writes, activation, deployment or cleanup.
