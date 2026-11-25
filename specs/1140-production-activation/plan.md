# Plan: Production activation (#1140, #1282, #1114)

## Phase 1: Production schema (this PR, prepared only)
- New files, one per Stage migration, with the same DDL as Stage plus the Production contract wrapper (FR-001):
  - `supabase/production-migrations/20261107120000_ugc_reports_blocks.sql`
  - `supabase/production-migrations/20261107130000_ugc_moderation.sql`
  - `supabase/production-migrations/20261107140000_google_photo_consent.sql`
- Expected history pin: the exact current Production list (read-only, re-read immediately before the GO). The BIO contract `20261027173627` is **not** a prerequisite of these three files (none of them references `bio`). Its relative order with the catalog phase stays as #1114 prescribes.
- Confirmation settings, one per file: `arcade.production_ugc_confirmation=INSTALL UGC REPORTS BLOCKS otbqfijerkieoxwpxjnm`, `INSTALL UGC MODERATION ...`, and `arcade.production_photo_confirmation=INSTALL GOOGLE PHOTO CONSENT ...`; plus `chips.production_project_ref` and the source SHA-256 setting.
- `ugc_moderation` creates `private.ugc_set_profile_blocked` (it writes `public.user_profiles.public_profile_blocked`, which already exists on Production). Pin the owner, `SECURITY DEFINER`, `search_path` and ACL, exactly like the Stage file.
- Manifest (FR-002) and harness cases (FR-003) in the existing files only.
- Apply GO proposal: one operator transaction with the three operational bodies (outer `BEGIN`/`COMMIT` stripped, never nested), the three settings pairs, and one final `COMMIT`. Error before `COMMIT` → full rollback, stop, no retry.

## Phase 2: Legal and procedure (separate PR, OWNER legal acceptance)
- Privacy `a6` PL/EN plus the alias: reports, blocks, moderation, retention, legal basis. Terms bump only if the OWNER decides it.
- OWNER sets the moderator list (`ADMIN_USER_IDS`) and the review cadence.

## Phase 3: Activation (OWNER GO each)
1. Apply Phase 1 SQL on Production, then the independent postflight (SC-002).
2. Netlify Production flags: `UGC_SAFETY_ENABLED=1`, `GOOGLE_PHOTO_IMPORT_ENABLED=1`, `POKER_TABLE_PHOTO_ENABLED=1`. The OWNER changes Netlify configuration; the agent never does.
3. WWW Candidate (agent, after the OWNER GO) and Publish (OWNER), carrying Privacy `a6` and the flags.
4. Smoke (SC-003).

## Phase 4: 16-avatar catalog (separate PR and GOs)
- Production-pinned variants of `normalize-profiles.sql` and `enable-catalog.sql` where only the Stage variant exists; the order with the BIO contract per #1114.
- Runtime DB switch: no WWW release needed.

## Delivery
- SQL drafting can be delegated to Antigravity with exact pins. The coordinator reviews every line, runs the guard and harness on the disposable local PostgreSQL, and does the independent review.
- No migration under `supabase/migrations/` changes, so the PR does not trigger `DB Stage Apply PR`.
- WS is unchanged, so WS Preview Deploy is not needed.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS: reuses the established Production-equivalent pattern, the manifest, the harness and the #1114 operations |
| II Authoritative runtime | PASS: no WS or ledger change |
| III Fail-closed / environment separation | PASS: pinned identity/history/confirmation/hash; schema only; flags stay off until a separate GO |
| IV Platform / logging | PASS: SQL and docs only in Phase 1 |
| V Fundamental tests | PASS: migration contract tests in the existing harness only |

## Risks
- History pin drift between preparation and GO (a new Production migration): re-read and re-pin before the GO, never relax the guard.
- Privacy must be live before any flag is enabled (UGC plan gate). Phase 3 step 3 publishes Privacy and the flags together.
- Moderation needs real moderators; reports without review are not "ongoing moderation".
- The catalog depends on normalization and the BIO contract. It is kept separate so the UGC and photo schema does not depend on it.
