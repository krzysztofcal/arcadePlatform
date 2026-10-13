# Google Login V1 — Stage setup and verification

## Target
Stage only: `krydukthwdvccggbyjfw` (arcade-portal-stage).

Draft PR: [#1101](https://github.com/krzysztofcal/arcadePlatform/pull/1101).
Preview: [account page](https://deploy-preview-1101--playkcswh.netlify.app/account.html).
Verified runtime commit: `b68f546a514b640b28f41df25b190a61cec7a1fb`; Netlify deploy `6ace83be1e611a8e9f62571f` ready on 2026-10-13. Later evidence-only commits do not change runtime. Production provider activation/deploy/merge require separate owner GO. No DB migrations or WS deploy needed.

## Current Stage configuration (2026-10-13)
Codex created a dedicated Google Cloud project `arcade-hub-stage-1100` / Arcade Hub Stage through the logged-in Google Console, after owner login and owner acceptance of Google API user-data policy. Standard Web client: Arcade Hub Stage Web; exact Stage Supabase callback and Preview JavaScript origin. Audience: External / Testing, one owner test user; only openid/userinfo.email/userinfo.profile scopes. No billing activation or Production project change.

Client JSON was downloaded directly from Google Console into a private VPS directory (0700), stored with file mode 0600, and applied through the official Supabase Stage Management API. Read-back confirms enabled Google, matching Client ID, exact Preview redirect, and Preview as Stage Site URL. No client secret is committed, logged or shared in chat. An immediate API read-back was stale; a subsequent read confirmed the save.

Real Google E2E completed on 2026-10-13 after owner consent. First successful Google sign-in linked to the existing verified password user with the same Supabase UUID; profile-me HTTP 200. Repeat Google sign-in and reload preserved UUID, profile/balance and XP display. Pre-consent versus post-login/repeat read-only snapshots show unchanged chips account hash, ledger-entry count, poker-seat/request counts and profile hash. No financial actions or gameplay were performed.

An initial callback after first consent returned a controlled generic auth error and no session. A fresh attempt succeeded, followed by another successful login and reload. The initial raw error was unavailable after callback sanitization; its cause is not established. Do not describe that first attempt as PASS or infer that configuration propagation was proven to be the cause.

Storage audit: Google provider token is present inside the existing SDK-managed Supabase session record; provider refresh token is absent. No provider-token copy found in other localStorage/sessionStorage records, application KLog or IndexedDB. Post-login audit inspected 15 application requests and found no Google provider token forwarded. No WS frames were sent on this account page, so this is not a WS protocol test. This is not a claim of zero Google-token persistence: SDK-managed persistence is deliberately retained as documented in the plan.

A completely new Google user registration still needs a second real Google identity absent from Stage; owner was asked for that specific login, without requesting secrets.

## Google Cloud setup reference
1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), select/create a dedicated Stage project.
2. [Branding](https://console.cloud.google.com/auth/branding): app name Arcade Hub Stage, owner-controlled support/developer email. Existing public [Privacy EN](https://play.kcswh.pl/legal/privacy.en.html), [Privacy PL](https://play.kcswh.pl/legal/privacy.pl.html) and [Terms EN](https://play.kcswh.pl/legal/terms.en.html) are available; review their accuracy before publishing branding. This PR does not approve/change legal copy.
3. [Audience](https://console.cloud.google.com/auth/audience): External, Testing; add owner Google account(s) as test users. No production publishing required for Stage smoke.
4. [Data Access](https://console.cloud.google.com/auth/scopes): only `openid`, `userinfo.email`, `userinfo.profile`; no Gmail/Drive/offline access.
5. [Clients](https://console.cloud.google.com/auth/clients): create OAuth Client ID → Web application → Arcade Hub Stage. Authorized JavaScript origin = `https://deploy-preview-1101--playkcswh.netlify.app`. Authorized redirect URI exactly `https://krydukthwdvccggbyjfw.supabase.co/auth/v1/callback`.
6. Copy Client ID and Client Secret **directly between dashboards** into Stage Supabase below; never put secret in chat, repository or Netlify public config.

## Supabase Stage
1. Open [Stage Google provider](https://supabase.com/dashboard/project/krydukthwdvccggbyjfw/auth/providers?provider=Google) (Authentication → Sign In / Providers → Google).
2. Enable Google, set the Web Client ID and Client Secret from above, save. Keep nonce/email verification safeguards; no manual linking needed.
3. Open [Stage URL configuration](https://supabase.com/dashboard/project/krydukthwdvccggbyjfw/auth/url-configuration). Add exact redirect `https://deploy-preview-1101--playkcswh.netlify.app/account.html`. Existing preview wildcard already permits previews; verify callback lands on the task Preview, never Production. Stage Site URL has now been changed through Management API to `https://deploy-preview-1101--playkcswh.netlify.app/account.html`, so fallback remains on Stage. This PR always sends explicit same-origin redirectTo.
4. Tell Codex Stage is configured. A real Google browser login/consent may still require owner participation; the saved Stage password account is not a Google account/browser session.

## Netlify
`AUTH_GOOGLE_ENABLED="1"` is set in `netlify.toml` **deploy-preview** build context only. Netlify integration reported a save, but read-back and deployed config disproved it; direct env API writes returned HTTP 403. Using the existing context config is deterministic and keeps secrets out of the repo. Generated `SUPABASE_CONFIG.AUTH_GOOGLE_ENABLED` defaults false elsewhere. Google secret stays in Supabase, never Netlify/client. Deploy Preview continues to use existing pinned Stage Supabase config.

## Verification
- PASS: `node --test tests/account-auth.contract.test.mjs` (9 cases); default-off, fixed origin redirect, basic scopes, provider unavailable, malicious authorize URL, callback cleanup/privacy and existing recovery replay.
- PASS: `node tests/supabase-jwt-verify.test.mjs` (existing local/remote UUID verification).
- PASS: `node --test tests/profile*.test.mjs` (7 existing profile/avatar cases).
- PASS: `npm run syntax` (226 files), `npm run check:csp-inline` (55 documents), `git diff --check`.
- PASS: `npm test` full existing runner (147 completed suites/checks, no failure markers; exit 0). An initial local attempt lacked WS dependencies; rerun with existing installed WS dependencies passed without repository dependency changes.
- PASS: `npm run ci:guards`; all PR checks settled (25 pass, 5 expected skips, 0 failures/pending) for runtime SHA.
- PASS: generated build config explicitly false without flag, true with Preview flag.
- PASS: real Preview browser checks at 1440×1000 and 390×844: pinned Stage target, visible G button, EN/PL labels, real disabled-provider settings response and retry (EN/PL messages), controlled synthetic cancellation callback and history cleanup. This checks cancellation handling, not real Google consent cancellation.
- PASS: existing Stage password account signed in through the actual Preview form, profile-me HTTP 200, session restored after reload and sign-out returned to login. No JOIN, funding, gameplay, claims or ledger mutations.
- PASS: anonymous desktop/mobile screenshots visually inspected; temporary browser tooling/state remained outside the repository and browser contexts were closed.
- PASS: real Google login via task Preview and Supabase Stage; existing verified-password email retained its pre-consent UUID, repeated Google login retained UUID/profile/balance, reload restored session and callback URL was clean. Database snapshots before/after show unchanged profile, chips account, ledger-entry count and poker-seat/request counts; XP display unchanged across first/repeat login.
- PASS: provider-token audit found no copies in application-owned localStorage/sessionStorage, KLog or IndexedDB; token is present only in the Supabase SDK record and is not a provider refresh token. No claim of zero SDK token persistence.
- NOT TESTED: completely new Google account registration (second real Google identity required); completion of a real password recovery email. Real Google consent cancellation is not tested; the controlled synthetic callback error was tested.
- Initial first-consent callback FAIL, cause unknown; subsequent fresh login/repeat/reload PASS. This is explicitly recorded rather than counted as a first-attempt success.
- NOT TESTED / unauthorized: Production.

## Rollback
Disable Preview Google visibility by changing the `netlify.toml` deploy-preview flag to `AUTH_GOOGLE_ENABLED="0"` and rebuilding; optionally disable Google provider in Stage. Existing accounts/password auth remain. Code rollback is a forward revert PR, with Production actions separately approved.

## Reference
[Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [automatic identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Google branding](https://developers.google.com/identity/branding-guidelines). PR #701 was reviewed as a reference; its three-provider/deletion scope was not imported. Existing implicit flow and SDK session persistence retained; application does not read/copy/forward provider tokens. SDK persistence audit remains pending real Google login.
