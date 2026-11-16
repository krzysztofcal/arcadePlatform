# Google Play Data Safety — working declaration (#1140)

**DRAFT / OWNER REVIEW, not submitted, not Google/legal approval.** Evidence date: 2026-11-16.
This is a proposed form mapping, not a change to Privacy a3 or consent. OWNER-confirmed profile, login and
retention checks remain PASS; none were repeated. Terms ON is not a Play publishing authorization.

## Artifact and scope

Inspected existing successful [APK run 43921367171](https://github.com/krzysztofcal/arcadePlatform/actions/runs/43921367171),
PR #1269, source `e27a685c579545c632b819f1a405285a0d7904a9`, APK SHA-256
`67557a63dc4e421aa0f1af7abed00d4998b620e4173c1cbe690f857011e25ee4`.
Build receipt: `pl.kcswh.arcadepoker.stage`, 0.0.1/versionCode 1, debug signing, API
`https://deploy-preview-1269--playkcswh.netlify.app`, Supabase `krydukthwdvccggbyjfw`, WS Preview.
This is the latest successful artifact discovered at inspection, not proof of which APK OWNER currently installed.
No Production APK/AAB or active Play track inventory was supplied/verified. Before final answers bind the form to
the intended signed package and all distributed versions/tracks; **do not submit Stage answers as Production facts**.

APK ZIP inspection confirms bundled Terms a2 and Privacy a3 PL/EN with identical `<main>` text to repository/live
immutable documents; the packager changes surrounding markup. Build-receipt CSP/SRI PASS is historical build evidence.
`mobile/poker/package-web.mjs` removes website analytics/consent scripts and external font links; dependencies in
`mobile/poker/package.json` are Capacitor core/android/app/browser and Supabase, with no declared advertising,
analytics or crash SDK. No analytics-named APK entries were found; this is not an exhaustive SDK/network audit.
The managed WebView's online collection is still in scope, including API, Auth and WS. Offline-only local saves
are not transmitted by the offline game and are not collection solely because they exist on device.

Sources in repo: `mobile/poker/{package-web.mjs,runtime.js,security.cjs,capacitor.config.json,package.json}`,
`js/{profile-onboarding.js,account-page.js}`, `shared/profile-terms.mjs`, `netlify/functions/profile-onboarding.mjs`,
`legal/privacy.2026-11-12-a3.{pl,en}.html`, and
[retention evidence](../1157-settled-data-retention/privacy-data-safety.md). No new APK build or runtime test was run.

## Proposed form answers

- Collect user data: **Yes** for online functions. Not all data is ephemeral: Auth, profiles, game state,
  settlements and acceptance records persist. Local diagnostic logs alone are not server collection.
- Sharing: **Yes proposed** for player identity and activity exposed to other signed-in users/players by default.
  Do not assert “no sharing” from lack of ads. Service-provider processing and specifically user-initiated transfers
  may qualify for Google's exceptions; record actual processing terms and informed expectations before applying one.
  Registration-default profile visibility is not automatically a specific voluntary sharing action.
- Encrypted in transit: **Yes proposed**, based on HTTPS Supabase/API, WSS and native cleartext/mixed-content disabled.
  Final signed artifact/provider paths must match; this is transport encryption, not end-to-end encryption.
- Account creation: email/password and Google OAuth (optional choice of provider); no Google password is collected
  by the app. Account management/online identity require user IDs; anonymous/local Offline mode is separate.
- Account deletion: **Yes, request available** through Account and web URL `https://play.kcswh.pl/account.html#account-deletion`,
  also contact `contact@kcswh.pl`. Privacy policy URL: `https://play.kcswh.pl/legal/privacy.en.html` (PL alias available).
  Retain already accepted deletion evidence; at Console entry verify URLs still expose the approved flow, without
  repeating login/profile/retention tests. Do not claim optional deletion of individual data categories without
  deleting the account: that separate answer is OPEN unless a supported path is established.
- Independent security review / payments certification: no affirmative claim without that certification evidence.

Each row below is a **draft**. “Required” refers to the applicable online feature; Google requires classification
against the app's primary functionality/all users, so OWNER must resolve Offline/guest versus online scope before entry.
Purposes use Google's form vocabulary; no advertising/marketing purpose is evidenced.

| Data type | Collection / persistence | Sharing proposal | Purpose / required or optional |
|---|---|---|---|
| Personal info → Email address | Yes for account Auth, persistent | Provider processing; no player display | Account management, App functionality; required for email account, review Google/guest alternatives |
| Personal info → User IDs | Yes: account UUID, handle, player/guest identifiers and Terms subject ID, persistent | Yes: public-to-signed-in player handle/identity; private UUID/auth credentials not exposed as profile fields | App functionality, Account management, Fraud prevention/security/compliance; required online identity |
| Personal info → Name | Google basic name received through chosen OAuth; not automatically public | No automatic photo/name publication; provider exception needs verification | Account management; optional Google login |
| Photos and videos → Photos | Google photo information received through chosen OAuth; URL/metadata may identify a photo even without upload | Not automatically published; any future photo import needs separate informed consent | Account management; optional Google login; confirm final SDK response/persistence before entry |
| App activity → Other actions | Yes: gameplay, reactions, virtual gifts/CH settlements, XP, acceptance version/time/request ID | Player actions, XP/level visible in their feature contexts; private ledger not public | App functionality, Fraud prevention/security/compliance; required for relevant online play, optional reaction/gift choices |
| App activity → App interactions | Server requests/feature use may be logged; no bundled website analytics scripts | Provider processing, subject to verification | App functionality; Analytics only if actually used to measure/diagnose behavior; required technical requests |
| Device or other IDs | Guest/session/browser identifiers and IP/technical logs need final mapping, not a claim of hardware/advertising-ID collection | Provider processing, subject to verification | App functionality, Fraud prevention/security/compliance; required where sent online; exact IP/identifier use OPEN |
| App info and performance → Diagnostics / Crash logs | Error information in Privacy a3; classify actual off-device diagnostics as collected. No native crash SDK proven | Provider processing, subject to verification | Analytics if used for diagnosis; distinguish local KLog from transmitted data; exact crash-log collection OPEN |
| Financial info → Purchase history | Virtual gift transaction records exist; classify against Google's transaction definition rather than assuming no purchase history because CH is free | No private ledger publication | App functionality, Fraud prevention/security/compliance; OPEN: OWNER review of virtual-only transactions. No real payment info/credit score collection evidenced |
| Messages → Emails / Other user-generated content | Optional support email may include supplied content; future UGC report/moderation data not implied active by #1140 code | Support providers as applicable | App functionality, Account management, Fraud prevention/security/compliance; optional support; report/block/moderation/photo phases require separate activation-aware update |

Not evidenced in current package/source: GPS/precise location, contacts, calendar, SMS/call logs, microphone/audio,
user videos, arbitrary files, health, credit/payment-card data, installed-app inventory or browsing-history tracking.
Do not equate an OAuth photo with camera/gallery permission. Do not infer approximate location from IP alone:
if a provider derives/uses location, declare the appropriate location category after checking its actual practice.
These are provisional exclusions, not final negative declarations for an uninspected signed AAB or SDK rollout.

## Privacy a3 / retention consistency

Keep the a3 distinction: profile visibility to signed-in people and table identity, separate leaderboard opt-out,
Google name/photo not automatically public, and Terms acceptance distinct from photo or analytics consent.
Versioned Terms receipts do not grant analytics/photo consent. Terms OFF never erases existing receipts.
Do not restore generic website analytics to the APK simply to match Privacy's optional website-analytics paragraph.

The form has no universal retention-duration field. Linked Privacy describes batched deletion/minimization of
settled game/settlement/deletion-request records after 12 months, possibly later due to backlog. It expressly
retains existing-account balance history, deleted-account settlement history/identifier and in-progress integrity
records under the stated criteria. Provider copies/backups have their own rules. Never answer “all data deleted
immediately/on uninstall/after 12 months”; receipt guest validity of one hour is not guaranteed physical purge time.

## Official sources (checked 2026-11-16)

- [Google Play Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en):
  form scope includes controlled WebViews/SDKs and distributed versions; defines collection, ephemeral processing,
  sharing exceptions, data categories, purposes and optional/required. A service provider is not automatically every third party.
- [Android data-use guidance](https://developer.android.com/privacy-and-security/declare-data-use): inspect actual
  permissions/APIs and WebView code; a permission list alone does not establish all off-device data flows.
- [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en):
  account-creating apps need in-app and web request paths; legitimate retention exceptions must be disclosed.

## OWNER decisions before submission / separate GO

1. Name signed Production AAB/package/versionCode/hash and all active Play tracks/older artifacts. Confirm intended
   audience and current SDK/permissions/data flows; no inference from Stage debug signing or Terms ON.
2. Resolve exact provider purposes/roles, public-profile sharing classification, Google photo/name payload,
   diagnostics/IP use, required/optional scope and virtual transaction classification above. Until resolved,
   **FACTUAL OPEN / not ready to submit**; do not silently choose “No”. Data Safety is OWNER's declaration.
3. Reconcile final answers with published Privacy a3 and existing deletion evidence; keep OWNER's PASS records.
   UGC reports/blocks/moderation or Google-photo publication add/update answers only when their actual rollout is known.
4. Separate explicit OWNER GO to enter/submit the final form, and separate signing/testing/Play release gates.
   This PR authorizes neither. Production Terms execution uses its own [runbook](../1114-arcade-profiles-avatars/operations/terms-activation.md).
