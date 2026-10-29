# T012 — selective normalization, Stage COMMITTED (2026-10-27)

## Owner acceptance

Owner confirms physical Android PASS after catalog16 activation: all16 choices visible, selection/save work, Account/Online/Single Player/Offline show the correct current avatar. Catalog16 Stage accepted. Previous UX/save/Offline acceptance remains valid. No new APK/retest requested or performed.

## Proven conditions and minimal SQL

Reviewed agents.md/skills.md, spec/plan/tasks, immutable provisioning/Phase A migrations, the old writer at main a63e44b and the current writer. Old updateUserProfile stamps handle_customized_at only when final handle actually changes; it does not mark display-name/BIO edits. Provisioning supplies NULL marker and exactly the known adjective/noun vocabulary with suffix100000–999999. Current Phase A rejects manual identity writes. This known writer contract plus NULL marker is evidence to retain a generated handle; a regex alone does not establish provenance. Operator/out-of-band changes without the marker cannot be reconstructed from content: stop if contrary writer evidence appears, rather than pretending to infer history. No new provenance store is introduced.

| Category | Exact condition / change |
|---|---|
| Handle | Non-NULL customization marker, or NULL marker with handle outside the exact existing generator domain. Generate through private.arcade_profile_identity(), max16 uniqueness attempts. A manually chosen generated-looking handle with non-NULL marker still changes. |
| Display name | Handle changes, or display_name differs from initcap(replace(retained_handle,'-',' ')). Use the generator's returned display_name when handle changes. An already identical value needs no write. |
| BIO | bio<>''; clear it. |
| Legacy photo | avatar_key IS NOT NULL; ensure existing tracker with ON CONFLICT DO NOTHING, then clear key. No object delete or tracker reset. |
| Avatar revision | Increment exactly once only when detaching a non-NULL key. This source withdrawal invalidates stale media/CAS operations even though Phase A already renders the catalog; name/BIO/handle-only updates do not increment it. |
| Suppression | Set true only on photo withdrawal; otherwise preserve existing true/false. Future C may offer a new explicit opt-in; normalization neither grants consent nor disables clean accounts' future choices. |
| Handle marker | Never write it. It records historical use of the old one-time customization, not the date of this operator normalization. Keep it even when replacing the current handle. The global one-shot identity_normalized_at prevents reprocessing; never clear that marker to rerun cleanup. |

The script first fixes eligible IDs only (not every profile), excluding any deletion-linked profile; takes lifecycle locks in UUID order, then policy lock, then fresh profile row locks; rechecks deletion and actual fields after locking. Profiles whose pending photo was already removed during the wait can be skipped. One UPDATE per affected profile, existing touch_updated_at trigger only for those rows. No UPDATE on correct profiles. Profile disappearance is safely skipped. Existing one-shot advisory lock, global completion timestamp, transaction/uniqueness recovery retained; lock_timeout2s and statement_timeout15s added. Missing/version-mismatched policy fails closed. The batch is bounded to1000 profiles; no new batching/checkpoint mechanism.

## Fundamental evidence

Existing profile-phase-a test expanded, not a new suite: correct16-variant profile untouched including updated_at; name-only/BIO-only/photo-only/custom/unknown/generated-looking-custom cases; exclusion of dirty deletion profile; stable historical marker, UUID/email, selected new variant, privacy and synthetic CH/XP/escrow/ledger/hand data; tracker preservation; late exception rolls all changes back; successful rerun changes neither profiles nor completion time. Shared inventory predicates checked against the same synthetic cases. Real lifecycle trigger body is taken from the immutable V2 migration.

RED: old SQL changed the correct zen-lime profile, incremented revision, set suppression and fabricated customization time. GREEN: existing Phase A suite12/12, including the targeted normalization contract. The same test passed against installed isolated PostgreSQL17 at loopback55449, database profile_normalization_guard_test, system7701343315731429938; no remote credentials or connections. Real late-error ROLLBACK, profile touch/unique constraints and lifecycle trigger exercised. Isolated server stopped, test data retained, no cleanup. Syntax235/CSP58 and whitespace PASS; no frontend/CSP/SRI artifacts changed.

## Actual Stage read-only dry run

Pinned project krydukthwdvccggbyjfw, PostgreSQL system7656985631720456337, migration/file hashes119/119 matching. Policy version2026-10-26-a1, active=false, variants_enabled=true, identity_normalized_at=null; receipts0. Only BEGIN TRANSACTION READ ONLY / aggregate SELECTs / COMMIT used, no authenticated app smoke or provisioning invocation.

