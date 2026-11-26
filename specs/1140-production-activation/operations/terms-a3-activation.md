# Terms a3 activation — Production operation and rollback (#1140 Phase 2)

**Status (2026-11-26):** Production is currently `2026-10-28-a2`/ON. `enable-terms-a3-production.sql` and `rollback-terms-a3-production.sql` are prepared only; no Production SQL execution is authorized by this branch or task. Independent review, merge to `main`, and a separate exact-file OWNER GO are strictly required. This operation advances the Terms version from `2026-10-28-a2` (active) to `2026-11-26-a3` (active). It does not normalize profiles, drop `bio`, apply the BIO contract, or activate the 16-avatar catalog.

## Pins in `enable-terms-a3-production.sql` (verified 2026-11-26, read-only)

| Pin | Value | Evidence |
|---|---|---|
| Legal version | `2026-11-26-a3` | New Terms version adding UGC conduct, reporting, blocking, and moderation rules (#1140, #1328) |
| Production identity | system `7575202818581710058`, project `otbqfijerkieoxwpxjnm` | Production catalog read |
| Migration history | 73 rows, hash `f6a26af98255afd27ef743cecd68f923948e9974f4160c7997e45fd1c14863f9` | Hash of `string_agg(version\|\|':'\|\|coalesce(name,'<NULL>'),E'\n' ORDER BY version)` (70 rows reconciled for the a2 activation plus the 3 UGC Phase 1 files from #1327); manifest reconciliation remains an external preflight |
| Published WWW/API | `08afb53ff34db2e6df6699ce12aa2cec43900711` | Published Production release A commit (`08afb53f`); serves the versioned Terms a3/Privacy a6 files while the aliases stay on a2/a5 until release B |
| WS Production | `cddc65befd5c03851fdc5e67a6676c269d85ee03` | Running WS Production release (`cddc65be`), verified on VPS / GitHub deploy history |
| Legal documents | `3e3cc30391acd84f4bb49d12b2958c5763bf41c6ae0e847230ecabeac5cf8750` | SHA-256 of sorted `<path>:<sha256>` lines for `legal/terms.2026-11-26-a3.{en,pl}.html` and `legal/privacy.2026-11-21-a5.{en,pl}.html` joined by `\n` without trailing newline |
| Android APK | `NO_PRODUCTION_APK` | Explicit OWNER attestation that **no installed Production APK reader exists** (`NO PRODUCTION APK otbqfijerkieoxwpxjnm`). Web-only scope |

The sentinel guards stay for every pin, so an operator-supplied sentinel is always refused.

## Preconditions & Inventory

- Production policy before execution must have `version = '2026-10-28-a2'` and `active = true`.
- User profiles and receipts are live and grow; counts are not hardcoded.
- Bounded scan: `receipts_count <= 1000` and `profiles_count <= 1000`. If either count exceeds 1000, the script fails closed with exception `'Read-only inventory drift'`.
- All existing receipts (`2026-10-28-a2` and prior) are retained; no receipts are modified or deleted. Signed-in users re-accept Terms a3 on next interactive action through the standard dialog.

## Exact OWNER GO and Execution Procedure

1. **Prerequisites:** Ensure the PR is reviewed, merged to `main`, and release A is published with WWW commit `08afb53ff34db2e6df6699ce12aa2cec43900711`.
2. In the existing trusted OWNER Production maintenance SQL session, run a **SELECT-only fresh preflight**:
   - Confirm system identifier `7575202818581710058` and project `otbqfijerkieoxwpxjnm`.
   - Confirm policy row has `version = '2026-10-28-a2'` and `active = true`.
   - Confirm 73 migration rows and history hash `f6a26af98255afd27ef743cecd68f923948e9974f4160c7997e45fd1c14863f9`.
   - First read both counts; if either exceeds 1000, STOP without fingerprinting. Then obtain fresh fingerprints:
     ```sql
     SELECT
       (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text) FROM private.profile_terms_receipts r) AS receipts_fingerprint,
       (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY user_id),'[]'::jsonb)::text) FROM public.user_profiles p) AS profiles_fingerprint,
       (SELECT count(*)::text FROM private.profile_terms_receipts) AS receipts_count,
       (SELECT count(*)::text FROM public.user_profiles) AS profiles_count;
     ```
   - Verify both counts are <= 1000.
   - Confirm quiet window: no active players at poker tables and outside ledger jobs.
3. **OWNER GO:** The OWNER posts a distinct GO naming the project, system identifier, legal version `2026-11-26-a3`, exact commit and SHA-256 of `enable-terms-a3-production.sql`, fresh inventory counts/fingerprints, readers JSON tuple, and explicit attestation:
   `NO PRODUCTION APK otbqfijerkieoxwpxjnm`.
4. In the single maintenance session (`psql --no-psqlrc -v ON_ERROR_STOP=1`), set the following session settings:
   ```sql
   SELECT set_config('arcade.terms_project', 'otbqfijerkieoxwpxjnm', false);
   SELECT set_config('arcade.terms_confirmation', 'ENABLE TERMS A3 otbqfijerkieoxwpxjnm', false);
   SELECT set_config('arcade.terms_legal_version', '2026-11-26-a3', false);
   SELECT set_config('arcade.terms_apk_confirmation', 'NO PRODUCTION APK otbqfijerkieoxwpxjnm', false);
   SELECT set_config('arcade.terms_readers', '{"version":"2026-11-26-a3","apiSha":"08afb53ff34db2e6df6699ce12aa2cec43900711","wsSha":"cddc65befd5c03851fdc5e67a6676c269d85ee03","apkSha":"NO_PRODUCTION_APK","documentsSha256":"3e3cc30391acd84f4bb49d12b2958c5763bf41c6ae0e847230ecabeac5cf8750"}', false);
   SELECT set_config('arcade.terms_receipts_fingerprint', '<FRESH_RECEIPTS_FINGERPRINT>', false);
   SELECT set_config('arcade.terms_profiles_fingerprint', '<FRESH_PROFILES_FINGERPRINT>', false);
   SELECT set_config('arcade.terms_receipts_count', '<FRESH_RECEIPTS_COUNT>', false);
   SELECT set_config('arcade.terms_profiles_count', '<FRESH_PROFILES_COUNT>', false);
   ```
5. Execute `enable-terms-a3-production.sql` once. If the client already wraps the batch in a transaction (for example the Supabase SQL tool), send `BEGIN ISOLATION LEVEL REPEATABLE READ;` first and the session settings right after it; the rest of the file is unchanged.
   Executed on 2026-11-26 (OWNER GO): a2/ON → a3/ON, receipts 3 and profiles 12 unchanged, history 73.
   - On any error: `ROLLBACK`, `STOP`, never retry or hand-edit pins.
6. **SELECT-only verification:**
   - Confirm policy row has `version = '2026-11-26-a3'` and `active = true`.
   - Confirm other policy fields (`variants_enabled`, `identity_normalized_at`, `singleton`) are unchanged.
   - Confirm receipts and profiles match the preflight fingerprints.

## Incident Rollback (a3/ON -> a2/ON)

If an incident requires rolling back Terms a3 to a2 while keeping Terms active:
1. Distinct OWNER GO naming `ROLLBACK TERMS A3 otbqfijerkieoxwpxjnm`, system `7575202818581710058`, incident context, and exact SHA-256 of `rollback-terms-a3-production.sql`.
2. In one maintenance session:
   ```sql
   SELECT set_config('arcade.terms_project', 'otbqfijerkieoxwpxjnm', false);
   SELECT set_config('arcade.terms_confirmation', 'ROLLBACK TERMS A3 otbqfijerkieoxwpxjnm', false);
   ```
3. Execute `rollback-terms-a3-production.sql` once.
   - It requires version `2026-11-26-a3` and `active = true`.
   - Only `version` is updated back to `2026-10-28-a2`; `active` remains `true`.
   - All receipts (both a2 and newly recorded a3 receipts) are preserved.
   - Transaction write guard verifies only the single policy update occurred.

## Known Limitations & Notes

1. **Client Terms Dialog vs Legacy API privacyUrl:**
   - The web client Terms dialog dynamically links `/legal/terms.<version>.<lang>.html` (which exists for `2026-11-26-a3`).
   - Its Privacy Policy link uses the unversioned alias `/legal/privacy.<lang>.html` (points to `2026-11-21-a5` until release B).
   - In `netlify/functions/profile-onboarding.mjs`, legacy helper `privacyUrl` constructs a versioned URL from the Terms version (`/legal/privacy.2026-11-26-a3.<lang>.html`), which does not exist (404). No active client consumes this response property. This is a known historical limitation; do not modify code.
2. **Emergency Full Disable Under a3:**
   - The existing `specs/1114-arcade-profiles-avatars/operations/disable-terms-production.sql` specifically requires active version `2026-10-28-a2` and refuses `2026-11-26-a3`.
   - To perform an emergency switch-off (OFF) while on a3: run `rollback-terms-a3-production.sql` first to return to `2026-10-28-a2`/ON, then run `disable-terms-production.sql` to switch `active = false`.
