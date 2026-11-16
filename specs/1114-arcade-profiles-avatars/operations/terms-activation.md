# Terms a2 activation — Stage operation and Production proposal (#1140)

**Status (2026-11-16):** Stage is already a2/ON and OWNER-confirmed profile/login/retention checks are PASS;
do not repeat activation or those tests. The Stage sections below retain the original operation history.
Production remains a1/OFF. `enable-terms-production.sql` and `disable-terms-production.sql` are prepared only;
no Production SQL execution is authorized by this PR. Independent review, merge and a separate exact-file OWNER GO
are required. This operation does not enable catalog16, normalize profiles, change schema or activate UGC phases B/C/D.

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
- Production: use the separately prepared `disable-terms-production.sql` under the emergency GO below;
  never edit/run the Stage script against Production.

## Production preparation — observed 2026-11-16, not activation

Read-only project `otbqfijerkieoxwpxjnm` confirmed system `7575202818581710058`, one policy row
`2026-10-26-a1`/OFF, `variants_enabled=false`, normalization timestamp NULL, `bio` present, **0 receipts, 11 profiles**.
No profile/receipt values were exported. Production has **70** history rows and no `schema_migration_files` table.
The Production script pins SHA-256 `4977d708cce45c6f4fe278a98d0551cdcb96b3257911fc1c6d75bd49c9fc990c`
of `string_agg(version||':'||coalesce(name,'<NULL>'), E'\n' ORDER BY version)` (UTF-8, no trailing newline).
This is observed version/name evidence, **not** proof of applied SQL bytes. Do not copy Stage's 125/125 fingerprint,
repair history, apply migrations, drop `bio` or normalize profiles to satisfy activation.
Before GO reconcile the 70 versions with `supabase/production-migrations/manifest.json`: 54 baseline versions,
14 listed replacement files excluding the unapplied BIO contract, plus the two applied Poker single-player
versions `20261011200000`/`20261012095657`. Historical NULL names are retained; never invent missing history names.
The reviewed file hashes/provenance in that manifest remain an external prerequisite; a count alone is insufficient.

Reader preflight:

| Reader | Observed evidence / pin | Execution rule |
|---|---|---|
| Published WWW/API | `6e9620aef57ccc8ff33609bb6457dbe265dddbf7`, public Production build-info | Re-read the published release, not current main or an unpublished Candidate. Check reader surface against this commit; any pin drift is STOP/review, not an edit at execution time. |
| WS Production | `49e785b74185abd71bf77fd67e4d5cdfee746433`, agreeing VPS/GitHub evidence retained in successful Candidate run `43912583845` | Refresh through the approved read-only release-evidence path before GO; this historical receipt alone is not present runtime proof. WS/shared Terms surface matches the published WWW commit. |
| Legal | Terms `2026-10-28-a2`, Privacy `2026-11-12-a3`, PL/EN | Four immutable files and live WWW bytes match; sorted `<path>:<sha256>` tuple hashes to `a9fea5a27e8a59e521132c6f08a64ad58f8a577f5406330c7692320632b7a44f`. Also check current Terms/Privacy aliases. |
| Android | Current inspected artifact is Stage-only; see [Data Safety draft](../../1140-ugc-safety/google-play-data-safety-draft.md) | Not a Production pin. Proposed operation allows only explicit OWNER confirmation that **no installed Production APK reader exists** (`NO_PRODUCTION_APK`). If any Production APK exists or inventory is unknown: STOP; approve a compatible signed artifact tuple through review first. |

Source review: `shared/profile-terms.mjs` reads only the policy version/active flag for enforcement; the account
receipt stays unique per subject/version (`ON CONFLICT ... DO NOTHING`), with server timestamp/request identity.
Guests retain the existing one-hour validity. No conversion, synthetic acceptance or deletion of a1 receipts is allowed.
The published `js/profile-onboarding.js` supports the a2 version and current Privacy alias; the API's legacy
`privacyUrl` remains version-paired (a2), so external consumers must follow the approved client behavior or be reviewed.
No new acceptance mechanism or reader code is introduced. Preserve recovery/leave/settlement, opt-out and deletion
without mandatory Terms acceptance. Cached/older clients are an explicit compatibility risk, not upgraded by SQL.

## Exact later OWNER GO and execution

1. Review/merge this PR; retain exact source commit and SHA-256 of both Production SQL files. Review the
   [Data Safety draft](../../1140-ugc-safety/google-play-data-safety-draft.md) separately; do not submit it automatically.
