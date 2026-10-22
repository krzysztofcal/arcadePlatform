> **Current pre-merge gate (21 October 2026):** T07b PASS; #1124 Ready for Review, **merge STOP** pending [Production compatibility plan](production-compatibility.md). Production65 migrations differs from Stage117; P1 local equivalent/tests PASS, PC2 schema apply/PC3 release/PC4 activation still require separate GO. Historical execution instructions below do not authorize another Stage campaign or bypass this gate.

# Implementation / remaining rollout plan — #1117

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. Current permission is local code/tests/documentation and read-only review, not activation/destructive E2E/Production deployment/merge.

## Code and schema

1. Restore netlify/functions/_shared/welcome-bonus.mjs to existing UUID welcome-bonus:<UUID> ledger path; remove reward-identities.mjs and all HMAC/release wrappers. Existing ledger lifecycle/idempotency does the security work.
2. bonus-campaigns.mjs keeps normal UUID policy/UTC decision clock/streak, campaign serialization and one transaction for ledger+bonus_claims. Read retained private.bonus_campaign_paid_totals for lifetime campaign quota. No cross-account lookup or JS counter increment.
3. Read-only migration history proved20261020094949 unapplied Stage+Production; delete that pending HMAC fence and unused manual proposal, preserve applied20261018184941 byte-for-byte. New forward20261020190000_account_bonus_uuid_policy.sql removes only unused EMPTY reward identity tables, seeds monotonic campaign totals from actual distinct claim/hot/registry receipt IDs, and installs independent deferred PROMO quota guard + zero initializer for new campaigns. No release flag/HMAC dependency; Welcome is excluded. Unexpected populated recognition data -> migration NO-GO for review, never silent deletion. Known archival replay does not increment count.
4. Existing shared/account-deletion.mjs, ws-server/poker/runtime/account-deletion.mjs, CH retirement/retention, Storage v3 tracking/reconciliation, exact Auth-last and Redis V3 remain intact. No runtime Storage refactor for accepted#1128 edge.

## Remaining execution sequence (separate GO)

- Stage identity/hash/guard/flags preflight; expected115 applied, exactly pending20261020094224_account_avatar_reconciliation.sql +20261020190000_account_bonus_uuid_policy.sql. No automatic Stage apply from Draft; Production schema/config unchanged.
- Review/apply only these forward migrations on Stage while deletion OFF; verify campaign counter baseline against real evidence, no recognition tables, no payout blockage by release/HMAC. Deploy matched Netlify Preview and main-defined exact-SHA WS Preview/V3; do not deploy Production.
- T05e authority/inventory/cutover evidence completed on21October: only the2explicitly approved CLI artifacts retired after publication/alias/split checks; real DB cutoff05:08:31.517Z, expiry07:08:31.517Z,7220.119s elapsed and unchanged5manifest/4object inventory verified. Stage metadata marker stage-avatar-authority-20261021 recorded with real reconciliation inventory/provider fieldsNULL; REDIS-RELEASE already recorded, no reset/epoch change. Feature staysOFF. Still require separately approved matched runtime marker/configuration window and genuine request/lease/DELETE+absence reconciliation of the retained subject, plus actual full Stage E2E; no fixture receipt or cleanup is implied by readiness metadata. See current quickstart/research for exact scope.
- One separate conditional Stage E2E GO: disposable subject+controls, canonical funding/all-in/side-pot/settlement/cash-out, accepted deletion→old UUID denial→one balanced BURN→exact Storage/Redis/profile cleanup→Auth-last, same-email new UUID→normal Welcome, independent Daily/once, preserved global quota/control ledger. Fault/retry limited to fixture; shared restart requires window approval. End flags OFF. Dedicated Google identity separately; otherwise NOT TESTED.

## Breaking impact / forward fix

