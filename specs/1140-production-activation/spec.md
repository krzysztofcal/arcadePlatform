# Feature Specification: Production activation of Google photos, UGC Report/Block, Poker table photos and the 16-avatar catalog (#1140, #1282, #1114)

**Branch**: `1140-production-activation` · **Base**: `main` @ `04e281a7` (WWW Production since 2026-11-25) · **Status**: plan only. Every Production SQL execution, flag change and release needs its own OWNER GO.

## Current Production state (read-only, 2026-11-25)
- WWW `04e281a7` (`release-20261125-45644195409`), WS `98fb6fac`. The code for all four features is deployed dark.
- Netlify Production flags: `UGC_SAFETY_ENABLED`, `GOOGLE_PHOTO_IMPORT_ENABLED` and `POKER_TABLE_PHOTO_ENABLED` are empty. `ACCOUNT_DELETION_ENABLED=1`, `ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED=1`, `PUBLIC_PROFILES_ENABLED=1`.
- DB migration history ends at `20261105160500`, the last applied version.
  - Missing Stage-only migrations without a Production equivalent: `20261107120000_ugc_reports_blocks`, `20261107130000_ugc_moderation`, `20261107140000_google_photo_consent`. The private tables do not exist.
  - The prepared but unapplied BIO contract is `20261027173627`.
- Profile policy: `2026-10-28-a2`, `active=true` (Terms ON), `variants_enabled=false` (6 avatars), `identity_normalized_at` NULL. Production still has the `bio` column.
- Privacy `2026-11-21-a5` describes Google photo import and the g4 table-photo consent. It does **not** describe user reports, blocks or moderation.

## Requirements
- **FR-001** Production-equivalent migrations in `supabase/production-migrations/` for the three Stage migrations, following the established pattern (`20261028180000_public_profile_block.sql`, `specs/1114-.../production-equivalents-review.md`):
  - `BEGIN`/`COMMIT`; lock 2 s, statement 15 s, idle 15 s;
  - an operator check (`postgres`), pinned project `otbqfijerkieoxwpxjnm` and system `7575202818581710058`;
  - a per-file confirmation setting and an approved source SHA-256 receipt;
  - the shared Production coordination lock, the exact expected history, and a nonblocking lock on `schema_migrations`;
  - schema only: empty tables, RLS on, no flag and no data change; a transaction-counter guard against unrelated DML;
  - a history row with `statements=['source_sha256=<hash>']`.
- **FR-002** `supabase/production-migrations/manifest.json`: append the three entries under `replacement_migrations`; reclassify the Stage entries; prior entries and hashes stay unchanged; the repository guard (`scripts/check-db-migrations.mjs`) passes.
- **FR-003** Validation in the existing harness (`tests/chips/chips.migration.test.mjs` with a disposable local PostgreSQL rebuilt from the Production history and synthetic data):
  - identity, confirmation and hash refusals;
  - history-drift refusal;
  - a late error rolls everything back;
  - valid N→N+3;
  - protected financial, poker and profile tables unchanged.
- **FR-004** Legal: Privacy (PL/EN, new immutable version `a6` plus the alias) describes user reports, blocks, the moderation queue, moderator actions, retention and legal basis. If the OWNER decides Terms need a conduct or moderation clause, a Terms bump means a new Terms version and its re-acceptance flow (`private.profile_terms_policy`). That is an explicit OWNER legal decision.
- **FR-005** The 16-avatar catalog on Production uses the existing #1114 operations:
  - normalization (`operations/normalize-profiles.sql`);
  - the BIO contract (`supabase/production-migrations/20261027173627_...`);
  - `operations/enable-catalog.sql`.

  Each needs a Production-pinned variant (identity, confirmation, history) where only the Stage variant exists, and each is its own OWNER GO. No activation is bundled with the UGC schema.
- **FR-006** Activation order (all OWNER GO):
  1. apply the Production schema;
  2. Privacy/Terms update and the moderator procedure (`ADMIN_USER_IDS`, review cadence);
  3. set the Netlify Production flags;
  4. a new WWW Candidate and Publish (env vars take effect only on a build);
  5. the catalog operations, which are runtime DB switches and need no release.
- **FR-007** No change to WS, ledger, poker or account-deletion behaviour. No flag is activated by any migration.

## Success Criteria
- **SC-001** The three equivalents and the manifest pass the guard and the full local harness (FR-003). Independent review: Codex, or the reviewer the OWNER chooses.
- **SC-002** After the OWNER-approved apply, an independent postflight shows: history N+3, three hash receipts, empty RLS-on tables, unchanged protected tables, unchanged profile fingerprints.
- **SC-003** After flags and release: a signed-in OWNER smoke on Production for import, publication, table photo, report and block (OWNER test accounts), plus a check that the moderation tab works for the configured admins.