2. In the existing trusted OWNER Production maintenance SQL session, run **SELECT-only** fresh preflight: identity,
   policy/count, 70-row history hash and manifest reconciliation, receipt/profile counts and the two fingerprints
   computed in `enable-terms-production.sql`. Read only aggregates/hashes; do not export user rows. Receipt/profile
   scans are bounded here by 0/11; if counts drift, STOP rather than scanning growing data or widening limits.
   Confirm pinned live readers/legal bytes, no conflicting DDL/policy operation, and a quiet window: no humans
   at tables and outside ledger jobs. Observation does not authorize draining/restarts. Missing evidence means STOP.
3. OWNER posts a distinct GO naming project/system, legal version, exact merged commit/file hashes, the fresh
   inventory/fingerprints and reader tuple. For this web-only proposal it must explicitly attest no installed
   Production APK reader exists and approve `NO PRODUCTION APK otbqfijerkieoxwpxjnm`. Unknown/older APK means NO-GO.
   GO for preparing this PR, Stage PASS or document approval is not this execution GO.
4. One connection, stop on first error (`psql --no-psqlrc -v ON_ERROR_STOP=1` in the existing authorized session;
   do not put connection secrets in commands/logs). Set these **session** settings with `set_config(...,false)`:
   `arcade.terms_project=otbqfijerkieoxwpxjnm`,
   `arcade.terms_confirmation=ENABLE TERMS otbqfijerkieoxwpxjnm`,
   `arcade.terms_legal_version=2026-10-28-a2`,
   `arcade.terms_apk_confirmation=NO PRODUCTION APK otbqfijerkieoxwpxjnm`,
   `arcade.terms_readers` = JSON `{ "version":"2026-10-28-a2", "apiSha":"6e9620aef57ccc8ff33609bb6457dbe265dddbf7", "wsSha":"49e785b74185abd71bf77fd67e4d5cdfee746433", "apkSha":"NO_PRODUCTION_APK", "documentsSha256":"a9fea5a27e8a59e521132c6f08a64ad58f8a577f5406330c7692320632b7a44f" }`,
   `arcade.terms_receipts_count=0`, `arcade.terms_receipts_fingerprint` and `arcade.terms_profiles_fingerprint`
   from the fresh approved read-only inventory. These attestations do not cryptographically discover external readers.
5. Execute the exact reviewed `enable-terms-production.sql` once. It uses a Production-only advisory lock,
   bounded waits, history/policy/inventory checks and one UPDATE of version+active, then checks that every other
   policy field, profiles, receipts and transaction-write counters are unchanged. Any error: ROLLBACK, STOP,
   no retry, identity substitution or hand-edited pin. Timeout/disconnect means inspect actual committed state first.
6. SELECT-only verify a2/ON and unchanged other policy fields, receipt/profile fingerprints/counts immediately
   after commit before user traffic changes them; retain a sanitized receipt and observe `terms_required` errors.
   Do not repeat OWNER-confirmed profile/login/retention tests. A real Production acceptance/replay or other
   mutating smoke needs its own narrowly scoped GO; without it report only SQL/read-only validation.

## Production emergency OFF — separate OWNER GO

OWNER GO must name `DISABLE TERMS otbqfijerkieoxwpxjnm`, system `7575202818581710058`, incident and exact
reviewed `disable-terms-production.sql` commit/hash. In one trusted session set `arcade.terms_project` and
`arcade.terms_confirmation` to that project/phrase, then execute that file once with stop-on-error.
No migration history, reader pins, original receipt count or normalization prerequisites are required in an incident.
The same Production advisory lock and policy/receipt locks serialize it with enable/acceptance. Only `active=false`
changes; version stays a2, all existing receipts and profile data remain. Read-only confirm a2/OFF and retained
receipts; never decrement version, delete receipts or repeat enable (its a1/OFF guard must refuse a2/OFF).
Error/timeout/unknown result: ROLLBACK where connected, STOP and inspect; no automatic retry or silent re-enable.
Emergency OFF removes enforcement for new actions; it does not undo user acceptance or repair a legal incident.

## User impact once active

Signed-in users must accept a2 before a new game, avatar change, reaction or gift; running games, leave, settlement,
opt-out and deletion stay available. Guests accept for one hour before reacting. Old cached lobby code shows the raw
code until reload; the Terms prompt button is still shown. Installed APKs need a build that includes #1244.