New UUID intentionally receives Welcome again; farming risk accepted, no existing CH removed. Campaign max_total_claims no longer replenishes on Auth/claims deletion (preserves intended global semantics). Quota SQL is independent of deletion release, so deploy schema before matched code and test legacy atomic writers; a missing claim for new PROMO cannot commit. Empty unused HMAC tables are dropped only by new forward migration, applied hashes unchanged. Never roll back ledger/counter history or switch to an older counter writer/disable guards. Feature stays OFF if readiness fails; preserve evidence and forward-fix. Account Deletion-specific privacy/financial retention remains existing policy; HMAC policy belongs solely to#1131.

Validation uses existing PGlite/UUID bonus, Welcome/Daily/campaign, ledger/retirement, Storage/full local flow, Redis and WS fundamentals, syntax/CSP/guards/migration manifest/CI. No new package, service, table, OTP or infrastructure.

## Protected Stage deletion window (local implementation, 21 October)

Use the fixed `infra/vps/stage-deletion-window.py`, existing SecureFiles primitives and separately protected window record; do not repurpose Redis0 configuration apply. Prepare backs up OFF/helper and installs reviewed preflight without activation; activate changes only flag/authority marker; restore returns exact OFF bytes. Original preparation remains immutable. Helper independently derives ON from approved OFF, rejects missing/foreign/transitional authority and keeps LIVE Redis/Stage checks. A crash resumes only known hashes; no arbitrary hash override.

Follow the installation/Netlify scope/activation/closure contract in quickstart.md. Read-only provider metadata confirmed branch-specific deletion0/tracking1 overrides and absent marker; Functions need alias-specific ON and OFF deploys. No site-wide override; preserve other contexts/scopes. Account for newly created ON immutable deployment before a subsequent window. DB release last ON/first OFF; WS worker remains enabled until every accepted operation is actually terminal. Existing scan is independent of DB release. Operator performs no restart, DB, Netlify, Redis, finance or Auth operation. Installation/restart/runtime verification and E2E remain pending separate GO. Historical cutover proof is retained, no re-wait/reset.

## Accepted Stage fixture confirmation contract — 21 October

Previous protected window is actually closed and its sole ON immutable deployment retired with204/404 proofs; no subject deletion/funding occurred. Owner resolved the reserved-email test setup constraint: only after genuine old Auth-last deletion and COMPLETED may a normal public signUp create the replacement UUID. Check persisted UUID differs, exact email matches, then official Admin email confirmation for ONLY that new fixture UUID. Never replace signup with Admin creation/SQL, never patch old/existing identities, and STOP on rejected signup. Deliverability/link confirmation remains NOT TESTED. Normal login, initial CH/XP/profile isolation and normal Welcome are still real app checks. This changes test setup authorization, not Auth configuration or bonus policy. Next window prepared on Netlify6ad8913597cbf65ecb017f0a/served91c while WS and DB remainOFF until guarded activation.

## Stage E2E recovery checkpoint — 21 October

The real accepted request is blocked by a terminal historical Poker seat (`stack_ambiguous`); DB releasefalse prevents new requests, while WS and Netlify stayON for recovery. Do not perform OFF restore/restart or ON-deploy retirement before terminal completion. No BURN/Storage deletion/Auth deletion has occurred.

Minimal local correction: `shared/account-deletion.mjs::deletionPokerSeatPendingSql`, reused by `createAccountDeletionRuntime.steps.poker` and `chips-ledger.mjs::retireUserForDeletion`. Exclude only fully proven CLOSED, terminal, INACTIVE0, stack-key-absent, ESCROW0 history. All unknown/live/value-bearing conditions still block. Preserve historical rows and all accounting behavior. Extend existing PGlite fixtures and one real-coordinator/ledger regression; no migration, service, config or Production change.

