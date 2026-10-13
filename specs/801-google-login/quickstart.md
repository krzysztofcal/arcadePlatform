# Google Login V1 — Stage setup and verification

## Target
Stage only: `krydukthwdvccggbyjfw` (arcade-portal-stage). Production provider activation/deploy/merge require separate owner GO. No DB migrations or WS deploy needed.

## Google Cloud (owner dashboard access)
1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), select/create a dedicated Stage project.
2. [Branding](https://console.cloud.google.com/auth/branding): app name Arcade Hub Stage, owner-controlled support/developer email. Existing public [Privacy EN](https://play.kcswh.pl/legal/privacy.en.html), [Privacy PL](https://play.kcswh.pl/legal/privacy.pl.html) and [Terms EN](https://play.kcswh.pl/legal/terms.en.html) are available; review their accuracy before publishing branding. This PR does not approve/change legal copy.
3. [Audience](https://console.cloud.google.com/auth/audience): External, Testing; add owner Google account(s) as test users. No production publishing required for Stage smoke.
4. [Data Access](https://console.cloud.google.com/auth/scopes): only `openid`, `userinfo.email`, `userinfo.profile`; no Gmail/Drive/offline access.
5. [Clients](https://console.cloud.google.com/auth/clients): create OAuth Client ID → Web application → Arcade Hub Stage. Authorized JavaScript origin = task Preview origin (see PR). Authorized redirect URI exactly `https://krydukthwdvccggbyjfw.supabase.co/auth/v1/callback`.
6. Copy Client ID and Client Secret **directly between dashboards** into Stage Supabase below; never put secret in chat, repository or Netlify public config.

## Supabase Stage
1. Open [Stage Google provider](https://supabase.com/dashboard/project/krydukthwdvccggbyjfw/auth/providers?provider=Google) (Authentication → Sign In / Providers → Google).
2. Enable Google, set the Web Client ID and Client Secret from above, save. Keep nonce/email verification safeguards; no manual linking needed.
3. Open [Stage URL configuration](https://supabase.com/dashboard/project/krydukthwdvccggbyjfw/auth/url-configuration). Add exact task Preview `/account.html` redirect. Existing preview wildcard already permits previews; verify callback lands on the task Preview, never Production. Current Stage Site URL was `https://play.kcswh.pl`; owner should set it to task Preview `/account.html` if using a Stage fallback. This PR always sends explicit same-origin redirectTo.
4. Tell Codex Stage is configured. A real Google browser login/consent may still require owner participation; the saved Stage password account is not a Google account/browser session.

## Netlify
`AUTH_GOOGLE_ENABLED=1` set via authorized Netlify integration in **deploy-preview / builds** only. Generated `SUPABASE_CONFIG.AUTH_GOOGLE_ENABLED` defaults false elsewhere. Google secret stays in Supabase, never Netlify/client. Deploy Preview continues to use existing pinned Stage Supabase config.

## Verification
- PASS: `node --test tests/account-auth.contract.test.mjs` (8 cases); default-off, fixed origin redirect, basic scopes, provider unavailable, malicious authorize URL, callback cleanup/privacy and existing recovery replay.
- PASS: `node tests/supabase-jwt-verify.test.mjs` (existing local/remote UUID verification).
- PASS: `node --test tests/profile*.test.mjs` (7 existing profile/avatar cases).
- PASS: `npm run syntax` (226 files), `npm run check:csp-inline` (55 documents), `git diff --check`.
- Pending Preview: desktop/mobile PL/EN, real disabled-provider error/retry, callback cancellation and Stage password/profile/sign-out.
- NOT TESTED: real Google new/repeat login, verified-email UUID continuity and unchanged XP/CH/Poker history, real Google SDK/provider-token storage audit, live recovery email completion. Google provider currently disabled/unconfigured; owner configuration pending.
- NOT TESTED / unauthorized: Production.

## Rollback
Disable Preview Google visibility with context-scoped `AUTH_GOOGLE_ENABLED=0` and rebuild; optionally disable Google provider in Stage. Existing accounts/password auth remain. Code rollback is a forward revert PR, with Production actions separately approved.

## Reference
[Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [automatic identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Google branding](https://developers.google.com/identity/branding-guidelines). PR #701 was reviewed as a reference; its three-provider/deletion scope was not imported. Existing implicit flow and SDK session persistence retained; application does not read/copy/forward provider tokens. SDK persistence audit remains pending real Google login.
