# #1159 PR1 — Explicit Stage Migration Apply

Status: implementation candidate for Draft review; no live Stage/Production connection or migration authorized/performed. Base main0f77574d74945aa3b64b4e5e81494e621d7b2794. Scope implements PR1 of the approved #1159 plan, not release cutover or Preview/APK redesign.

## Behavior and trust boundary

DB Stage Apply PR now only supports manual dispatch of inspect/apply from main. It does not subscribe to PR opened/synchronize/reopened/Ready. Definition and Node-only executor are checked out at workflow github.sha; main SHA is independently checked against GitHub. Source must be an open same-repository PR pinned to exact fullSHA, rechecked before database access. No PR checkout, package install, hooks, runner script or migration validator from PR is executed with Stage credentials. GitHub tree catalog metadata is read; only named approved SQL blobs are downloaded, SHA256 verified and stored as non-executable JSON data.

Approval pins sourceSha, PR number, complete current history count/fingerprint and ordered file/SHA256 set. Confirmation includes Stage project, sourceSHA and canonical approval digest. Source filename/version validation and pending-set comparison reject missing/extra migrations, applied-history drift and unsupported transaction/psql control. The source branch must include all versions already on Stage; PR1's main-based branch is not itself proposed as a Stage migration target while shared Stage includes unmerged #1155 versions.

Inspect is a read-only transaction and never creates/backfills metadata. History metadata missing/orphaned means STOP, not reset/backfill. Apply takes bounded advisory/history locks and repeats system/history checks inside ONE transaction; approved operational SQL, both receipt tables, CH schema/GENESIS smoke and expected receipt fingerprint precede the one COMMIT. A sole original BEGIN/COMMIT wrapper is removed by a top-level lexer; internal transaction exits/psql commands/unsupported escaped quote syntax are refused, not silently guessed. Nontransactional operations require separate review. Original approved files/hashes are unchanged.

PG connection is pinned to direct Stage host5432/databasepostgres/project/system; sslmode=require or verify-full only. Password URL never appears in psql argv. Libpq receives credentials through environment; SQL uses stdin. No inherited psql rc, password prompt or raw SQL/connection/NOTICE/DETAIL output in error logs. Controlled error codes and public migration metadata only. Lock timeout3s, statement/idle timeout60s, whole psql invocation cap5min; timeout is STOP, no retry. Lost COMMIT result requires independent inspect. Exact batch already committed with correct receipts is no-op; historical hashes are never overwritten.

The former DB Stage Prepare arbitrary-ref executor is removed, not left as an unsafe alternate route. Existing active runbooks/agents policy updated; the large older Stage design is explicitly historical. No sudo/runner/secrets configuration, new dependency or database migration changes.

## Fundamental local evidence

Existing tests/db-stage-workflows.guard.test.mjs now tests trust/workflow boundaries, exact approval/hash/pending rejection, SQL transaction-control refusal, argv/error secrecy, and approved-SQL-only preparation with fork/head-drift denial. Existing disposable PostgreSQL contract job runs the same fixture; core invocation skips only the explicitly opted-in DB case.

Local isolated PostgreSQL17 system7701225723289707303 (neither Stage nor Production), loopback55465, dedicated fixture databases. Positive two-migration/one-COMMIT receipts; full late-failure rollback, original-approval replay/no-op, independent system/history checks, genuine competing table-lock timeout and protected CH/XP/avatar/privacy/Poker fixture invariance PASS. No real Stage account or network used. Real hosted Stage dispatch is NOT TESTED and requires separate GO after reviewed main publication.

## Breaking impacts and handoff

Ready no longer enables shared Stage SQL. Arbitrary-ref prepare, metadata bootstrap/backfill and old --db-url/--changed-from CLI paths are retired. Operators must provide exact approval and confirmation; missing history or a different branch's Stage versions blocks the request. Production/WWW/WS/Android runtime and SQL files are unchanged; no WS Preview deployment required. Keep current required check names/financial coverage. This PR cannot change already-running historical workflow runs; no apply was dispatched here.

Publishing this Draft PR runs nonmutating hosted checks/Netlify Preview only; no SQL file added, no Stage workflow event, no Production push. Separate OWNER GO required for merge or actual Stage inspect/apply. Production auto-deploy remains as before; neither WWW nor WS cutover is attempted. LEGAL OPEN.

## Review correction — OWNER-only apply

Mutating apply requires exact GitHub actor AND triggering_actor `krzysztofcal`. Job admission blocks other dispatch/rerun users before runner allocation; executor repeats the same check before bundle/credential processing. OWNER rerunning another writer's original dispatch is also refused. Confirmation remains the scope pin, not authorization. Inspect remains trusted-main/read-only under approved scope. No new auth framework/Environment or settings mutation; no claim of two-person approval.

Public repo currently lists only OWNER as collaborator; existing two Production environments have no reviewers. Required Environment review is available for public repos but would require separate settings GO. Removed DB Stage Prepare has no active caller/required check; old design is explicitly historical. New fundamental test denies writer/foreign/missing actor, mismatched rerun, PR/branch context and verifies early CLI refusal; SQL/transactions/receipts unchanged.