Separate next GO: exact-SHA WS Preview deployment and safe shared-service drain; retain DBfalse and recover the same durable request automatically. Check retry/idempotency and one balanced BURN, canonical Storage ownership/DELETE/re-read, Redis/profile cleanup and Auth-last. Then actual public same-email signUp; only after real new UUID may the approved Admin email-confirmation fixture setup run. Email delivery remains NOT TESTED. Re-registration and full E2E are not PASS until executed. Complete closure in existing order after all accepted requests are terminal.

## Recovery executed; remaining closure/review gates

Exact503be776 WS deployment39597072168 and natural same-request recovery completed on real Stage at2026-10-21T12:10:22.640Z, preserving incidenttrue. One balanced400CH BURN, canonical Storage receipts, two existing objects removed/seven exact paths absent, Redis/profile cleanup and official Auth-last succeeded. No manual ledger/lease/request edits. Details/private evidence boundaries are in research.md.

Same-email public signupHTTP400 stopped the re-registration stage; no new UUID/admin confirmation/Welcome. Do not substitute Admin creation. Review a new deliverable disposable identity procedure separately. Before merge review retained historical Poker rows (actual seats lack AuthFK) and completed+historicalincident API presentation; no remote repair authorized.

DBfalse/requests terminal and Netlify branchOFF verified on6ad8ac5e86ce1c2d1e5c96ee. Next is owner protected root restore, then authorized safe Preview restart/processOFF verification. Only then verify alias/fallback detachment and retire exact ON6ad8913597cbf65ecb017f0a. No migration/reset/re-wait/Production deployment. This docs/test-message-only checkpoint does not require another runtime deploy; installed503be776 remains the verified runtime.

## Closure verified —21 October

Owner root restored the exact protected OFF baseline; fresh WS Preview process20592/LIVE/health/browser Auth+WS and unchanged USER/CH/claims verified. DBfalse, requests terminal, NetlifyOFF6ad8ac5e86ce1c2d1e5c96ee. Retired ONLY detached ON6ad8913597cbf65ecb017f0a (204, metadata/functions404), aliases and Production unchanged. No further operator action or worker recovery is pending. Remaining signup/retention/presentation findings still require review before merge; this closure documentation does not change verified runtime503be776.

## Review plan: Poker privacy projection (NOT implemented; separate GO)

Scope: remove the deleted UUID from operational `poker_seats`, `poker_state` and nullable `poker_tables.created_by`; keep table rows, other players, ledger/entries/escrow, registry, durable `poker_requests.result_json` and archive hashes unchanged. Prefer exact owner-field removal over inventing a reusable anonymous player identity. Current private read-only audit proves TWO fixture tables CLOSED/HAND_DONE/handId empty/ESCROW0/no ACTIVE seats/no pending requests; both created_by also equal old subject. One snapshot contains subject in seats+handSeats and five owner-keyed maps, the other only seats. No FK exists from seats/state to Auth; their only FK is table_id→poker_tables CASCADE. Deleting the WHOLE table is therefore prohibited: it would destroy other players' data and bypass established retention.

Proposed files after approval: `ws-server/poker/runtime/account-deletion.mjs` (bounded cleanup after retirement and before Auth), `ws-server/server.mjs` (reuse enqueueTableCommand/restoreTableFromPersisted), existing table manager coordination, existing local deletion tests. No new service/table/worker/migration proposed unless implementation proves a missing necessary guard. This section defines queries, not permission to execute them.

Runtime discipline: serialize each table through existing `enqueueTableCommand`, then DB table lock→lifecycle lock→assert actual cleanup lease. Use canonical persisted state/version; after successful commit use existing `restoreTableFromPersisted` for cached tables so members/presence/profile/action-result caches cannot write the old projection back. Never only patch SQL underneath live RAM. Unloaded closed repair candidates can instead use existing beginTableRetirement/endTableRetirement to prevent bootstrap while CAS runs; skip loaded/pending-bootstrap candidates, do not evict other players. Preserve existing financial/account lock ordering; no financial UPDATE is needed.

