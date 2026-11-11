# Production schema-only 67 → 69 — COMMITTED / PASS

Execution response: 2026-10-28T15:43:10.436Z. PR #1155 remains OPEN/Draft at a87e06c4335e7c8170d523b4f8d9497c4372c3cc. LEGAL OPEN. This report supersedes the earlier local-only/unapplied status for these two equivalents only.

## Preflight

Project otbqfijerkieoxwpxjnm (arcade-portal, eu-west-3), system7575202818581710058, operatorpostgres. Exact67-version inventory, prior names/statements fingerprints, provisioning definitions/owners/ACL, profile columns/RLS and signup/lifecycle/updated-at triggers matched the captured baseline. Eleven profiles; protected original-field SHA256 stable over two independent preflight reads. No additional related SECURITY DEFINER paths, conflicting DDL/locks, active human/resume/funded seats, pending human requests, recent human financial operations, negative user/escrow balances or recent unbalanced transactions. No established Production WS client sockets. Six bots on two tables had matching authoritative state/escrow; bot-only activity did not block.

Independent byte SHA comparison against approved hashes and replacement_migrations manifest passed for both files. The candidate batch was also rebuilt/compared byte-for-byte with the two unchanged operational bodies, removing only each outer BEGIN/COMMIT and adding the approved wrapper/settings. No identity/pin/timeout/format substitutions. GUC source hashes were not used as integrity evidence. Existing published WWW/WS source had no identified frontend RPC consumer; ensure_user_profile is called by the privileged server repository. No active SQL RPC consumer was observed. Unidentified external clients cannot be exhaustively excluded.

## Single execution / receipts

One non-retried operator request sent the exact approved batch, one outer BEGIN and final COMMIT; HTTP201. Independent new read confirmed COMMITTED,69 versions and precisely these two new receipts:

| Version | File | statements receipt |
|---|---|---|
|20261026120000|supabase/production-migrations/20261026120000_profile_phase_a.sql|source_sha256=edf83e55891441213695b8c9f04d72b2ffd34151aa58239179fa60056ff6a862|
|20261028180000|supabase/production-migrations/20261028180000_public_profile_block.sql|source_sha256=87d747891527dbe85fe542af91fe0965a2fb67ebd4222dab5f40bee52fb32eaa|

Batch SHA256:5495db1114eeb0a6c31816d602905ddff5d3b230de4885e8d17607e15272abd6. No retry, bulk migrator, extra migration or rollback performed. Previous67 complete metadata records are identical; no historical hashes were backfilled. This is69 versions with two new source receipts, not69/69 historical file hash provenance.

## Independent postflight

Eleven original profiles, all prior fields including UUID, handle/name, BIO, avatar_key/variant, handle_customized_at, privacy and timestamps unchanged. SHA256 before/after (excluding only the three newly added columns):

`a18f9872614ef55834150a939b5053721289b3c464fb64a2a85794ac530a2856`

New columns: avatar_revision integer NOT NULL DEFAULT1 (range check retained), google_photo_suppressed boolean NOT NULL DEFAULTfalse, public_profile_blocked boolean NOT NULL DEFAULTfalse. All original revisions1, suppressionfalse, blocksfalse. No existing constraint/grant/RLS removed; only the approved revision check and block guard were added. BIO retained (zero nonempty); one legacy avatar_key remains attached. Existing six assigned variants unchanged.

Policy: version2026-10-26-a1, active=false, variants_enabled=false, identity_normalized_at=NULL; Terms receipts0. Provisioning body SHA matches approved6ca1c1ef540273b9fae6d38dfd1c0e4ee3ed16b9ec0abcb8e9caf1bf675ad6ca (six variants while catalogOFF). anon/authenticated have no EXECUTE on ensure/signup; service_role retains both. Original signup/lifecycle/updated-at triggers preserved; new invoker guard ownerpostgres, search_pathpg_catalog, ACLpostgres-only. No unexpected related SECURITY DEFINER or policy-write privilege.

Protected-table transaction-counter guards in both approved SQL bodies passed before COMMIT: no migration DML to existing profiles/Auth/CH/XP/Poker/deletion/Storage. This does not claim live bot state or financial archives are globally frozen; bots continued normally. Independent financial safety read remained balanced. No archive fingerprint scan or financial test performed.

## Unchanged releases and read-only smoke

- playkcswh published deployment6ae19488f50eb5ff7e60f7e6, SHA0f77574d74945aa3b64b4e5e81494e621d7b2794 — unchanged.
- landing-kcswh published deployment6ae194d817674a2d5690830b, stop_builds=true — unchanged.
- WS Production releasea63e44b0d9a1d3625956ed98b75c1242989efdd3, PID386175, start2026-10-26 12:10:53UTC — unchanged; serviceactive. Local/public healthz200/ok; no journal entries/errors in the checked10-minute window.
- Portal, Account, Poker, landing, one existing public profile and leaderboard GET:HTTP200. The first leaderboard probe used invalid period=all and correctly returned400 invalid_period; corrected existing-contract period=all_time returned200. No code/config change was needed. Public reads may increment normal short-lived rate counters; no financial write smoke.
- Real new-account signup, provisioning writes, owner PATCH, JOIN and block/unblock:NOT TESTED on Production, intentionally outside schema-only GO. Deployed function/ACL/trigger compatibility was verified read-only; actual write behavior was covered by the approved isolated PostgreSQL17 tests.

## Breaking impact / stop point

Intentional direct RPC restriction: anon/authenticated ensure_user_profile and trigger-function EXECUTE now denied. Authorized backend and signup paths retained. Additive schema keeps old runtime fields/BIO/key; no runtime deployment, normalization, catalog16, Terms activation, block activation, APK or Stage mutation. No push/Ready/merge. Stop here; any runtime rollout or further flag/data change needs a separate GO, with #1158 coordination still pending. LEGAL OPEN.

Detailed operational evidence is retained privately outside the repository. No account identifiers, credentials, tokens or private snapshots are included in this report.
