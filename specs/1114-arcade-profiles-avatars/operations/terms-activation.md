# Terms a2 activation — Stage operation and Production proposal (#1140)

**Status:** prepared only. `enable-terms.sql` still refuses to run: the APK reader pin is not approved. No Stage or
Production SQL is authorized by this file; each execution needs a separate OWNER GO.

## Pins in `enable-terms.sql` (verified 2026-11-14, read-only)

| Pin | Value | Evidence |
|---|---|---|
| Legal version | `2026-10-28-a2` | Published as the active Terms alias on WWW Production (#1244) |
| Stage identity | system `7656985631720456337`, project `krydukthwdvccggbyjfw` | Stage catalog read |
| Migration history | 125/125, fingerprint `7d3283ae…50b8` | Stage `schema_migration_files` equals `supabase/migrations` byte for byte |
| API/WWW reader | `34a6c3ea96bdce39736b68e6f3ab8fb5c3e5ff82` | `main` with the Terms dialog fixes (#1244) |
| WS reader | `227fef03d187c3b8802ee7422991bbe566f472e2` | Running Stage WS release; same WS surface as `main` and as WS Production `49e785b7` |
| Documents | `a9fea5a27e8a59e521132c6f08a64ad58f8a577f5406330c7692320632b7a44f` | SHA-256 of the sorted `<path>:<sha256>` lines for `legal/terms.2026-10-28-a2.{pl,en}.html` and `legal/privacy.2026-11-12-a3.{pl,en}.html` |
| APK reader | **not approved** (`APK_SHA_NOT_APPROVED`) | Candidate for the Stage trial only: debug Stage APK `a9eb1151…1982` from #1244 (`736eb01d`, packaged web identical to `main`; artifact expires 2026-11-20). A debug APK is not the signed Production AAB |

Approving the APK pin is a reviewed change to the `apkSha` comparison in `enable-terms.sql`; the sentinel guards stay.

## Stage preconditions (why they differ from Production)

The Stage row is post-contract: `variants_enabled=true`, `identity_normalized_at` set, no `bio` column, 0 receipts,
51 profiles. The operation keeps these checks because they describe the Stage state it was reviewed against.
Production is different (`variants_enabled=false`, not normalized, `bio` present); Terms enforcement does not read
any of these, so Production must not be normalized or migrated just to activate Terms.

## Stage procedure (after OWNER GO)

1. One session on Stage. Read-only immediately before: policy row, receipt count and the receipt/profile
   fingerprints exactly as computed in the operation.
2. Session settings: `arcade.terms_project`, `arcade.terms_confirmation=ENABLE TERMS krydukthwdvccggbyjfw`,
   `arcade.terms_legal_version=2026-10-28-a2`, `arcade.terms_readers` (the JSON tuple above), the two fingerprints and
   the receipt count.
3. Run `enable-terms.sql`; stop on the first error, `ROLLBACK`, never retry blindly.
4. Stage smoke (Deploy Preview with runtime identical to `34a6c3ea`, WS Preview `227fef03`, approved Stage APK): the
   dialog links Terms a2 and Privacy a3; accept; new game, reaction, gift, avatar change; guest accept + reaction;
   "Not now" still allows resume, leave, settlement, leaderboard opt-out and account-deletion request; lobby shows
   the Terms message instead of a raw code.

## Emergency switch-off

- Stage: `disable-terms.sql` with `arcade.terms_confirmation=DISABLE TERMS krydukthwdvccggbyjfw`. It changes only
  `active=false`, keeps version a2 and every receipt, shares the activation lock and aborts on any other write.
- Production (proposal, no SQL yet): the same operation with the Production identity (`7575202818581710058`,
  `otbqfijerkieoxwpxjnm`) and phrase `DISABLE TERMS otbqfijerkieoxwpxjnm`, prepared and reviewed together with the
  Production activation.

## Production activation (proposal only)

A separate operation, not this file: Production identity and phrase; Production migration evidence from
`supabase/production-migrations/manifest.json`; preconditions matching today's row (a1, `active=false`, any
`variants_enabled`; no normalization or `bio` requirement); the same receipt/profile fingerprints, single `UPDATE`,
transaction-write check and lock discipline; reader pins = published WWW Production SHA, running WS Production
release, the approved signed AAB (or an explicit OWNER decision that no APK reader exists yet) and the same documents
hash. Order: WWW already serves Terms a2 → Stage trial passed → Production activation in a quiet window (0 humans at
tables, outside ledger slots) → monitor `terms_required` → APK/AAB → Play Data safety.

## User impact once active

Signed-in users must accept a2 before a new game, avatar change, reaction or gift; running games, leave, settlement,
opt-out and deletion stay available. Guests accept for one hour before reacting. Old cached lobby code shows the raw
code until reload; the Terms prompt button is still shown. Installed APKs need a build that includes #1244.
