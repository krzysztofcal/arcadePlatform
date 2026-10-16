# #1113 — Google OAuth branding for Arcade Hub

**Status:** read-only audit complete; owner review/GO required before configuration changes or verification submission. 2026-10-16.
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

## Owner gates

Current authorization covers this audit and local documentation only. A separate GO must identify approved Branding edits and whether Verify Branding / Publish branding are authorized. A new logo requires owner-approved artwork. Any Google policy/2FA/owner-only step needs the owner's actual action. Any homepage-code/deployment, DNS or custom-domain change needs a new scoped proposal and approval; the audit does not authorize it.
