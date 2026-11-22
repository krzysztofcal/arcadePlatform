# Feature Specification: 16 avatars, Google photo and UGC safety, Stage → Production rollout gates (#1310)

**Branch**: `1310-ugc-rollout-readiness` · **Created**: 2026-11-22 · **Base**: `main` @ `98fb6fac`
**Status**: plan and research only. No SQL write, migration, Netlify environment change, Candidate operation or publication is authorized.
Each step in plan §4 needs its own OWNER GO.

## Goal
Show the 16 catalog avatars and the optional Google photo, with consent, report/block and moderation, working end to end:
- first on **Stage**, using a Deploy Preview bound to Stage data;
- then activate them on **Production** in a reviewed, forward-only order.

The plan must say plainly which steps change the shared Production backend that LIVE WWW uses. It must not promise anything that works only for a Candidate.

## User Scenarios & Testing *(mandatory)*

### US1 — Stage functional acceptance (P1)
On a Stage-bound Deploy Preview, the OWNER sees and checks each of these:
- 16 catalog choices;
- separate, unchecked Google-photo consent: g2 for the profile and leaderboard, g4 adds Poker tables;
- proof of the linked Google account, then import, and the fallback to Arcade;
- withdrawal and deletion tracking;
- report/block in both directions;
- the moderation queue with an avatar hold.

No Production data or function is touched.

### US2 — Production activation without surprise (P1)
Each Production step lists:
- its exact effect on LIVE WWW (`308806cc`, which already ships the B/C/D UI and 16-variant support);
- its effect on Android, if any;
- its rollback.

Nothing goes live before:
- the matching legal text is published;
- Play Data Safety matches;
- the moderation operating process exists.

### Edge Cases
- A Candidate built in the Production context uses Production functions and data. Branch-scoped Netlify flags do **not** apply to it, so a feature-ON Candidate requires the Production flags themselves.
- `variants_enabled=true` on Production changes LIVE immediately: LIVE reads `status.variantsEnabled` and shows 16.
- `POKER_TABLE_PHOTO_ENABLED` needs code that LIVE lacks: `netlify/functions/poker-table-photo.mjs` and the g4 Account text. It may only follow the publication of a WWW release that contains #1282, together with Privacy a5.

## Requirements *(mandatory)*
- **FR-001** Stage first. Acceptance runs on a Deploy Preview of the release candidate code. That code is `main` after #1311, so the Account performance fix is included.
  The Deploy Preview flags `UGC_SAFETY_ENABLED`, `GOOGLE_PHOTO_IMPORT_ENABLED` and `POKER_TABLE_PHOTO_ENABLED` are set only for that preview (branch or deploy-preview scope). This needs a separate OWNER GO for the Netlify non-Production context.
- **FR-002** Production schema changes come only from reviewed **production-equivalent** migrations under `supabase/production-migrations/`, following the established pattern of `20261026120000_profile_phase_a.sql` and `20261028180000_public_profile_block.sql`:
  - pinned project and system identifier;
  - confirmation settings;
  - lock and statement timeouts;
  - a manifest entry;
  - no history repair.

  Applying a raw `supabase/migrations/2026110712/13/14*.sql` file or running `db push` on Production is forbidden.
- **FR-003** Gate order:
  - `UGC_SAFETY_ENABLED=1` requires the B and C equivalents, the admin moderation path and a documented moderation owner, cadence and response time.
  - `GOOGLE_PHOTO_IMPORT_ENABLED=1` additionally requires all of these:
    - the D equivalent;
    - the private bucket `profile-avatar-uploads`;
    - account-deletion avatar tracking (already `1`);
    - legal and Data Safety.
  - `variants_enabled=true` requires a Production-specific catalog operation. The Stage `enable-catalog.sql` must not be reused unchanged.
- **FR-004** None of these steps is ever bypassed: no fake 16-variant UI, no per-Host/Origin switch, no temporary global toggle.
- **FR-005** Every step has a rollback without data loss.
  - Flags: OFF. The endpoints go dark, and stored copies and consent records remain.
  - `variants_enabled`: false. Existing choices stay valid.
  - Schema: additive and never dropped.

## Success Criteria *(mandatory)*
- **SC-001** Stage acceptance evidence (US1) is recorded in #1310 without personal identifiers.
- **SC-002** Production equivalents B/C/D and the catalog operation are reviewed by Codex and approved by the OWNER.
- **SC-003** Each Production step is executed under its own GO, with read-only before/after receipts.
- **SC-004** A new WWW Candidate (from main after #1311) is tested with the features ON only after the Production steps it depends on. Its publication is a separate OWNER decision.
