# #1140 Phase D — voluntary Google photo, current-main replacement for #1217

Prepared only; `GOOGLE_PHOTO_IMPORT_ENABLED` remains OFF unless OWNER separately enables it.
Import/publication also require existing `UGC_SAFETY_ENABLED=1`; toggling photo import cannot bypass moderation rollout.
No migration, shared Stage/Production write, deploy, APK build or Play publication is authorized by this PR.

## Dependencies and old PR audit

Base main: `f6e036fa` (2026-11-17). #1155 Phase A and #1160 authenticated profile/leaderboard reads are merged.
The report/block and moderation implementations are already in main (#1219 superseded the closed, unmerged #1216).
Reuse them; do not merge the old stacked #1217 or resurrect #1216. Current Account Deletion lifecycle locks,
V3 avatar intent/uncertainty manifests and catalog fallback are retained. Stage SELECT-only inspection found
migration `20261107140000` unapplied and `private.profile_photo_consents` absent; no schema was applied.

This replacement is prepared by Codex from current main, adapting the old implementation and independently
re-auditing its races and final fixes. The old PR's review statements do not approve this final diff.
The old UI-rendering test suite is not imported; fundamental backend tests cover the safety boundaries.
No files or behavior from #1275/audio are changed.

## Security decisions / P0–P2 audit

- Sign-in is not publication consent. The unticked Account choice sends explicit consent and notice `2026-11-17-g2`.
  Google userinfo must prove the same subject as the account's server-side `auth.identities`; user_metadata, client
  URLs and email are not ownership evidence. Fixed HTTPS Google hosts, no redirects, bounded image stream/timeout,
  one-frame JPEG/PNG/WebP and existing Sharp normalization; no token or image URL persisted/logged.
- Auth/CORS guards and per-account import rate limits remain. Reads/writes are keyed to the JWT account; clients
  have no consent-table privileges. Missing schema, moderation hold, Terms requirement, deletion or unknown I/O
  fail closed. No free uploads, custom names or BIO return. Import needs V3 deletion tracking before any network I/O.
- New imports are OFF by default. Existing users can still inspect an existing decision/copy and withdraw when
  the import flag is OFF. Publication stops when the flag is OFF. Withdrawal needs neither fresh Google proof nor
  new Terms acceptance; once Account Deletion starts it returns 409 and the existing purge owns the copies.
- Withdrawal detaches our imported key, suppresses Google re-import and bumps avatar revision before external
  deletion. In-flight imports lose their CAS; cleanup only touches the snapshot of keys owned by that withdrawal,
  never a later import. Unknown writes stay tracked through the existing capability horizon. Delete failure stays
  visible/retryable by a later explicit withdrawal; no silent success or background retry/job.
- Catalog choice, moderator hide and withdrawal win over an in-flight import. Account Deletion finds every attempted
  Storage write in the existing V3 manifest before I/O; consent/pending rows cascade with Auth deletion. No cross-user
  bucket scan or alternate deletion implementation. Account/leaderboard/profile endpoints keep JWT privacy gates.
- Google copies use the existing **private** `profile-avatar-uploads/pending/<random-id>` source slot, never
  a permanent public avatar object. A V3 source manifest is committed and the capability horizon recorded before
  Storage I/O; the existing Account Deletion source purge owns this slot. Source-only intents remain conservative
  through that horizon; no new bucket or parallel purge is introduced. Bucket privacy is checked before import and
  read issuance; a public/missing bucket fails closed. Legacy public-upload behavior remains untouched.
- Authenticated projections batch-sign matching consented keys for 60 seconds. Eligibility is rechecked after signing. Fresh links are refused after
  catalog choice, moderator hold, deletion start or either rollout flag OFF. A previously issued link can remain
  usable until expiry, and copies saved by recipients cannot be recalled; consent PL/EN discloses this bounded
  read capability. Cache-control is 0. Choosing a catalog avatar or moderator hide stops new access without leaving
  a permanently public copy. The private stored copy remains covered by consent/status until explicit withdrawal
  or Account Deletion. Signed links and provider tokens are never logged.
- WWW image rendering accepts only the configured project's bucket URL and clears stale image callbacks/background
  before fallback. Google originals are never hot-linked. APK requests use the existing ArcadeApi origin mechanism;
  packaging already follows account script/CSS references, with no change to its audio/runtime configuration.

## Validation and review gates

Fundamental PGlite/Sharp tests use only synthetic users, local database and fake network: proof/explicit consent,
moderation/Terms/lifecycle refusal, cross-user isolation, denied table privileges, normalized bytes, tracked I/O,
withdrawal/import/deletion races, unknown writes/deletion failure and OFF-withdrawal behavior. Fixtures are closed
per test, including failures. The suite is registered in the existing test runner. No authenticated remote smoke.
Existing profile, moderation, deletion and CSP checks are run against the final diff. New browser code is an IIFE;
the new external script has a SHA-256 integrity pin. No inline script was added; existing CSP validation must pass without weakening it.

Independent Claude Code review of the exact final diff is required; record P0/P1/P2 findings in the PR. Until the
separately authorized migration/deploy and exact-build WWW/Android acceptance are done, keep Draft/NOT runtime-ready.
Manual acceptance must cover unticked consent, identity change during requests, import, withdrawal with pending
Terms, catalog fallback, moderator hold, failed deletion messaging and sign-out; no Play readiness inferred.

## Later OWNER gates and impact

1. Review this replacement, migration hash/manifest and consent wording. Do not apply old #1217 as a dependency.
2. Verify private bucket/RLS and service-role read/sign access on the actual target (Production is not inferred from Stage).
   Separate OWNER Stage apply of the reviewed SQL; separate approved Preview deployment and opt-in flag context.
   No auto Stage apply on push/PR; Production equivalent/identity review has its own GO. Keep public import OFF elsewhere.
3. Exact-build WWW + Android acceptance and independent review before Ready. Separately update/approve Privacy,
   Data Safety and moderation procedures if needed before public rollout. A WWW change never upgrades installed APKs.
4. Disable new imports/publication with the flag; withdrawal of existing copies stays available. Resolve uncertain
   writes through the existing manifest/deletion procedure, never delete another user's key or claim cache erasure.

No intentional breaking change while OFF. When enabled, approved photos may replace the catalog avatar on the
existing WWW projections; WS/table avatar projection stays catalog-only. Withdrawal needs no provider login and
preserves existing game/ledger/settlement behavior. Provider-token expiry may require an explicit Google re-login.
Egress: one userinfo + at most 1 MiB image per allowed import (5/account/hour), one normalized Storage write;
publication uses two bounded eligibility reads of the existing leaderboard/profile IDs and one Storage signing request (max100 paths, TTL60s); withdrawal reads only that account's pending
copies, which block subsequent import until reconciled. No polling, bucket listing or scheduled workload is added.

Review round2 found P2 OFF-response state and permanent public objects. Both are addressed: every mutation response
includes the current import gate, and Google copies now use existing private source slots/short read capabilities.
No OWNER risk waiver is inferred. See Supabase [bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals)
and [batch signed URLs](https://supabase.com/docs/reference/javascript/storage-from-createsignedurls), checked 2026-11-17.

## Local follow-up — one gallery, consent separate from selection (2026-11-20)

Prepared locally on `045848c8`, not reviewed/deployed. The Google copy is the optional seventeenth tile when all
16 catalog variants are enabled; existing Terms/catalog rollout still controls which Arcade choices are shown.
All tiles use the same fixed-height grid, image slot, check marker and saved label. Google has only its image,
accessible label and tooltip, not a multiline description. One `avatarSelection` draft and the existing Save
button commit either choice. Selecting Arcade does **not** withdraw Google consent or delete the private copy.
The separate withdrawal dialog deletes that copy even when Arcade is active; it remains available when import is OFF.

`POST profile-google-photo {action:"select", expectedRevision}` reattaches only the authenticated user's existing
consented copy. It accepts no key, URL, provider token or new consent. It requires both rollout flags, V3 tracking,
ACTIVE lifecycle, current Terms, no moderator/profile hold, private bucket, a granted decision, an owned V3 source
manifest, no pending deletion and a successful existing Storage signing/availability check. No network call is made
under row locks: eligibility is checked before and again after I/O. The final lifecycle/consent/profile locks and
CAS serialize selection against Arcade changes, withdrawal and deletion. Consent revision/key cannot change
between checks. No new migration or storage write is needed. `updateUserProfile` keeps its existing detach and
suppression behavior; it never mutates the consent/copy record.

Only authenticated Account GET may return `previewAvatar` (TTL <=60 seconds) for the owner's inactive copy. It
rechecks eligibility after signing, never adds inactive keys to public/profile/leaderboard read projections and
never stores the URL in a durable client cache. Storage signed URLs are bearer capabilities: a link already
issued can remain usable until expiry, including after withdrawal; cached/saved recipient copies cannot be recalled.
After withdrawal, no new preview/selection is allowed, and the current gallery/photo presentation is cleared.
The existing profile renderer is reused unchanged, including expiry and stale-image fences.

Privacy review: current Privacy a3 mentions separate conscious photo permission, but describes catalog-only
avatars and does not explain retained inactive Google copies, owner-only preview or that catalog selection leaves
consent/copy intact. **Clarification and OWNER approval are required before public rollout.** This task does not
edit Privacy, its version/hash, Terms or the consent notice version. The Account explanation is explicit before
import and while a copy exists; it does not infer a new consent or renew an old one.

Local-only validation uses existing PGlite/Sharp/network fixtures for consent retention, Google/Arcade round-trip,
CAS, withdrawal races, moderator hold, foreign/missing objects and post-withdrawal refusal. Existing Account/Auth
fixtures cover selectable Google tiles and session changes; a temporary mobile-browser check measures equal tile
rectangles and no horizontal overflow. No broad maintained layout suite, live DB/Storage or APK run is introduced.
Review #13 requires separate GO. Public release, Privacy acceptance and physical-device testing remain OWNER gates.

Cost: one bounded owner GET adds two short eligibility transactions and one signing request for a single owned
object, never a bucket list; select uses the same one-object availability proof and final CAS. Existing public
batch signing is unchanged. No polling or automatic retries; owner status is refreshed only on existing events
and completed explicit avatar actions. Provider download cost remains import-only, at most 1MiB per allowed import.