| Planned operation | Profiles |
|---|---:|
| Distinct affected profiles | 2 |
| Entirely unchanged profiles | 49 |
| Customized handle → generated handle | 1 |
| Unknown/unmarked handle | 0 |
| Display-name normalization | 1 |
| BIO removal | 1 |
| Photo key withdrawal / revision+1 | 1 |
| Suppression false→true | 1 |
| Handle marker writes | 0 |
| Deletion-linked excluded | 0 |
| Missing photo tracker inserts | 0 |

Categories overlap; do not sum them to obtain profiles. Existing Storage objects2 and tracked objects3 remain. Current variant counts: comet-blue9, falcon-orange4, fox-blue11, nova-purple9, orbit-green7, panda-pink10, bolt-yellow1. All51 variant assignments, including the newly selected variant, must remain identical after a future execution.

Control fingerprint of full existing profiles:3e7af0ac758f53ff769837b039f25556. Protected UUID/variant/privacy/historical-marker/created_at fingerprint:3c4326c4219289f8f90ccc1339614505. These are current observations, not permission to execute after drift. Expected after:51 profiles;49 rows entirely unchanged; exactly the approved fields on2 rows; one revision increment and one suppression transition; no new tracker currently necessary; zero new/deleted profiles or Storage objects. No expectation of globally frozen bot hand/financial counters is inferred while WS is running; the script has no writes to those tables.

## Breaking impacts and phase C

One old /u/<handle> link is expected to become normal not-found; no alias history or permanent reservation of the old handle. One legacy name/BIO is replaced/cleared. One stored photo key is detached while the selected catalog variant stays unchanged; existing catalog projection already ignores uploaded photos. Old cached clients/media can remain stale until refresh, and an in-flight old revision can correctly receive stale_avatar_revision. No automatic retry. Storage content/trackers stay for a separately approved retention/purge operation. No consent/import, recurring photo suppression, deletion reset or B/C/D functionality is implemented. This one-shot Phase A operation must occur before any future C importer is enabled; do not reuse it to revoke a later valid C photo.

## Reviewed execution plan — subsequently executed under explicit GO

Authorize only normalization on Stage after reviewing this SQL and renewed aggregate counts. Pinned normalize-profiles.sql SHA256:240727315086dbaae08017e4874aceab63ee1efb05c0407c6bed9a2cb12e054b. This is an operations file, not a historical migration or pending-migrations workflow.

1. Confirm approved application/schema/readers, project/system identity,119/119 migration hashes, catalogON/TermsOFF/version, normalization timestampNULL, closed upload/manual writers and absence of a C importer or competing operator normalization. Capture restricted before fingerprints and compare the2 candidate rows only in operator memory; do not export/archive personal content. Rerun inventory; stop on changed counts/scope or unexplained drift. Do not pause bot games or run a financed smoke.
2. In one controlled transaction execute the reviewed operational body with its existing BEGIN/COMMIT handled once, bounded waits and lifecycle→policy→profile order. Add before/after assertions in the operator-reviewed transaction, not a second nested transaction. Recheck selected rows after lifecycle locks, exclude deletion, assert allowed field deltas and protected/49-unchanged fingerprints before COMMIT. No table lock ahead of lifecycle locks. No other SQL mutation except the approved profiles/tracker/completion marker. On any exception roll back the whole transaction and stop; do not blindly retry an uncertain commit.
3. Read back policy timestamp, counts/fingerprints, one detached key/revision increment, unchanged marker/51 variants/privacy/Auth/deletion and trackers/Storage counts. Do not call public-profile rate-limited endpoints or create sessions/accounts without the separately approved smoke scope. Existing shared WS needs no restart; APK needs no rebuild. Do not claim one historical privacy/financial snapshot freezes concurrent unrelated bot activity.
4. Unexpected postcommit result: STOP and inspect; no automatic restoration of personal content or reset of flags/revisions. No Storage purge/contract/drop/TermsON, Production or financial operation is included. Record the one-shot completion in existing identity_normalized_at; do not fabricate a119th/120th migration history entry for this operation.

Historical preparation result: T012 preparation/inventory/tests PASS; actual execution was still gated then. The executed result below supersedes that status. T033 catalog/accepted client gates PASS; independent legal/Terms-ON integration remains OPEN. No new funded acceptance requirement, Ready or merge.


## Executed owner GO — COMMITTED / independently verified PASS

