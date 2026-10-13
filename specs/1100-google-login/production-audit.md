# Production Google Login V1 — read-only Google audit

Initial read-only audit date: 2026-10-13 UTC. The initial audit made no mutations; the later authorized preparation is recorded below. Current status takes precedence over historical checkpoints.


## Current final preparation status

- READY: separate Google Production project and standard Web client created; exact Production origin/callback and three basic scopes verified; credentials private only.
- Google Audience remains External/Testing; not published. Branding verification deferred by owner and not an activation requirement for optional name/logo.
- PASS: Search Console ownership of kcswh.pl verified. Added exactly one TXT through official Netlify API using existing authorized CLI credentials; all11 prior DNS records unchanged, total12. Public TXT visible. Search Console Settings explicitly reports verified owner. Authoritative nameservers unchanged.
- Supabase Production Google=false and client absent; Netlify Production Google UI flag=false. No user/CH/ledger/Poker changes.
- Privacy PL/EN approved in principle; PR #1102 remains Draft awaiting owner merge GO. Dates currently 2026-10-13 (PL13-10-2026), today's UTC date, are preparation dates until publication. Recheck and set both to the actual intended Production deployment date immediately before owner-authorized merge; do not invent a future date or claim the policy is deployed.
- Publication, provider activation, production build flag, deployment and Production E2E remain unauthorized and unperformed.

## Historical read-only findings

- Authenticated Cloud Resource Manager lists Arcade Hub Stage (`arcade-hub-stage-1100`), Gemini API (`gen-lang-client-0448800862`) and My First Project (`predictive-fx-464622-f7`). No dedicated Arcade Production project is visible to this account. The Stage IAM page shows the Owner role and the Auth Platform is accessible. Effective permission/quota to create a new project/client cannot be proven without the deferred mutation; the Console offers project creation and the account previously created the Stage Web client successfully.
- Stage Verification Center says verification is not required because publishing status is Testing. This is Stage evidence, not approval of a future Production app.
- Search Console direct read of `sc-domain:kcswh.pl` explicitly reports no access for the signed-in account. Domain ownership is NOT verified for this account. The domain might already be verified by another account; absence of access does not prove no owner exists. No ownership challenge or DNS changes were requested.
- A separate standard Web client can be prepared safely after GO, isolated from Stage and using only the exact Production Supabase callback. No existing Production OAuth client was found through the accessible project inventory; none is configured in Production Supabase.

## Verification decision

For basic `openid/email/profile` scopes, public Published/External OAuth does not require sensitive/restricted-scope verification. Brand verification is not a prerequisite to public basic sign-in with the generic/unverified identity presentation. It is required to display the application's own name/logo on the Google consent screen. Thus verification is recommended for user trust, and mandatory for that specific branded presentation, not an unavoidable Google Login V1 activation blocker. Workspace administrator restrictions still apply.

If owner chooses branded consent, supply access to an existing verified `kcswh.pl` property for the Cloud project owner/editor, or perform Google's exact ownership challenge after GO. Do not claim ownership of Supabase's parent domain, add a custom Auth domain, or promise verification approval. Check Google's actual domain findings for the hosted Supabase redirect when configuring the Production client.

## Final proposed privacy addition

Add these matching paragraphs to the existing account-data section of `legal/privacy.pl.html` and `legal/privacy.en.html` only after approval. Existing public-profile, retention, rights and Supabase processor provisions remain applicable.

PL:

„Logowanie przez Google jest opcjonalne. Jeśli je wybierzesz, Google przekazuje Supabase identyfikator konta Google, zweryfikowany adres e-mail oraz podstawowe dane profilu, takie jak nazwa i zdjęcie profilowe. Dane te są przechowywane w ramach uwierzytelnienia Supabase i używane do utworzenia lub połączenia konta Arcade Hub, logowania oraz utrzymywania sesji. Nie otrzymujemy Twojego hasła Google ani dostępu do Gmaila, Dysku lub Kalendarza. SDK Supabase w przeglądarce przechowuje dane sesji i może zachować token dostępu Google; aplikacja nie kopiuje ani nie przekazuje tego tokena do swoich API. Zakres widoczności profilu gracza opisano poniżej; adres e-mail i tokeny nie są publiczne. Żądanie usunięcia konta można wysłać na contact@kcswh.pl zgodnie z sekcją dotyczącą praw użytkownika.”

EN:

“Google sign-in is optional. If you choose it, Google provides Supabase with your Google account identifier, verified email address and basic profile data, such as your name and profile image. These data are stored as part of Supabase authentication and used to create or link your Arcade Hub account, sign you in and maintain your session. We do not receive your Google password or access to Gmail, Drive or Calendar. The Supabase browser SDK stores session data and may retain a Google access token; the application does not copy or forward that token to its APIs. Gaming-profile visibility is described below; your email address and tokens are not public. You can request account deletion by emailing contact@kcswh.pl as described in the user-rights section.”

## Exact proposed mutations after separate GO