Normal path requires real walletRetirement receipt and current owner/request/generation cleanup lease. Recheck canonical Leave/cashout completion, no owned stack/deferred rights, no unfinished ACT/settlement. For the proven CLOSED case require HAND_DONE, empty handId, exact active ESCROW0, no active seat and no unresolved table request. OPEN tables must NOT wait for global escrow0/table closure (other players legitimately hold CH): only scrub after this UUID is absent from the current hand/stack/contribution/pending-detach rights, with authoritative queue+version and other-player conservation verified. If current-hand ownership or settlement is uncertain, retry canonical Leave/rollover; never remove an all-in participant or synthesize a cashout. The OPEN branch needs its own fundamental regression before this cleanup is called complete.

Discovery uses $1 deleted_uuid; per-table query contract is $1 table_id, $2 deleted_uuid, $3 old_version, $4 old_state, $5 generated_new_state:

```sql
-- Discover candidates for this UUID only. Actual fixture IDs stay private.
select distinct t.id from public.poker_tables t
left join public.poker_state s on s.table_id=t.id
where t.created_by=$1 or exists(select 1 from public.poker_seats p where p.table_id=t.id and p.user_id=$1)
   or strpos(s.state::text,$1::text)>0 order by t.id;
-- Per candidate, lock table first; then call existing lifecycle/lease guards.
select id,status,created_by from public.poker_tables where id=$1 for update;
select version,state from public.poker_state where table_id=$1 for update;
select status,stack,leave_after_hand from public.poker_seats where table_id=$1 and user_id=$2;
select balance,status from public.chips_accounts where account_type='ESCROW' and system_key='POKER_TABLE:'||$1::text;
select count(*) from public.poker_requests where table_id=$1 and result_json is null;
```

Projection is pure and field-aware: filter ONLY entries with userId=$2 from seats/handSeats, retaining order and every other element; remove ONLY key$2 from known owner maps (observed foldedByUserId, missedTurnsByUserId, contributionsByUserId, handStartStacksByUserId, lastBettingRoundActionByUserId; other current schema maps require explicit audited rules). Preserve absent fields/types rather than creating defaults. Do not recalculate pots, payouts, other-player stack/contributions, phase, handId or seat numbers. Require no remaining occurrence of the UUID anywhere in projected JSON; an unknown/embedded reference is NO-GO, not blanket text replacement. Shared terminal snapshot is no longer a full departed-player presentation; immutable financial/audit evidence remains authoritative for historical totals.

```sql
-- Same transaction, AFTER above safety checks. Exactly one row or rollback.
update public.poker_state set state=$5::jsonb,version=version+1,updated_at=clock_timestamp()
where table_id=$1 and version=$3 and state=$4::jsonb
  and strpos(($5::jsonb)::text,$2::text)=0 returning version;
-- Only this owner's settled seat; retry permits already absent with proven state.
delete from public.poker_seats where table_id=$1 and user_id=$2
  and status='INACTIVE' and stack=0 returning table_id;
update public.poker_tables set created_by=null where id=$1 and created_by=$2 returning id;
-- Postchecks: owner seat/creator/state references zero; all other seat rows and
-- the non-owner JSON projection equal the locked originals; CH/registry unchanged.
```

Keep `poker_tables.updated_at`, has_human_participant and retention markers unchanged; no accelerated archive/prune/table deletion. Skip state UPDATE entirely on an already-clean identical projection and absent owner seat/creator; retries must not keep incrementing version. Record actual table/version/hash cleanup observations in existing request progress only after committed successful effects; normal Auth-last must require that real privacy-cleanup result. Before normal Auth-last, re-read candidate closure/no owner references; missing or unexpected state, CAS loss or cache-sync failure blocks progress. No receipt alone substitutes for SQL/cache proof.

