# Terms a2 activation — Stage operation and Production proposal (#1140)

**Status:** prepared only. All Stage reader pins are approved (the APK pin for Stage only). No Stage or Production
SQL is authorized by this file; each execution needs a separate OWNER GO after the final independent review.

## Pins in `enable-terms.sql` (verified 2026-11-14, read-only)

| Pin | Value | Evidence |
|---|---|---|
| Legal version | `2026-10-28-a2` | Published as the active Terms alias on WWW Production (#1244) |
| Stage identity | system `7656985631720456337`, project `krydukthwdvccggbyjfw` | Stage catalog read |
| Migration history | 125/125, fingerprint `7d3283ae…50b8` | Stage `schema_migration_files` equals `supabase/migrations` byte for byte |
| API reader | `736eb01dc860b895b63167f63b1b809f2d5c266f` | Stage API actually serving the trial: Deploy Preview #1244 (`build-info.js` commit `736eb01d`, context `deploy-preview`), which includes the Terms dialog fixes and is the approved APK's API origin. The WWW Production SHA is not a Stage reader |
| WS reader | `227fef03d187c3b8802ee7422991bbe566f472e2` | Running Stage WS release; same WS surface as `main` and as WS Production `49e785b7` |
| Documents | `a9fea5a27e8a59e521132c6f08a64ad58f8a577f5406330c7692320632b7a44f` | SHA-256 of the sorted `<path>:<sha256>` lines for `legal/terms.2026-10-28-a2.{pl,en}.html` and `legal/privacy.2026-11-12-a3.{pl,en}.html` |
| APK reader | `a9eb1151c11813fb245866b1cc331636c275a3cf8a3ac3f87ae2d731cc1d1982` | OWNER-approved for **Stage only**: debug APK from #1244, workflow `43525617080`, artifact `14084224474`, source `736eb01d`, application ID `pl.kcswh.arcadepoker.stage`, API origin `https://deploy-preview-1244--playkcswh.netlify.app`, Supabase Stage, WS Preview, Android Debug signature, artifact valid until 2026-11-20. Not a Google Play AAB and never a Production pin |

The sentinel guards stay for every pin, so an operator-supplied sentinel is always refused. The API and APK pins
name the same Stage source (`736eb01d`), so the WWW and the APK readers of the trial are one build.

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
4. Before the smoke, verify read-only that Deploy Preview #1244 still answers with `build-info.js` commit `736eb01d`
   (the approved APK's API origin), that WS Preview still runs `227fef03` and that the APK artifact has not expired.
   If any of these fails, stop: the pins no longer describe the readers.
5. Stage smoke (Deploy Preview #1244, WS Preview `227fef03`, approved Stage APK): the
   dialog links Terms a2 and Privacy a3; accept; new game, reaction, gift, avatar change; guest accept + reaction;
   "Not now" still allows resume, leave, settlement, leaderboard opt-out and account-deletion request; lobby shows
   the Terms message instead of a raw code.

## Emergency switch-off

- Stage: one session on Stage with exactly `arcade.terms_project=krydukthwdvccggbyjfw` and
  `arcade.terms_confirmation=DISABLE TERMS krydukthwdvccggbyjfw`, then `disable-terms.sql`. No pins or fingerprints are
  needed, so it stays usable in an incident. It changes only `active=false`, keeps version a2 and every receipt,
  shares the activation lock and aborts on any other write; stop on the first error and `ROLLBACK`.
- Production (proposal, no SQL yet): the same operation with the Production identity (`7575202818581710058`,
  `otbqfijerkieoxwpxjnm`) and phrase `DISABLE TERMS otbqfijerkieoxwpxjnm`, prepared and reviewed together with the
  Production activation.

## Production activation (proposal only)

A separate operation, not this file: Production identity and phrase; Production migration evidence from
`supabase/production-migrations/manifest.json`; preconditions matching today's row (a1, `active=false`, any
`variants_enabled`; no normalization or `bio` requirement); the same receipt/profile fingerprints, single `UPDATE`,
transaction-write check and lock discipline; reader pins = published WWW Production SHA, running WS Production
release, the approved signed AAB (or an explicit OWNER decision that no APK reader exists yet) and the same documents
hash. Order: WWW already serves Terms a2 → Stage trial passed → **before activation:** decide how installed older APKs
behave under mandatory acceptance (they need the #1244 dialog fixes) and confirm Android release readiness (signed
AAB, Play Data safety) → Production activation in a quiet window (0 humans at tables, outside ledger slots) →
monitor `terms_required`.

## User impact once active

Signed-in users must accept a2 before a new game, avatar change, reaction or gift; running games, leave, settlement,
opt-out and deletion stay available. Guests accept for one hour before reacting. Old cached lobby code shows the raw
code until reload; the Terms prompt button is still shown. Installed APKs need a build that includes #1244.