1. Google Cloud: new separate Arcade Production project (proposed ID `arcade-hub-prod-1100`, subject to availability/quota), app Arcade Hub, eligible support email, developer contact contact@kcswh.pl. External audience, Published/In production. Only openid/email/profile. Homepage https://play.kcswh.pl/, existing EN privacy/terms URLs, app domain kcswh.pl. Standard Web client, origin https://play.kcswh.pl, sole redirect https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/callback. No Stage project changes. Domain/branding verification and Publish branding only when authorized and necessary for the owner's selected branded presentation. Secret downloaded privately, never in repo/log/chat/Netlify.
2. Approved minimal PL/EN privacy paragraph through existing code/deployment workflow; no automatic account deletion or new auth mechanism. Owner performs any required PR merge.
3. Supabase Production `otbqfijerkieoxwpxjnm`: official Management API PATCH only external_google_client_id, external_google_secret, external_google_enabled=true. Preserve Site URL, existing redirect allowlist, signup, passwords and all other providers. Exact https://play.kcswh.pl/account.html is already allowed. Record existing broad *.netlify.app allowlist as a preexisting risk, without silently altering unrelated flows.
4. Netlify playkcswh only: AUTH_GOOGLE_ENABLED=1 in production/Builds, then build/deploy approved main revision. Keep preview flag and Stage credentials unchanged; no Google secret on Netlify. If connector cannot write this value, ask owner for only that env operation or prepare a minimal config PR; no merge by agent.
5. Authorized nonfinancial Production E2E with an ordinary Google account absent from Production and not a tester, plus existing verified-email UUID continuity, profile HTTP200, clean callback, sign-out/re-login same UUID and password regression. No CH/Poker actions or account deletion/recreation.

Rollback is in production-rollout.md: disable only Supabase Google first, restore Production build flag and rebuild/republish appropriate baseline; preserve users/profiles and already issued sessions. New Google-only sign-in is unavailable during rollback, not automatically converted to password login.

## References

- https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://supabase.com/docs/guides/auth/social-login/auth-google

Audit COMPLETE within current account visibility. Production project/client creation permission and Google's acceptance of future config are not write-tested. Await owner GO for all mutations.

## Historical preparation checkpoint — superseded below

Owner authorized project/client and privacy preparation, not public activation. Created separate `arcade-hub-prod-1100` (Arcade Hub Production). Auth configuration wizard has Arcade Hub name, owner support selection, External audience and developer contact contact@kcswh.pl; it is stopped at the owner's Google API User Data Policy checkbox. No client/secret exists yet; creation is pending that exact user step. No audience publication was performed.

Both available Search Console sessions report no access to sc-domain:kcswh.pl. Prepared the official DNS TXT ownership challenge in Search Console; its exact value is held privately/outside repo and visible in the user's browser. Requested addition of TXT at @ for kcswh.pl, preserving existing DNS. Did not modify DNS or claim ownership. Ownership on unavailable accounts remains unknown.

Prepared PL/EN privacy paragraphs and dates in Draft PR #1102, preserving existing content. CSP guard PASS for all55 served documents; diff check PASS. No merge by agent. Production read-back still Google=false, client absent, public UI flag=false. Final activation remains separately unauthorized. Standard Web client, basic scope read-back and final preparation report remain pending the policy acceptance; do not describe OAuth as ready yet.

## Completed preparation after owner's policy acceptance

- Auth Platform initialized for Arcade Hub Production in the dedicated `arcade-hub-prod-1100` project. External / Testing read-back confirmed; no public publication; zero test users and zero OAuth users.
- Standard Web client `Arcade Hub Production Web` created. Official downloaded JSON read-back validates project, sole JavaScript origin `https://play.kcswh.pl` and sole callback `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/callback`. Client ID/secret held only in private VPS directory0700/file0600, outside repo/chat/logs. Client credentials have NOT been applied to Supabase Production or Netlify.
- Saved and read back exactly three basic scopes: openid, userinfo.email, userinfo.profile. No additional/sensitive/restricted scopes.
- Saved app homepage, EN privacy and EN terms URLs on play.kcswh.pl; support email selected from eligible owner account and developer contact contact@kcswh.pl. No optional logo uploaded, no brand verification submitted, no application published. Minimal V1 public activation does not depend on optional brand verification.
- Domain remains unverified for both available Google sessions. Official Search Console TXT challenge is ready; public DNS read found expectedTXT=false and zero google-site-verification TXT records. User has been asked only to add the displayed TXT at @ for kcswh.pl. No DNS mutation by agent; verification on unavailable Google accounts cannot be checked globally.
- PL/EN privacy review remains Draft PR #1102. CSP55 PASS. Previous documentation HEAD CI:17 PASS /13 expected skips; final documentation checks will be reported separately, not inferred.
- Supabase Production read-back: Google=false, client absent. Public production config: AUTH_GOOGLE_ENABLED=false. No user-data, CH, ledger or Poker operation performed.

Preparation READY for owner review. Final activation still requires a new explicit GO covering: owner-approved privacy merge/publication; Google Audience publication to In production (no optional branding submission unless selected); private client credentials applied through official Supabase Production API and provider enabled; Netlify playkcswh production Builds flag=1 plus approved main rebuild; real nonfinancial Production OAuth smoke with a non-tester and same-UUID profile/repeat checks. Agent will not merge any PR. Domain TXT/brand verification remains separately pending and is not silently declared PASS.

## Domain verification completed

Netlify MCP has no DNS operation, but existing authenticated CLI credentials authorized official Netlify API access to kcswh.pl zone. Added one ownership TXT, TTL3600; compared all existing record objects unchanged. Public DNS confirmed the exact expected TXT. Google Search Console for sc-domain:kcswh.pl now opens normally and Settings reports “Jesteś zweryfikowanym właścicielem”. Domain ownership PASS. Keep TXT in place to retain verification. No Google application publication, Supabase provider activation, Netlify production build-flag change, deploy, merge or user/financial/Poker operation. Final activation remains pending separate GO.