Completed fixture repair is a SEPARATE GO: exact old owner/request + exact TWO audited tables, DB/Netlify/WS remainOFF. Reuse the reviewed pure projection/CAS queries under real runtime retirement claims; lock and verify original COMPLETED request, old Auth absent, immutable BURN/registry receipt and retired USER0. No fake lease, no reopening/resetting completed request or BURN/Auth retry. Save protected before/after state/version and unrelated-player/finance digests; update only truthful supplemental privacy-cleanup observations if needed, leaving original completion/incident/financial receipts intact. Changed candidate set/state/version, loaded unsafe table or financial discrepancy means STOP. Do not execute ad-hoc hand-written JSON repairs. A lost response is reconciled by reread of exact rows/versions; never restore an old snapshot over newer state.

Fundamental tests proposed BEFORE implementation: the two closed shapes and idempotent repeat; OPEN table with other users' positive escrow and no deleted-user rights; active all-in/pending settlement rejection; stale CAS/cache rehydration; identical other-player state and unchanged ledger/registry; completed-request repair without lease/status/finance edits. Broader retention/history rules remain unchanged.


## Poker privacy cleanup — local implementation after review (21 October)

This section supersedes the earlier implementation-pending proposal; remote cleanup is NOT performed. Normal deletion uses `cleanupDeletionPoker` in `ws-server/poker/runtime/account-deletion.mjs` after an actual closed, zero-balance retired USER proof and before Auth-last. The durable request/lease is checked in each transaction. Auth authorization re-queries actual residual references, rather than trusting a progress flag.

Discovery is owner-scoped across `poker_tables.created_by`, `poker_seats.user_id` and JSON UUID references in `poker_state`. Tables are processed in deterministic order through existing `enqueueTableCommand`, table/state row locks and version+JSON CAS. Only INACTIVE zero-stack non-leaving seats can be deleted; only the owner's creator field becomes NULL. `projectDeletionPokerState` removes owner entries from seats/handSeats and explicit per-user operational maps. Unknown/embedded references block cleanup. Active owner participation, all-in rights, pending requests, unresolved detach and escrow mismatch block cleanup. CLOSED requires HAND_DONE, empty handId and ESCROW0; OPEN can retain other active players and positive escrow, which must equal their stacks plus live contributions. The shared drain/BURN predicate recognizes only this released-owner case.

The terminal `handSettlement.payouts` copy can contain a stale owner reference after canonical Leave. Before removing only that owner projection, the exact original settlement object is retained in the existing private request `progress.pokerPrivacyFinancialReceipts[tableId]`; a different existing proof is rejected. Other payouts/metadata remain unchanged. Ledger, immutable Poker request receipts, idempotency registry and archives are never edited. This retained financial evidence is an explicit privacy/retention exception, not a promise to erase UUIDs from immutable accounting history. No new table or migration is needed.

`createDeletionPokerCoordinator` fences the table-manager, queued commands and persisted writer entry points during SQL plus canonical restore. Restore failure leaves the table quarantined. A retry first restores even tables no longer found by SQL discovery. Stale lower-version restores are rejected. A process restart discards the old RAM cache; subsequent bootstrap reads persistence. Unknown references/failed restore may delay that table's actions until resync; other tables remain available.

### Separate completed-fixture repair — code only, new GO required

The existing token-protected loopback `/internal/admin/poker-maintenance` accepts `operation: repair_deleted_user_privacy` only in Preview, with `actorUserId`, an operator audit `requestId`, the exact old `userId`, original `deletionRequestId`, and exactly two distinct audited `tableIds`. Prepare this JSON and existing internal-token curl configuration only in private 0600 files; never put credentials on the command line or in Git. Caddy continues to deny the public internal path. No new endpoint, scheduler or service is introduced.

Preconditions: fresh pinned Stage identity; deletion OFF in runtime and DB; Stage Redis release namespace; original request COMPLETED/completed with no lease; old Auth absent; actual retired USER zero and original BURN registry proof; BOTH approved tables CLOSED, settled/empty handId, escrow0 and no unresolved requests; private snapshots of state/version, peers, immutable receipts and ledger. If additional owner tables are found, STOP. Never invent a lease, reset incident/status/phase, perform another BURN/Auth delete or alter financial balances.

