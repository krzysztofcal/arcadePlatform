# Plan: Production activation (#1140, #1282, #1114)

## Phase 1: Production schema (this PR, prepared only)
- Three files, each the Stage DDL plus the Production contract wrapper (FR-001):
  - `supabase/production-migrations/20261107120000_ugc_reports_blocks.sql`
  - `supabase/production-migrations/20261107130000_ugc_moderation.sql`
  - `supabase/production-migrations/20261107140000_google_photo_consent.sql`
- **History pins are sequential.** Let N be the exact current Production list, re-read immediately before the GO. Then:
  - file 1 expects N;
  - file 2 expects N plus `20261107120000`;
  - file 3 expects N plus `20261107120000` and `20261107130000`.

  The BIO contract `20261027173627` is not a prerequisite: none of these files references `bio`.
- **Session settings** (exact names; each value is checked by its file):
  - common: `chips.production_project_ref=otbqfijerkieoxwpxjnm`;
  - each `*_source_sha256` is the approved SHA-256 of that **Production** file's exact bytes, as recorded in the manifest's `replacement_migrations` entry (same convention as #1114, e.g. `edf83e55…` for `production-migrations/20261026120000_profile_phase_a.sql`);
  - file 1: `arcade.production_ugc_reports_confirmation=INSTALL UGC REPORTS BLOCKS otbqfijerkieoxwpxjnm`, `arcade.production_ugc_reports_source_sha256=<approved sha256 of file 1>`;
  - file 2: `arcade.production_ugc_moderation_confirmation=INSTALL UGC MODERATION otbqfijerkieoxwpxjnm`, `arcade.production_ugc_moderation_source_sha256=<approved sha256 of file 2>`;
  - file 3: `arcade.production_photo_consent_confirmation=INSTALL GOOGLE PHOTO CONSENT otbqfijerkieoxwpxjnm`, `arcade.production_photo_consent_source_sha256=<approved sha256 of file 3>`.
- `ugc_moderation` preflight:
  - `public.user_profiles.public_profile_blocked` exists (boolean, NOT NULL, default false);
  - the trigger `user_profiles_block_guard` exists on `public.user_profiles`, is not internal, and has `tgenabled in ('O','A')`.

  Pin the owner, `SECURITY DEFINER`, `search_path` and ACL of `private.ugc_set_profile_blocked` and `private.ugc_count_removed_pending_report`, exactly like the Stage file. The DML guard allows only the one seed counter row.
- Manifest (FR-002) and harness cases (FR-003) in the existing files only. The harness also covers: a file applied out of order is refused by its history pin; a late error rolls back that file only.
- **Apply proposal** (one OWNER GO naming the three exact files and hashes):
  - run them in order as unmodified files, each with its own `BEGIN`/`COMMIT`, in one operator session, with the three settings pairs;
  - stop at the first error: that file rolls back by itself, and earlier committed files stay. They are empty, dark schema with no reader impact, so the run is resumable without retry tricks. Never splice or edit files at apply time.

## Phase 2: Legal and procedure (separate PR, OWNER legal acceptance)
- Privacy `a6` PL/EN plus the alias: reports, blocks, moderation, retention, legal basis.
- Terms `a3` PL/EN plus the alias: conduct rules, reporting, blocking, moderation actions.
- Code legal version a3 (`shared/profile-terms.mjs`, the client Terms dialog), following the existing a1→a2 change.
- A Production-pinned `enable-terms-production` operation for a3 (identity, history, confirmation, legal document hash, reader pins) and its matching `disable-terms-production` rollback, modelled on #1114. The reader pins name the exact release A WWW SHA, the WS SHA and the Android state, so both operations are prepared in a separate small PR **after release A**.
- The moderator procedure (OWNER 2026-11-26): the moderators are the OWNER and the admin accounts in the existing `ADMIN_USER_IDS`; reports are reviewed manually in the admin panel.

## Phase 3: Activation (each step a separate OWNER GO)
1. Apply Phase 1 on Production; independent postflight (SC-002).
2. **Release A**: WWW Candidate (agent, after the GO) and Publish (OWNER) carrying Privacy a6, Terms a3 and the code a3. The flags stay off.
3. Switch the Production Terms policy to a3 (exact-file GO; reader pins = release A); signed-in users re-accept. Smoke: re-acceptance on an OWNER test account.
4. The OWNER sets the Netlify Production flags: `UGC_SAFETY_ENABLED=1`, `GOOGLE_PHOTO_IMPORT_ENABLED=1`, `POKER_TABLE_PHOTO_ENABLED=1`. The agent never changes Netlify configuration.
5. **Release B**: a Candidate and Publish of the then-current main (env vars take effect only on a build). Smoke (SC-003).

## Phase 4: 16-avatar catalog (separate PR and GOs; only after Phase 1 is fully applied)
- Do not apply the BIO contract or any catalog operation before the three Phase 1 files are applied: their exact history pins would then drift and need re-pinning, re-hashing and review.
- Production-pinned variants of `normalize-profiles.sql` and `enable-catalog.sql` where only the Stage variant exists; the order with the BIO contract per #1114. Runtime DB switch, no WWW release.

## Rollback
- **Phase 1:** the tables and functions are additive. The UGC tables stay dark while `UGC_SAFETY_ENABLED` is off. The photo-consent tables become live readers as soon as file 3 is applied, because `profile-google-photo.mjs` keeps status and withdrawal working with `GOOGLE_PHOTO_IMPORT_ENABLED` off (today the missing table returns 404). After file 3 it reads the empty table and answers "no consent"; the Account section stays hidden because import is disabled. A failure or regret needs no action: leave them. No automatic DROP; any removal is a separate, reviewed forward migration that must account for those live readers.
- **Terms a3:** the prepared `disable-terms-production` operation for a3 returns the policy to the a2 state (separate GO). The legal pages stay versioned and immutable.
- **Flags:** the OWNER clears the flag in Netlify, then an immediate Candidate and Publish of the current main. The flag stays effective until that rebuild is published, so plan for a delay of minutes. #1324 researches runtime switches without a release.
- **Release A or B regression:** roll forward through the same Candidate/Publish path (the WWW release SOP has no rollback mode before #1159 T004).

## Delivery
- SQL drafting can be delegated to Antigravity with exact pins. The coordinator reviews every line, runs the guard and harness on the disposable local PostgreSQL, and does the independent review.
- No migration under `supabase/migrations/` changes, so `DB Stage Apply PR` is not triggered. WS is unchanged.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS: reuses the Production-equivalent pattern, the manifest, the harness and the #1114 operations |
| II Authoritative runtime | PASS: no WS or ledger change |
| III Fail-closed / environment separation | PASS: sequential pins, identity, confirmation, hash; schema only plus one seed row; legal before flags |
| IV Platform / logging | PASS: SQL and docs only in Phase 1 |
| V Fundamental tests | PASS: migration contract tests in the existing harness only |

## Risks
- History pin drift between preparation and the GO: re-read and re-pin before the GO, never relax the guard.
- Legal before features: flags are set only after release A and the Terms a3 switch.
- Moderation needs real moderators; reports without review are not "ongoing moderation".
- Terms re-acceptance interrupts every signed-in user once.
- The catalog depends on normalization and the BIO contract; it is kept separate.
