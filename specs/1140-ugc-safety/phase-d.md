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
- Public avatar bucket is an existing architectural boundary: the profile API remains authenticated, but anyone
  with an image link can read/copy that image. The separate consent explicitly discloses this. Withdrawal removes
  current application publication and requests deletion of our copy; downloaded/browser/CDN copies cannot be recalled.
  New Google copies use cache-control 0 rather than the legacy one-year upload cache. This is not private Storage
  or an instantaneous guarantee to erase all caches. OWNER must approve this exact disclosure before activation;
  a requirement for authenticated object access needs a separately reviewed private-storage design.
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
2. Separate OWNER Stage apply of the reviewed SQL; separate approved Preview deployment and opt-in flag context.
   No auto Stage apply on push/PR; Production equivalent/identity review has its own GO. Keep public import OFF elsewhere.
3. Exact-build WWW + Android acceptance and independent review before Ready. Separately update/approve Privacy,
   Data Safety and moderation procedures if needed before public rollout. A WWW change never upgrades installed APKs.
4. Disable new imports/publication with the flag; withdrawal of existing copies stays available. Resolve uncertain
   writes through the existing manifest/deletion procedure, never delete another user's key or claim cache erasure.

No intentional breaking change while OFF. When enabled, approved photos may replace the catalog avatar on the
existing WWW projections; WS/table avatar projection stays catalog-only. Withdrawal needs no provider login and
preserves existing game/ledger/settlement behavior. Provider-token expiry may require an explicit Google re-login.
Egress: one userinfo + at most 1 MiB image per allowed import (5/account/hour), one normalized Storage write;
publication reads batch the existing bounded leaderboard/profile IDs; withdrawal reads only that account's pending
copies, which block subsequent import until reconciled. No polling, bucket listing or scheduled workload is added.