After separate GO, first deploy this exact runtime through the main-defined WS Preview workflow while flags remain OFF and verify health/drain. Invoke the existing loopback maintenance operation with the protected payload/config. The completed repair locks both queues/tables/states in deterministic order and applies both tables in one transaction, bounded by 5-second statement/lock timeouts. Any audited state drift aborts all SQL modifications; retry uses the same original request and exact approved scope. Cache resync failure keeps mutations blocked; STOP and preserve evidence. Post-check zero owner refs in all three operational locations, original completion/incident and finance/peers/archives unchanged, actual cache synchronization, healthy OFF runtime. No repair has been run on Stage.

One-line invocation template for the later authorized operator (files prepared privately; not executed now):

`curl --fail-with-body --silent --show-error --config /secure/1117-repair.curl --data-binary @/secure/1117-repair.json http://127.0.0.1:3001/internal/admin/poker-maintenance`

Full hosted E2E remains OPEN: a supported deliverable test address must pass ordinary public signup, then post-delete new UUID/login/Welcome once; the earlier provider response was `email_address_invalid`, not evidence of redirect failure. Email delivery and Google remain NOT TESTED. Future repair/E2E requires separate GO; no environment changes accompany this implementation.


### Final review gates: read quarantine and protected repair approval

During privacy quarantine, `tableState`/`tableSnapshot` return only an unavailable response, and `resync` rejects access. Snapshot/state views carry an internal WeakMap generation; a captured pre-await view stays invalid after restore. Server snapshot/delta/table-state sends and broadcasts refuse blocked/stale views; direct persisted snapshot loading rechecks its view generation after await, and the existing authorized private-frame queue rechecks a delivery fence immediately before socket send. Starting quarantine clears the existing per-table snapshot and replay logs; resume rejects a blocked table. Successful canonical restore plus coordinator release re-enables reads and writes together. No public protocol field, database schema or scheduler is added.

The repair requires `/opt/arcade-ws-preview/.poker-privacy-repair.json`, a single-link regular file owned by root, group equal to the WS process group, mode0640, in verified root-owned non-writable/symlink-free parent directories. The fixed-path loader uses O_NOFOLLOW and a file descriptor, checks metadata/size before and after reading and pins the exact raw-file SHA-256 from the operator's protected request. An HTTP body cannot supply replacement manifest content or choose its path. No sudoers extension is needed.

Manifest v1 contains `stage: krydukthwdvccggbyjfw`, exact `userId`/original `requestId`, and exactly two `tables` entries with `tableId`, integer `version`, `stateSha256` and `cleanedStateSha256`. `pokerPrivacyStateSha256` hashes JSON with recursively sorted object keys and preserved array order; use this same exported helper for preparation, never raw SQL text or a different JSON serializer. Generate both original hashes and deterministic `projectDeletionPokerState` result hashes from fresh read-only private snapshots, review the exact UUID/table IDs/versions, preserve the source packet root0600 and record the raw manifest SHA externally. No manifest is installed by this code change.

After both queues and row locks are held, verify ALL approved versions/hashes before any modification; keep version+JSON CAS. Unknown version/content in either table rolls back both tables. An idempotent retry accepts only the exact original state or the manifest's exact approved cleaned projection at version+1 with no owner UUID; it never accepts arbitrary newer versions or overwrites the manifest to hide drift. Preserve all financial receipts, other-player state, escrow and original request completion/incident. A post-commit cache failure remains quarantined and requires canonical resync.

### One Stage-only execution plan — separate GO, not executed

