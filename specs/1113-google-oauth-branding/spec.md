# #1113 — Google OAuth branding for Arcade Hub

**Status:** approved name/logo verified and published in Google Production; desktop display/login/UUID PASS; owner-confirmed physical-phone branding/login PASS. 2026-10-16.
**Reviewed main:** `846b2993f3d9cd95d11c1061d9a1175e33464b76`.
**Source:** https://github.com/krzysztofcal/arcadePlatform/issues/1113

## Goal

Production Google consent should identify the service as **Arcade Hub by KCSWH** where Google permits verified app branding. Use the existing Google Auth Platform project `arcade-hub-prod-1100` and its existing Web OAuth client. Standard brand verification is preferred; no new client, paid service, custom Supabase domain or OAuth scopes by default.

## Invariants

Google Login V1 from completed #1100 remains unchanged. Production Supabase `otbqfijerkieoxwpxjnm`, current Google client ID/secret, origin `https://play.kcswh.pl`, callback `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/callback`, application return URL/account flow and UUID authority stay unchanged. Stage project `arcade-hub-stage-1100` is out of scope. Only basic openid/email/profile. No DB, financial, XP, Poker, account creation/deletion, DNS or deployment operation in this audit.

## Acceptance criteria

- Actual new-consent presentation on mobile and desktop shows approved name/logo where supported, not merely a changed Console form. Report residual mandatory technical-domain text honestly; no promise to remove every supabase.co reference.
- Google brand verification/publication outcome is recorded, separately from Audience publishing status or data-access verification.
- Existing-user Google repeat sign-in, callback, same UUID, session restoration/logout and password sign-in remain functional, without financial actions.
- No paid add-on, extra scope, alternate OAuth client or Stage mutation without separate explicit approval.
- Fail/partial/Google domain or homepage rejection means STOP and report; no automatic domain/client workaround or access expansion.

## Historical owner gates (superseded by execution and final acceptance)

Current authorization covers this audit and local documentation only. A separate GO must identify approved Branding edits and whether Verify Branding / Publish branding are authorized. The owner explicitly selected the attached KCSWH logo; no substitution or name-only publication is allowed. Any Google policy/2FA/owner-only step needs the owner's actual action. Any homepage-code/deployment, DNS or custom-domain change needs a new scoped proposal and approval; the audit does not authorize it.

## Historical approved logo requirement / resolved input blocker

Owner approved **Arcade Hub by KCSWH** plus their supplied KCSWH logo, unchanged appearance/proportions/transparency, in existing Production project. Preserve every current URL/domain/client/callback/scope. Verify Branding and publish only after verified PASS/Ready to publish. This supersedes the earlier name-only proposal.

The accessible attachment is actually **1254x1254**, 8-bit RGBA PNG, **1,389,582bytes**, SHA-256 `3173da777671b9962732e8808afd02d767a0ce43c70a954181c280415076cd29`, rather than the described120x120 asset. It exceeds Google's1MB upload limit. No resize, crop, background replacement or generative alteration was performed. Need an upload-compliant version of the same logo (or explicit instruction for deterministic resizing); the existing configuration GO remains valid for the approved scope. This is a local input validation blocker, not a Google verification rejection.

## Compliant replacement and execution outcome

Owner supplied the replacement [KCSWH PNG](assets/kcswh-oauth-120.png):120x120 RGBA,25,519bytes, SHA-256 `e3c972a22ad46db47991459ffa4c188ba7fb5177e1f9fa04252b3b0426777b51`. The previous input-size blocker is resolved; owner authorization remains effective. Saved name and supplied logo in the existing Google project at2026-10-16T21:52:15.159Z (single explicit Save). Google-served120x120 PNG is re-encoded, but all RGBA pixels and alpha are exactly equal to the source. No resampling/substitution/background change by the agent.

Google readback: `NEED_VERIFICATION`, requirement `UNVERIFIED_LOGO`, compliance status unspecified/not evaluated. No rejection result or Ready to publish. Verification Center says branding is not shown and points to Branding, where this session has no Verify Branding control (PL/EN and accessibility tree checked). No verification request was sent; no publication attempted. This was a historical main-form-only checkpoint, superseded by the Information and summary discovery below. Mobile/desktop branded consent and new auth/UUID regression remain NOT TESTED pending verified publication.

## Current outcome — verified and published

The earlier missing-control diagnosis is superseded. The blue **Information and summary** icon beside the Branding heading opens a side panel containing Verification status and Verify branding. The main-form/text-only enumeration missed this accessible icon; there was no demonstrated Google platform block. Owner screenshot and a community report led to the actual UI path.

Owner-authorized Verify branding clicked once2026-10-16T22:10:08.811Z; actual verified/ready-to-publish message checked before one Publish branding click22:11:45.695Z. Readback22:12:46.298Z explicitly says verified and being shown to users; UI response metadata confirms VERIFIED/COMPLIANT and verified nameArcade Hub by KCSWH. No bypass, alternate client, paid domain, scope/DNS/app change.

Desktop real Google chooser/reconfirmation displays approved name and logo. Normal Google button and a separate same-basic-scope consent re-prompt both authenticate the known pre-existing Production user with the same UUID; correct clean account callback, reload session and profileHTTP200 PASS. Physical-phone branding and Google login in a private tab are PASS by explicit owner confirmation, separately from agent desktop evidence. Current password-login regression NOT TESTED (historical#1100 acceptance retained). Owner accepts the existing private Google account as public support email; developer contact remains contact@kcswh.pl. Owner explicitly authorized final documentation, merge of#1121 and closure of#1113 after successful checks.
