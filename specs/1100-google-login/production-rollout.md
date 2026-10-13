# Google Login V1 — Production rollout (prepared, not authorized)

## Scope and observed baseline — 2026-10-13 UTC

Reuse merged PR #1101; no auth/session refactor, PKCE, new providers, schema migrations or WS deployment. No Production mutations, login attempts or Google publication were performed for this preparation.

- Production URL: https://play.kcswh.pl/account.html. Public page HTTP200 includes Google button markup; `/js/auth/supabase-config.js` HTTP200 has `AUTH_GOOGLE_ENABLED: false` and Supabase ref `otbqfijerkieoxwpxjnm`.
- Supabase project `arcade-portal`: Google disabled; Google client ID and secret absent; signup enabled; manual identity linking disabled. Site URL `https://play.kcswh.pl`; allowlist contains exact `https://play.kcswh.pl/account.html`, `https://play.kcswh.pl/*`, `https://*.netlify.app`. Read through official Management API, secrets never emitted.
- Netlify project `playkcswh`, site ID `f7e19a84-28f7-41f7-978a-f3b4552a404d`; current ready Production deploy `6aceaefdf40f0609c1192e3c`, commit `788af6ebc724702bd6f2f12979b721d8fb5b4b75` (merge #1101). Site has no password or team-SSO gate. Production build flag currently false; preview flag stays enabled in `netlify.toml`.
- Stage remains separate: `krydukthwdvccggbyjfw`, Google Cloud `arcade-hub-stage-1100`. Both existing verified-password identity continuity and genuinely new Google identity/profile/repeat UUID passed Stage. Final PR HEAD checks were 23 PASS / 7 expected skips.
- Production privacy and terms EN URLs return HTTP200. Existing privacy text covers generic Auth/Supabase but Google-specific access/use/storage/sharing is missing; Google Analytics mention is unrelated.
- Google Production project/client and Search Console ownership are NOT VERIFIED yet: private browser currently needs owner reauthentication. No new Production Google project/client has been created. No existing Stage project will be republished as Production.

## Required Google configuration (after GO)

Use a dedicated Google Cloud Production project (proposed `arcade-hub-prod-1100`, availability not yet checked), separate from Stage. If owner already has a suitable Production project, inspect and reuse it rather than create duplicates.

1. Google Auth Platform Branding: app `Arcade Hub`, owner-controlled support email selected from eligible Console choices, developer contact `contact@kcswh.pl`. Homepage https://play.kcswh.pl/; privacy https://play.kcswh.pl/legal/privacy.en.html; terms https://play.kcswh.pl/legal/terms.en.html. Confirm public homepage describes app and links legal pages. Authorized app domain `kcswh.pl`; confirm associated owner/editor has Search Console domain ownership. Any DNS/domain verification challenge is supplied by Google and needs its exact value, never invented.
2. Audience External; publish as In production/Published, with no dependency on test-user allowlist. Scopes only `openid`, `email`, `profile` (Google Console may label email/profile as userinfo.email/userinfo.profile). No Drive/Gmail/Calendar scopes, offline access or extra APIs.
3. Standard **Web application** OAuth client: `Arcade Hub Production Web`; authorized JavaScript origin `https://play.kcswh.pl`; exact redirect URI `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/callback`. The app account URL is the Supabase redirectTo, not Google's redirect URI. No Stage/Preview/localhost redirects on this Production Google client.
4. Download client JSON directly through official Console to a private VPS directory0700/file0600, outside repo. Apply secret directly to Supabase in memory through official Management API; never put it into command arguments, diagnostics, browser artifacts, chat or Netlify/frontend config. Store private rollback material with the same permissions; do not enable shell tracing or HTTP debug output.
5. Publishing and brand verification are separate. Basic identity scopes are non-sensitive and do not require sensitive/restricted-scope verification or a restricted-scope security assessment. Published External apps do not use tester allowlists. Google's current docs also describe a basic-scopes exception in Testing; this rollout nevertheless explicitly publishes Production. For the app name/logo to appear on the consent screen, complete brand verification and Publish branding. Automated review can be quick, manual review may take 2–3 business days; do not promise approval. Domain/redirect ownership requirements (including Supabase hosted callback) must be checked against actual Console findings and Supabase guidance; do not invent ownership of `supabase.co` or introduce a custom Auth domain as an assumed requirement.
6. If Google requires login/2FA, policy acceptance, domain proof or an email response, ask the owner only for that specific step. Do not bypass checks, use private APIs, or publish anything before GO.

“All users” means no app tester restriction; Google Workspace administrators can still block external OAuth apps, and disabled Google accounts cannot sign in.

## Minimal privacy text prepared for owner review

Add a matching short paragraph to existing `legal/privacy.en.html` and `legal/privacy.pl.html`, after account data collection; publish only after GO and owner acceptance of its accuracy.

EN: “If you choose Google sign-in, Google provides your account identifier, verified email address and basic profile information, such as your name and profile image. Supabase processes these data to create or link your Arcade Hub account and maintain its authentication session; Arcade Hub uses the account and profile data to provide sign-in and your gaming profile. We do not request access to Gmail, Drive or Calendar. The Supabase browser SDK may retain a Google access token in its local authentication-session storage; Arcade Hub does not copy or forward that token to its application APIs. Google sign-in data are not used for advertising. Account deletion requests can be sent to contact@kcswh.pl as described below.”

PL: „Jeśli wybierzesz logowanie Google, Google przekazuje identyfikator konta, zweryfikowany adres e-mail i podstawowe dane profilu, np. nazwę i zdjęcie profilowe. Supabase przetwarza te dane, aby utworzyć lub połączyć konto Arcade Hub i utrzymywać sesję uwierzytelnienia; Arcade Hub używa danych konta i profilu do logowania oraz obsługi profilu gracza. Nie prosimy o dostęp do Gmaila, Dysku ani Kalendarza. SDK Supabase w przeglądarce może zachować token dostępu Google w lokalnym magazynie sesji uwierzytelnienia; Arcade Hub nie kopiuje ani nie przekazuje go do swoich API aplikacyjnych. Dane logowania Google nie są używane do reklam. Żądanie usunięcia konta można wysłać na contact@kcswh.pl zgodnie z opisem poniżej.”

## Execution order and approval gates

1. **Before GO:** read-only inventory, docs, proposed privacy text, exact callbacks, security review and rollback baseline (this document). Verify Cloud/domain status after owner login. No Production config commits, merge, publishing, provider activation or deploy.
2. **GO must cover** Google Production project/Web client and external publication/branding, minimal privacy publication, Supabase provider activation, Netlify production flag/build and nonfinancial Production auth smoke. Owner alone merges any configuration/doc PR needed for publication; agents never merge. GO to activate does not authorize financial or Poker activity.
3. After GO, privately snapshot the exact current Supabase auth settings and Production deploy ID/flag. Recheck pinned Production ref and current deploy; baseline can change. Create/configure Google as above; complete required brand/domain steps. If review is required, stop activation until the applicable Google requirement is satisfied.
4. Publish approved privacy paragraph using the existing deployment flow while Google UI remains false. Check HTTPS legal pages and links. No unrelated configuration changes.
5. Official `PATCH /v1/projects/otbqfijerkieoxwpxjnm/config/auth`: set only `external_google_client_id`, `external_google_secret`, `external_google_enabled: true`. Preserve Site URL, signup/password/recovery/email settings and existing redirect entries. Exact account URL is already allowed. Read-back confirms enabled and matching ID; compare secret in memory if needed, output booleans only. Verify public `/auth/v1/settings` reports Google enabled. Do not dump response headers/session artifacts with credentials.
6. Netlify: set `AUTH_GOOGLE_ENABLED=1` only for **playkcswh / production / Builds** using authorized official UI/API. Do not use a global/all-context value. No Google secret belongs in Netlify. Trigger Production rebuild from the owner-approved main revision and verify ready deploy + generated public config points to `otbqfijerkieoxwpxjnm` and flag true. Env changes alone do not change already built files. If API write permission is absent, owner changes this one env value or approves a minimal production-context `netlify.toml` config PR; no mutation of Production before GO and no auto-merge. Stage/preview config unchanged.
7. Production nonfinancial smoke: owner-selected existing verified-email account logs in with Google with same UUID, reload restores, sign-out works; Google identity absent from Production and not on any test list registers, receives one matching profile, sign-out/re-login keeps UUID. Verify profile HTTP200, clean callback, generic errors/retry and existing password login/sign-out. Use actual owner accounts; no deleting/recreating accounts or impersonation. No JOIN, bonuses, funding, gameplay, CH/ledger/Poker mutations or financial cleanup. Existing normal account initialization is used unchanged.
8. Retain only counts, enums, HTTP status and equality booleans. Confirm no callback token/query in analytics or application diagnostics. Inspect frontend/session audit without token dumps; SDK-managed provider-token persistence is acknowledged, not zero-token persistence. Production E2E remains NOT TESTED until actually run.
9. Report exact config/deploy/commit, PASS/FAIL/NOT TESTED and any Google review limitation. No automatic merge.

## Security verification and limits

- Existing `signInWithGoogle()` checks default-off flag, provider availability, fixed same-origin `account.html` redirectTo, and validates returned authorize origin/path/provider. `getCurrentUser()` permits SDK consumption before scrubbing callback; missing/broken SDK cleans token fragments. Successful password sign-in clears stale error. Existing automated auth cases and Stage real browser tests passed.
- No service-role key or Google client secret is exposed to browser. Existing public Supabase publishable/anon key remains public; never substitute admin key. Existing JWT/RLS/profile identity architecture remains; automatic verified-email identity linking, no manual profile/UUID merge or new linking UI.
- Existing Production `https://*.netlify.app` allowlist is broader than needed for Google V1. Record as a preexisting redirect exposure and do not silently remove entries without auditing other password/recovery consumers. Production Google client accepts only Production Supabase callback and this UI sends only same-origin account redirect. This does not make the existing Supabase allowlist exact-only.
- Implicit flow and SDK local session persistence are deliberate accepted V1 limitations; access/refresh fragments are transient before SDK consumption. SDK may store provider_token. No unsupported claim of zero exposure or no token persistence; no PKCE/session rewrite in this rollout.
- Domain ownership, Production Google brand status and required verification are pending actual Console inspection, not PASS. Netlify write permission is not proven by read access.

## Rollback (after GO, on callback/auth/profile/identity failure)

1. Stop smoke immediately on identity mismatch, callback leakage or repeat auth failure. Do not delete users/profiles or mutate financial data.
2. Immediate kill switch: official Supabase PATCH on pinned Production ref sets only `external_google_enabled: false`. This stops new Google OAuth attempts, including stale cached pages. It does not revoke already issued Supabase sessions or remove Google identities; password login remains available where the account has a password. Google-only accounts lose fresh sign-in while disabled, so announce/resolve the outage rather than promise password fallback for them.
3. Set Netlify production build flag back to its captured previous value (currently false/unset), then rebuild. For fastest UI rollback, republish verified previous deploy `6aceaefdf40f0609c1192e3c` **only if it is still the appropriate baseline and no unrelated later fixes would be lost**; otherwise deploy the latest application with Google flag false. Restoring an old deploy does not restore environment variables or Supabase settings.
4. Preserve approved privacy update where possible. Keep Production client secret securely stored; no automatic deletion/rotation. If credential compromise is confirmed, perform separately approved rotation. Restore only changed Supabase fields from private snapshot if necessary; never overwrite unrelated concurrent config changes.
5. Verify provider false, button hidden in a fresh browser, password/recovery availability and unchanged Stage configuration. Log sanitized rollback evidence, not sessions/tokens/emails. No blanket logout or account cleanup without separate authorization.

## Primary references and panels

- [Google app state/publication/basic-scope exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Google brand/domain/privacy requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Supabase Google provider](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Production provider panel](https://supabase.com/dashboard/project/otbqfijerkieoxwpxjnm/auth/providers)
- [Supabase Production URL configuration](https://supabase.com/dashboard/project/otbqfijerkieoxwpxjnm/auth/url-configuration)
- [Google project selector](https://console.cloud.google.com/cloud-resource-manager)
- [Google Auth Platform](https://console.cloud.google.com/auth/overview) — select confirmed Production project, not Stage
- [Search Console ownership](https://search.google.com/search-console)
- [Netlify playkcswh](https://app.netlify.com/projects/playkcswh/configuration/env)
- [Netlify environment contexts/build scopes](https://docs.netlify.com/build/configure-builds/environment-variables/)

Prepared status: plan/security/rollback COMPLETE; Production OAuth configuration/publication/activation/deploy/E2E NOT EXECUTED, awaiting explicit GO. Google inventory/domain read awaits owner authentication only.
