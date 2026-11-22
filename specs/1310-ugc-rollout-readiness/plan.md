# Implementation Plan: rollout gates for 16 avatars, Google photo and UGC safety (#1310)

**Branch**: `1310-ugc-rollout-readiness` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)
**Status**: research and plan only. Nothing below has been executed.

## 1. Inventory (verified 2026-11-22, read-only)
| Item | Stage (`krydukthwdvccggbyjfw`) | Production (`otbqfijerkieoxwpxjnm`) | Source |
|---|---|---|---|
| `private.profile_terms_policy` | a2, active, `variants_enabled=true`, normalized | `variants_enabled=false` | Stage SQL read 2026-11-22; Production from the #1310 body |
| B `20261107120000_ugc_reports_blocks` (`private.user_blocks`, `private.ugc_reports`) | applied, tables present | absent | Stage `schema_migrations`; #1310 body |
| C `20261107130000_ugc_moderation` (`ugc_moderation_actions`, `ugc_avatar_holds`, `ugc_moderation_counters`) | applied | absent | same |
| D `20261107140000_google_photo_consent` (`private.profile_photo_consents`) | applied; consent rows use g4 `2026-11-21-g4` | absent | same |
| bucket `profile-avatar-uploads` | private | **to verify (T001)** | Stage SQL |
| `supabase/production-migrations/` | — | ends at `20261105160500`; no B/C/D equivalents exist yet | repo |
| Netlify Production flags | — | `UGC_SAFETY_ENABLED`, `GOOGLE_PHOTO_IMPORT_ENABLED`, `POKER_TABLE_PHOTO_ENABLED` empty; `ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED=1` | #1310 body |
| LIVE WWW `308806cc` | — | contains `ugc-report`, `user-blocks`, `admin-ugc-reports`, `profile-google-photo.js`, `ugc-client.js` and 16-variant support. **Lacks** `poker-table-photo.mjs` (g4 tables) | repo at `308806cc` |
| WS Production | — | `98fb6fac` (contains #1282) | VPS 2026-11-22 |

Code gates:
- `netlify/functions/_shared/ugc-safety.mjs::ugcSafetyEnabled`: `UGC_SAFETY_ENABLED==='1'`.
- `netlify/functions/_shared/profile-photo-publication.mjs::googlePhotoEnabled`: `GOOGLE_PHOTO_IMPORT_ENABLED==='1' && UGC_SAFETY_ENABLED==='1'`.
- `netlify/functions/_shared/profile-google-photo.mjs`: `POKER_TABLE_PHOTO_ENABLED==='1'` switches the notice to g4.
- `js/profile-onboarding.js::getAvatarVariants`: `variantsEnabled ? 16 : 6`.

## 2. Isolation decision (T003)
- **(a) Default, chosen: Stage-bound Deploy Preview** for ON acceptance. Deploy Previews use Stage Supabase, WS Preview and Stage keys. The flags are scoped to that preview's branch or deploy-preview context.
  - The `feat/1282` branch override is already ON. A new branch needs the same three overrides; this is a Netlify non-Production change needing OWNER GO.
  - The Android Stage APK of that preview can be tested by the OWNER through the existing debug-APK path.
- **(b) Ruled out: feature-ON T007 Candidate before Production activation.**
  - `www-candidate.yml` builds in the `production` context, against Production functions and data, so branch overrides do not apply.
  - Turning the Production flags or policy on affects LIVE at the same moment, because LIVE already contains the B/C/D and 16-variant code.
  - No safe per-Candidate isolation exists. Host/Origin switches are prohibited.

## 3. Safety and legal gates (T004)
- **Moderation:** before `UGC_SAFETY_ENABLED=1` on Production, the OWNER documents:
  - the queue owner;
  - the review cadence, for example daily;
  - the target response time;
  - the escalation and avatar-hold policy;
  - who can reach the admin `admin-ugc-reports`.
- **Legal:**
  - Privacy a4 is LIVE and covers the profile/leaderboard photo (g2) and reports/blocks. Confirm this in T001 against `legal/privacy.2026-11-20-a4.*`.
  - Privacy a5 (g4, Poker tables) is OWNER-approved but not published. It must be published before `POKER_TABLE_PHOTO_ENABLED=1`.
  - Terms a2 is active on Production.
- **Play Data Safety:** reconcile with `specs/1140-ugc-safety/google-play-data-safety-draft.md` (photos, reports, blocks) before any public Android release that shows these features. Internal testing is unaffected.
- **Google proof and SSRF:** the existing provider-subject proof and the private bucket stay unchanged. No new egress.

## 4. Production activation order (each step is a separate OWNER GO, with read-only receipts before and after)
| Step | What | LIVE effect | Rollback |
|---|---|---|---|
| P0 | T001 read-only Production inventory: bucket present and private, FK targets, roles, `account_avatar_objects` tracking, absence of B/C/D tables, current `ensure_user_profile` | none | n/a |
| P1 | Write and review the production equivalents `supabase/production-migrations/<ts>_ugc_reports_blocks_production.sql`, `<ts>_ugc_moderation_production.sql` and `<ts>_google_photo_consent_production.sql`, plus manifest entries (Claude author → Codex review, Draft PR, OWNER merge) | none (repo only) | n/a |
| P2 | Apply B and C equivalents on Production (OWNER operator path, `docs/operations.md` §Promote) | none while flags are OFF (additive schema) | none needed; schema stays |
| P3 | `UGC_SAFETY_ENABLED=1` (Production context) | report/block plus admin queue become live on LIVE WWW and the Android app | flag OFF |
| P4 | Apply the D equivalent | none while the photo flag is OFF | schema stays |
| P5 | `GOOGLE_PHOTO_IMPORT_ENABLED=1` | optional Google photo (g2: profile/leaderboard) live on LIVE | flag OFF; copies and consent remain, withdrawal still works |
| P6 | Production catalog operation `specs/1114-arcade-profiles-avatars/operations/enable-catalog-production.sql` (new, reviewed; Production pins, current `ensure_user_profile` body) | 16 avatars live immediately on LIVE | `variants_enabled=false`; existing choices stay valid |
| P7 | New WWW Candidate from main (after #1311), feature-ON smoke (read-only plus the OWNER's own account) | none until Publish | discard via guarded T007 |
| P8 | OWNER WWW Publish (includes Privacy a5 and #1282), then `POKER_TABLE_PHOTO_ENABLED=1` | g4 table photos live | flag OFF |

P3/P5/P6 can be run in a different order once their gates are met, but P3 must come before P5.

The current Candidate #45007484109 stays publication NO-GO. Reconcile or discard it only by a separate OWNER decision, using the T007 guarded discard with 404 proof.

## 5. Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity | PASS: reuses existing flags, the production-equivalent pattern, Deploy Preview and T007. No new infrastructure |
| III Fail-closed / env separation | PASS: Stage first; each Production step has its own GO and receipts; flags default OFF; additive schema |
| IV/V | no code in this plan; any later equivalents get fundamental contract tests in the existing `tests/chips/*production*.fixture.mjs` pattern |
| Merge / deploy | no merge, deploy, flag change, SQL or publication here |

## 6. Breaking impact
- P3, P5, P6 and P8 change the user-visible behaviour of LIVE WWW and of installed Android apps that use the Production API, at the moment they are executed.
- These steps also bring new personal-data processing: photos, reports and blocks. They must not run before the disclosures and the moderation process are in place.