1. Read-only preflight: pinned Stage117 migrations/guards, Redis V3 LIVE, flags/DB release OFF, original completed request/Auth absent/retired USER0/BURN proof, exact two CLOSED settled tables and escrow0; control, peers and immutable finance snapshots. Verify no unsafe human/pending settlement before restart.
2. Prepare/review the protected two-table manifest above from current snapshots and exact proposed projection. Any drift since audit requires STOP and renewed review, not automatic hash replacement. Preserve the private input snapshots and exact hash.
3. After GO, deploy the final runtime SHA through `WS Preview Deploy` from main, `ref=<reviewed-runtime-SHA>`, `xpRedisVersion=3`; verify installed SHA/both Stage contexts/LIVE/health/browser nonfinancial smoke and flags OFF. No Netlify deployment or deletion activation is required for this repair.
4. Operator installs only the approved manifest using existing protected-file/root procedure. Confirm `/opt/arcade-ws-preview` root:root0755, source under a root-owned non-writable path, WS process group arcade, manifest hash and single-link file properties before/after install. Example one-line command (only after substituting the reviewed hash and approved private source):

`test "$(stat -c '%u:%g:%a' /opt/arcade-ws-preview)" = '0:0:755' && test ! -L /opt/arcade-ws-preview/.poker-privacy-repair.json && install -o root -g arcade -m 0640 /root/1117-reviewed/poker-privacy-repair.json /opt/arcade-ws-preview/.poker-privacy-repair.json && printf '%s  %s\n' '<reviewed-SHA256>' /opt/arcade-ws-preview/.poker-privacy-repair.json | sha256sum -c -`

5. Prepare private0600 loopback curl config with the existing internal token and private JSON containing operation/actor/audit request ID/original request ID/old UUID/two table IDs plus `manifestSha256`. Invoke the existing one-line curl command above. No new lease/request, BURN, Auth action, flag change or migration.
6. Read-only post-check actual UUID absence, both expected state hashes/versions, synchronized current cache/no quarantine, unchanged peer balances/escrow/ledger/registry/immutable receipts/archives and completed+historical incident semantics. Retry the same packet only for the exact approved terminal projection. STOP on unknown state, uncertain external effects or financial mismatch. Keep evidence and all flags OFF.

Breaking impact: quarantined tables temporarily withhold state as well as writes; stale resync/replay is unavailable until canonical restore. The repair operation now requires an operator-installed protected manifest and SHA pin; old payloads fail closed. Normal deletion does not require that one-off repair manifest. No environment operation has been executed.


### Recovery from the first repair attempt

The first repair HTTP500 was fully rolled back and diagnosed as postgres-js serialized JSON parameter binding. Correct only serialized JSON parameters to `($n::text)::jsonb`; retain all manifest hashes, atomic scope, locks and version+JSON CAS. Do not replace the approved original hashes with new guesses, clear the original request/lease/incident, bypass the manifest, or correct data manually. After corrected runtime review/GO: fresh read-only original5/45/hash/finance/OFF checks → main-defined exact-SHA WS Preview deploy and smoke → single bounded repair using the SAME already-installed approved manifest → actual SQL/cache/finance post-check. Root installation need not be repeated. Current Stage has the15b5666f runtime and original operational references; repair is NOT PASS.


### Production P2 result —21October2026

Exact approved equivalent20261021191104 applied once at19:50:36UTC, reviewedSHA5036a5977b8c9572556830fa08dc8cc87589ff232270a6cb6d58064a7b429b3e; actual history65→66. Schema/ACL/retention/campaign counters and read-only old-runtime smoke PASS. Protected backup/evidence retained; normal bot-only financial deltas fully reconciled, USER/history unchanged. Deletion/tracking remainOFF,avatar-v3DISABLED; Netlify/WS remain82aee39d without restart/deploy. See [P2 evidence](production-compatibility.md). Do NOT repeat apply or run a migration directory. P3 standard merge/deploy and P4 activation require separate owner GO; no push/merge/deploy/Stage change authorized in P2. T07b remainsPASS.