Application/source commit bc4a5e1cd9f016a31ab98a9686b9ba7aa15c8201; approved file SHA256240727315086dbaae08017e4874aceab63ee1efb05c0407c6bed9a2cb12e054b unchanged. Stage identity7656985631720456337/project krydukthwdvccggbyjfw and119/119 matching migration hashes reconfirmed. Before fingerprints/counts exactly matched the approved dry run; no pending deletion, competing normalization or unexpected lock. WWW Preview exactbc4a5e1c; WS ea178bb3/PID442909/start11:36:33UTC/healthok unchanged; accepted APK unchanged.

Exactly ONE Stage write request ran the unmodified operational block inside a controlled single transaction (no nested BEGIN/COMMIT). Lifecycle locks for the two approved candidates, then policy, then profile locks; profile table SHARE lock only after lifecycle/policy stabilized the49 untouched records for assertions. Existing2s lock/15s statement timeout plus bounded transaction/idle timeout. In-memory before/after row comparisons checked every field and exact category counts; no personal contents exported. Transaction-local pg_stat_xact_user_tables delta check allowed only user_profiles UPDATE2 and profile_terms_policy UPDATE1, all other user-table INSERT/UPDATE/DELETE0, including Auth, finances, XP, Poker, Storage and trackers.

Successful COMMIT and independent later read agree on identity_normalized_at **2026-10-27T16:27:07.558528+00:00**, version2026-10-26-a1, active=false, variants_enabled=true.51 profiles and51 Auth users remain. Raw after counts: nonempty BIO0, attached avatar_key0, noncanonical display names0, historical customization markers1 (preserved). Current16-catalog assignments/counts unchanged. Existing tracker rows3 and profile Storage objects2 unchanged; all Storage objects104267 unchanged. Migration history/file hashes119/119 unchanged, no synthetic migration entry.

| Fingerprint (MD5, same aggregate ordering before/after) | Before | After |
|---|---|---|
| All51 full profile rows | 3e7af0ac758f53ff769837b039f25556 | 7354a08664e6bc8308ee6d4fffbcdacb |
|49 entirely untouched rows | 9bee3eba3c733dac0d5a282ee0d159b1 | 9bee3eba3c733dac0d5a282ee0d159b1 |
| Two approved changed rows | e59d12185f54e4f551c634e23d36eea5 | eb75ffab7b380d361746d380320e71b0 |
| UUID/variant/privacy/historical-marker/created_at | 3c4326c4219289f8f90ccc1339614505 | 3c4326c4219289f8f90ccc1339614505 |

The first row changed only handle/display_name/BIO/updated_at; the second only avatar_key/avatar_revision(+1)/google_photo_suppressed/updated_at. No revision bump on the identity/BIO-only profile. Before-COMMIT assertions enforced this exact delta, exactly one change per approved field category and zero extra profile changes. Auth/deletion/tracker/scoped-Storage/history hashes were also independently identical before/after. A running bot service is not claimed globally frozen: zero transaction-local writes to all financial/game tables proves this operation did not alter them; no financial transaction or smoke was initiated.

Read-only preflight initially timed out hashing all104267 Storage metadata rows. It was stopped BEFORE any mutation; the control was narrowed to the two relevant avatar objects plus the overall object count and zero Storage writes. Scoped snapshot passed. No Stage write was retried. The transaction-control block was additionally checked on retained isolated PostgreSQL17: forced late error rolled back all changes; successful path and exact write-set assertions passed. A later independent verification SELECT had a corrected parentheses typo; it was read-only and repeated no mutation. No Stage rollback was necessary or performed.

Restricted receipt directory: /home/copilot/.local/state/arcadeplatform/t012-stage-normalize-2026-10-27T16-27-06-803Z (0700/files0600): source controller/controlled SQL, before hashes, actual response and independent after read. Only aggregate/hashes, no raw profile snapshots persisted. No Auth codes/tokens/credentials logged. Local PostgreSQL stopped, retained test files untouched, VPS5.3GB free.

T012 actual normalization PASS/complete. T001 legal/Terms and the independent Terms-ON/current-receipt/UGC branch of T033 remain OPEN; T010 reference/contract review and final Phase A acceptance still need their own GO. Storage retention/purge is independently gated. No contract/drop, enable-terms, Storage purge, funded action, Production, WS deployment/restart, APK rebuild, Ready or merge. Stop before next Stage mutation. Evidence docs are updated locally and PR description remotely; no documentation push triggering another automatic APK build in this operational task.
