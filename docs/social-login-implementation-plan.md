# Google, Facebook, and GitHub login

Status: implementation plan. This document does not enable an OAuth provider, add a secret, change runtime code, or migrate data.

## Objective

Add "Continue with Google", "Continue with Facebook", and "Continue with GitHub" to the existing Arcade Hub account experience through Supabase Auth. A first successful provider login creates the same Arcade Hub account, public profile, XP/chips identity, and poker identity as email/password signup. Returning users receive the same Supabase session contract regardless of how they authenticate.

The first release is authentication only. It does not import provider avatars, call provider APIs after login, store provider access tokens, or add manual identity-linking controls.

## Confirmed current state

- `account.html` contains separate email/password sign-in and signup cards, shared status feedback, password reset/recovery, and the authenticated profile panel.
- `js/account-page.js` owns the account-page state, form handlers, PL/EN feedback, and authenticated/anonymous panel switching.
- `js/auth/supabaseClient.js` creates one browser Supabase client and exposes `signIn`, `signUp`, session hydration, password recovery, and sign-out through `window.SupabaseAuth`. It does not expose `signInWithOAuth` today.
- `scripts/generate-build-info.js` generates `js/auth/supabase-config.js` from the context-specific public Supabase URL and anon key. Deploy previews already use the stage Supabase project.
- Authenticated backend and WS identity is the verified Supabase JWT `sub`/user UUID, not an email address or provider name. XP, chips, favorites, profiles, and poker therefore need no provider-specific identity path.
- Migration `supabase/migrations/20260713090000_user_profile_provisioning_visibility.sql` creates a `public.user_profiles` row after every `auth.users` insert. OAuth-created users receive the same generated public identity without reading email, real name, or provider metadata.
- `public.user_profiles` remains the canonical presentation identity. Provider names and photos are not automatically made public.
- The current browser client uses Supabase's client-only URL session handling. Moving every auth path to PKCE would also change email confirmation and password-recovery semantics, so that migration is not bundled into the first social-login release.
- The effective CSP already allows connections to the configured Supabase host. Full-page OAuth redirects do not require Google, Facebook, or GitHub in `connect-src`, `frame-src`, or `img-src`.

No `arcadePlatform-repomix*.txt` snapshot exists in the current checkout, so this plan was prepared from the tracked source files above.

## Product and architecture decisions

1. Supabase Auth is the only application-facing OAuth broker. Arcade Hub does not implement provider authorization-code exchange itself.
2. The browser calls `supabase.auth.signInWithOAuth()` with a strict provider allowlist: `google`, `facebook`, or `github`.
3. Use a top-level browser redirect, not a popup, embedded WebView, iframe, Google One Tap, or provider SDK. This keeps all three providers on one predictable flow and avoids new third-party scripts.
4. The initial release retains the existing client-only Supabase session flow. OAuth returns to the same-origin `/account.html`; Supabase processes the returned URL fragment before normal session hydration. Tokens in the fragment are not sent in the HTTP request to Netlify.
5. Do not request offline access or provider API access. Do not persist `provider_token` or `provider_refresh_token`. Application APIs continue to receive only the Supabase access token.
6. Keep email/password sign-in, signup, confirmation, reset, and recovery unchanged.
7. Use "Continue with ..." for all provider buttons because the same action signs in an existing identity or creates a new account.
8. Provider metadata is private Auth data. The public profile continues to start with the generated Arcade Hub display name and avatar.
9. Supabase automatic identity linking may attach an OAuth identity to an existing account when the provider returns the same verified email. Manual `linkIdentity()` UI is out of scope until recovery, unlinking, and account-takeover policy is approved.
10. A provider returning a genuinely different email creates a distinct Supabase user and distinct Arcade Hub profile. The UI must not imply that accounts were merged.
11. Stage and production use separate provider applications/credentials. GitHub requires this because an OAuth App has one callback URL; the same separation is also the safer operational boundary for Google and Facebook.
12. Provider activation has two gates: the provider must be enabled in the target Supabase project, and the browser button must be included in a build-time public allowlist. Neither gate is a substitute for the other.

## User flow

```text
account.html
  -> user selects an enabled provider
  -> Arcade Hub records a validated same-origin return path in sessionStorage
  -> Supabase Auth authorize endpoint
  -> provider consent/login page
  -> https://<target-project-ref>.supabase.co/auth/v1/callback
  -> allowed current-origin /account.html
  -> Supabase client establishes the session
  -> account page renders the existing authenticated profile
  -> optional validated return path is consumed with location.replace()
```

The provider callback URI configured at Google, Facebook, or GitHub is the Supabase callback shown in that target project's Auth provider settings. The application `redirectTo` is a separate URL: the current origin's `/account.html`, which must be present in the target Supabase project's redirect allowlist.

### Safe return path

Add `normalizeAuthReturnPath(value)` in `js/auth/supabaseClient.js`:

- accept only a same-origin path beginning with one `/`;
- reject schemes, hosts, protocol-relative `//`, backslashes, control characters, credentials, and an auth-loop target;
- default to `/account.html#accountPanel`;
- store only the normalized path in `sessionStorage` immediately before redirect;
- consume and delete it only after a confirmed `SIGNED_IN` session;
- use `location.replace()` so the OAuth callback URL is removed from browser history.

The account page may accept `?next=<encoded relative path>` from existing sign-in links, but the same normalizer must run before storage or navigation. No absolute return URL is supported.

## Account UI

### Layout and copy

Update `account.html` inside `#authForms`:

- add a social-login panel before the email/password cards;
- render one equal-width button per enabled provider;
- use localized `Continue with Google`, `Continue with Facebook`, and `Continue with GitHub` labels;
- add an accessible divider, "or continue with email";
- keep the provider group hidden when the public allowlist is empty;
- stack buttons on narrow screens and preserve a logical keyboard order;
- include adjacent localized links to the existing Terms and Privacy pages plus concise copy that first login creates an Arcade Hub account and public profile.

Use native `<button type="button">` controls with visible focus, sufficient contrast, an accessible name, and local reviewed SVG assets. Google must use a current approved multicolor G asset and button treatment consistent with Google's branding rules. Facebook and GitHub marks must follow their current usage policies. Do not download icons at runtime.

### States

Update `js/account-page.js` with `handleOAuthSignIn(event)` and shared rendering helpers:

- idle: all configured providers are enabled;
- redirecting: selected button shows progress and all provider buttons are disabled to prevent double submission;
- provider unavailable or client not ready: show a localized non-destructive error and restore controls;
- user cancellation/access denial: return to the anonymous forms with a friendly localized message;
- successful session: reuse `renderUser()`, `loadChips()`, `refreshWelcomeBonus()`, and public-profile hydration;
- stale callback or missing session: show "Sign-in was not completed" rather than a raw provider error;
- signed-in state: the social and email forms remain hidden as they are today.

Never put provider error descriptions directly into HTML. Map known Supabase error codes to controlled PL/EN strings and use a generic fallback.

### Account identity presentation

The authenticated panel may show a localized "Signed in with Google/Facebook/GitHub" hint derived from the current user's allowlisted identity provider metadata. It must still use `public.user_profiles.display_name` for the public identity and `user.email` only in the private account section. If a provider supplies no usable email, show a neutral localized value instead of `Unknown email`.

## Public build configuration and rollback gate

Extend `scripts/generate-build-info.js::pickSupabasePublicConfig()` and `generateSupabaseConfig()` with the non-secret environment variable:

```text
AUTH_OAUTH_PROVIDERS=google,facebook,github
```

The generated `window.SUPABASE_CONFIG.OAUTH_PROVIDERS` must be a deduplicated array intersected with the hardcoded provider allowlist. Unknown or malformed values are dropped. The checked-in `js/auth/supabase-config.js` default is an empty array, so local/static builds do not display unusable buttons accidentally.

Rules:

- set the variable separately for Netlify `deploy-preview` and `production` contexts;
- enable a button only after that provider works in the matching Supabase project;
- disabling the list hides entry points but is not an authorization control;
- disabling the provider in Supabase is the authoritative emergency stop;
- client IDs and client secrets are never emitted by the build script.

## Delivery plan

### Phase 1 — shared OAuth client contract

Files and methods:

- Update `js/auth/supabaseClient.js`:
  - add `OAUTH_PROVIDERS` and `isOAuthProviderEnabled(provider)`;
  - add `normalizeAuthReturnPath(value)`;
  - add `signInWithProvider(provider, returnPath)` around `client.auth.signInWithOAuth()`;
  - build `redirectTo` only from the validated current HTTP(S) origin plus `/account.html`;
  - expose the three methods through `window.SupabaseAuth`;
  - never log URLs, URL fragments, authorization data, tokens, email addresses, or raw provider payloads.
- Update `scripts/generate-build-info.js` and the checked-in `js/auth/supabase-config.js` with the public provider array.
- Extend existing auth contract coverage in `tests/account-auth.contract.test.mjs` only for security-critical provider allowlisting, same-origin redirect construction, and open-redirect rejection.

Acceptance:

- an unknown provider cannot reach `signInWithOAuth()`;
- the redirect target cannot leave the current origin;
- no provider token is stored or forwarded by Arcade Hub code;
- existing email/password and recovery contracts remain unchanged;
- an empty provider config retains today's UI and behavior.

### Phase 2 — account UI and callback feedback

Files and methods:

- Update `account.html` with the provider group, divider, legal notice, local icons, and responsive styles using the existing account-card design.
- Update `js/account-page.js`:
  - capture `[data-oauth-provider]` buttons in `selectNodes()`;
  - add `renderOAuthProviders()` and `setOAuthBusy(provider)`;
  - add `handleOAuthSignIn(event)`;
  - map callback cancellation/failure without rendering raw query-fragment text;
  - consume the validated return path after `SIGNED_IN`;
  - continue using existing authenticated rendering after success.
- Update `js/i18n.js` with complete English and Polish copy for labels, progress, cancellation, generic failure, legal notice, divider, provider hint, and missing-email fallback.
- Add approved provider SVG assets below the existing local asset tree and record provenance/license requirements in the existing third-party documentation if required by the provider's terms.

Acceptance and manual UI validation:

1. Keyboard-only and screen-reader navigation exposes each provider once with an accurate accessible name.
2. Desktop and narrow mobile layouts have no overflow, clipped labels, or layout shift when buttons enter the busy state.
3. Double-clicking cannot start two OAuth attempts.
4. Cancellation returns to a usable email/social login page.
5. A successful login shows the existing profile, XP, chips, favorites, and poker identity for the Supabase user UUID.
6. Email signup, confirmation, sign-in, password reset, password recovery, and sign-out still work.
7. Browser history does not retain a usable OAuth token fragment after session hydration and return-path replacement.

Per the project testing policy, do not add CSS, DOM-rendering, or Playwright tests solely for this UI. Update existing static contract expectations only when necessary; validate visual and provider behavior manually on the deploy preview.

### Phase 3 — stage provider setup and end-to-end verification

This phase is primarily owner-controlled configuration; Codex can verify public results but cannot create or approve external provider applications without the owner's accounts and authority.

Configure the stage Supabase project first:

- `SITE_URL`: the canonical non-production URL selected for stage auth operations;
- additional redirect URL for local development if used;
- Netlify preview pattern scoped to this site, for example `https://**--playkcswh.netlify.app/account.html` rather than a wildcard covering all Netlify sites;
- exact stage Supabase callback from Authentication -> Providers in each provider application;
- stage-only client ID and secret in each Supabase provider panel;
- Netlify deploy-preview `AUTH_OAUTH_PROVIDERS` only after provider configuration succeeds.

Run the full stage matrix for each provider:

1. first login with a new provider email;
2. repeat login to the same user UUID;
3. existing email/password account plus provider with the same verified email;
4. provider denial/cancel;
5. missing/unavailable email where the provider permits it;
6. sign-out then sign-in again;
7. preview URL, local URL if configured, desktop, and mobile browser;
8. verify a generated `user_profiles` row exists immediately after first login;
9. verify welcome bonus cannot be claimed twice and existing XP/chips/favorites remain attached to the expected UUID;
10. verify no provider image URL or provider token appears in profile, poker payloads, logs, local application records, or network calls after authentication.

### Phase 4 — production release

- Create/use production provider applications and configure the production Supabase project with its own credentials.
- Set production Supabase `SITE_URL` to `https://play.kcswh.pl` and add the exact `https://play.kcswh.pl/account.html` redirect URL. Do not use a broad production wildcard.
- Complete Google publishing/verification requirements and branding review.
- Complete Facebook required app details, email/public-profile permission setup, Live mode/review as applicable, privacy policy, Terms, and user-data-deletion instructions/callback.
- Configure a production GitHub OAuth App with the production Supabase callback and keep Device Flow disabled.
- Publish approved PL/EN Terms and Privacy changes before enabling buttons.
- Enable one provider at a time in Supabase, then in production `AUTH_OAUTH_PROVIDERS`; smoke test and monitor before enabling the next.
- Roll back a provider by removing it from the public list and disabling it in the target Supabase project. Do not delete users, identities, public profiles, XP, chips, or poker data during rollback.

## Provider-specific owner checklist

### Google

- Create a Web OAuth client in Google Auth Platform for stage and another for production.
- Configure the audience/consent screen, support contact, authorized domains, homepage, Privacy Policy, and Terms links.
- Add the exact target Supabase callback URI as an authorized redirect URI and the appropriate application origin as an authorized JavaScript origin if Google requires it for the chosen client configuration.
- Store Client ID and Client Secret only in the matching Supabase project.
- Use only the basic authentication identity scopes supplied by Supabase. Do not request Drive, YouTube, contacts, offline access, or forced consent.
- Approve the final Google button against current branding requirements.

### Facebook

- Create a stage/test Meta app and a separate production app or approved production test-app arrangement.
- Add Facebook Login, configure the exact target Supabase callback under Valid OAuth Redirect URIs, and enable only `public_profile` plus `email` required by Supabase.
- Complete app icon, domain, contact, Privacy Policy, Terms if applicable, and data-deletion URL/instructions.
- Keep stage in Development mode with explicit testers; move production to Live only after required review/readiness is complete.
- Store App ID and App Secret only in the matching Supabase project.

### GitHub

- Create separate stage and production OAuth Apps because a GitHub OAuth App supports one callback URL.
- Set Homepage URL to the matching Arcade Hub environment and Authorization callback URL to that environment's Supabase callback.
- Keep Device Flow disabled.
- Request no repository, organization, gist, workflow, or write scopes. Use only the minimal identity/email access required by Supabase.
- Store Client ID and Client Secret only in the matching Supabase project.

## Identity linking and account safety

Supabase automatically links identities that present the same verified email. The implementation must not reproduce this logic in browser code or merge rows by email in the database.

Before production, the owner must approve these user-facing rules:

- same verified email may resolve to the existing Supabase UUID through Supabase automatic linking;
- a different provider email creates a separate account, profile, XP, and chips identity;
- manual linking/unlinking is unavailable in the first release;
- support must have a documented process for duplicate-account and lost-provider cases without moving ledger data manually or accepting email alone as proof of ownership;
- deleting an Arcade Hub account must cover its Supabase identities and meet Google/Meta/GitHub disclosure and deletion obligations.

If manual linking is later required, it needs a separate plan covering recent reauthentication, provider collision handling, at-least-one-login-method enforcement, unlink rollback, audit events, and recovery.

## Provider avatars are out of scope

OAuth metadata may contain a name or image URL, but the first release must ignore both when creating the public profile. The database trigger already creates a generated Arcade Hub identity for every new Auth user.

A later avatar-import feature may copy a provider image only after explicit product/privacy approval. It must download server-side with provider host allowlists, redirect and private-network/SSRF protection, byte and image-dimension limits, conversion through the existing WebP pipeline, provenance and unlink/delete policy, and explicit user choice. Provider images must never be hotlinked into profile or poker UI. This preserves the existing CSP and poker contract.

## Security, privacy, and observability

- Keep provider secrets exclusively in Supabase provider configuration. They are not Netlify variables, browser config, source files, build logs, or GitHub secrets for this frontend flow.
- Treat `SUPABASE_ANON_KEY` as the existing public client credential; do not confuse it with provider secrets.
- Let Supabase generate and validate OAuth state. Do not invent an Arcade Hub state/token protocol.
- Use exact production redirects and a site-scoped Netlify glob only on the stage project.
- Request the minimum identity scopes; provider API access is not part of login.
- Do not retain or refresh provider tokens.
- Log only an allowlisted provider name and aggregate status such as `started`, `returned`, `cancelled`, or `failed`. Never log user ID, email, provider subject, authorization code, state, URL fragment, access/refresh token, or raw provider response.
- Use existing `KLog`/`klog` integration; never add `console.log`.
- Update PL/EN Privacy and Terms to identify social-login providers, categories/purpose of data, Supabase processing, retention/deletion, and support contact. Legal basis and final wording are owner/legal decisions.
- CSP should not gain provider domains for the planned full-page redirect. If implementation adds a provider SDK, iframe, hotlinked icon, or inline script, stop and revise the plan and CSP review instead of silently broadening the policy.

## Codex versus owner responsibilities

| Work item | Codex can implement | Owner must do/approve |
| --- | --- | --- |
| Auth wrapper | Provider allowlist, safe redirect, return-path handling, controlled errors, no-token logging | Approve client-only flow for first release and any later PKCE migration scope |
| Account UI | Buttons, responsive/accessibility states, PL/EN strings, legal links, local assets | Approve copy, provider order, screenshots, and brand compliance |
| Public build config | Parse `AUTH_OAUTH_PROVIDERS`, hide disabled buttons, document contexts | Set deploy-preview/production values after external setup |
| Google | Integrate configured provider and verify callback behavior | Own Cloud project/client, consent screen, domain verification, credentials, publishing/verification |
| Facebook | Integrate configured provider and verify callback behavior | Own Meta app/testers, permissions, app review/Live mode, credentials, privacy/data deletion setup |
| GitHub | Integrate configured provider and verify callback behavior | Own stage/prod OAuth Apps, credentials, homepage/callback configuration |
| Supabase | Verify generated profile and existing JWT consumers, document exact settings | Enable providers, enter secrets, set Site URL and redirect allowlists in stage/prod dashboards |
| Legal/privacy | Wire approved links and copy into UI | Approve/publish PL/EN Terms, Privacy, deletion process, and provider disclosures |
| Testing | Run repository checks and guide/inspect deploy-preview smoke results | Use real provider accounts, approve external consent screens, execute final production smoke |
| Rollout | Prepare flags, diagnostics, and rollback instructions | Decide provider order, enable production, monitor support/security impact |

Codex must stop and ask for owner action when external credentials, domain/app verification, provider review, legal approval, or production enablement is required. Those steps cannot be safely inferred or automated from this repository.

## Test and verification contract

Automated work follows the project policy:

- extend `tests/account-auth.contract.test.mjs` only for critical provider allowlisting and redirect/open-redirect behavior;
- update existing static/build-config expectations for the new public provider array;
- do not introduce a new UI test framework or tests for CSS/layout/simple DOM glue;
- run the existing syntax and repository test commands before merge.

Manual stage verification is mandatory because provider dashboards, real consent screens, redirects, and account-linking outcomes cannot be proven by repository tests. Record for each provider: target Supabase project ref, provider app environment, preview URL, resulting Supabase user UUID comparison (same/different only, not the UUID value in logs), profile creation result, and pass/fail timestamp.

This change does not touch `ws-server/**`, `shared/**` WS runtime dependencies, or the browser/WS protocol. `WS Preview Deploy` is therefore not required for this social-login implementation unless the eventual code scope expands into one of those areas.

## Breaking and operational impact

| Area | Expected impact |
| --- | --- |
| Browser auth API | Additive `signInWithProvider()` and provider/config helpers. Existing email/password methods remain. |
| Auth accounts | First provider login may insert `auth.users`; same verified email may be automatically linked by Supabase. |
| Public profiles | Existing trigger creates one generated profile for a newly inserted Auth user. No provider metadata is published. |
| XP/chips/favorites/poker | No contract change; all continue to use the Supabase UUID/JWT `sub`. |
| Database | No migration planned. Stage must already contain the automatic profile-provisioning migration. |
| Secrets | Three provider credential pairs per environment are owner-managed in Supabase, not the repository or Netlify. |
| Public ENV | Add non-secret `AUTH_OAUTH_PROVIDERS` separately per Netlify context. |
| CSP | No change planned. Full-page navigation and existing Supabase connection policy are sufficient. |
| WS | No change and no WS preview deployment. |
| Legal/support | Terms, Privacy, deletion, duplicate-account, and lost-provider procedures require owner approval before production. |

The additive browser API is non-breaking. The material product risk is identity linking/account duplication, not code compatibility. Do not make existing synchronous account UI methods asynchronous beyond the already promise-based submit handlers without updating every caller.

## Definition of done

- Enabled Google, Facebook, and GitHub buttons complete login through the matching stage and production Supabase projects.
- Disabled/unconfigured providers are not shown and cannot be invoked through the wrapper.
- Email/password signup, confirmation, sign-in, reset, recovery, and sign-out remain operational.
- A first OAuth login creates a generated Arcade Hub public profile and uses the same UUID-based XP, chips, favorites, and poker paths.
- Same-email linking and different-email separation match the approved product policy and are verified on stage.
- OAuth cancellation and errors produce controlled PL/EN feedback without raw provider text or token leakage.
- Redirects are current-origin only; production uses exact URLs and stage preview wildcards are site-scoped.
- Provider scopes are minimal, provider tokens are not stored, and no provider avatar is hotlinked or published.
- Google/Meta/GitHub branding, app configuration, legal disclosures, and data-deletion requirements are owner-approved before production.
- Rollout can be stopped per provider using the public UI list plus the authoritative Supabase provider switch.
- No database migration, WS protocol change, WS deploy, new provider CSP domain, or provider secret in repository/Netlify is introduced.

## Official references

- [Supabase social login](https://supabase.com/docs/guides/auth/social-login)
- [Supabase `signInWithOAuth`](https://supabase.com/docs/reference/javascript/auth-signinwithoauth)
- [Supabase redirect URLs and Netlify preview patterns](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Facebook login](https://supabase.com/docs/guides/auth/social-login/auth-facebook)
- [Supabase GitHub login](https://supabase.com/docs/guides/auth/social-login/auth-github)
- [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Supabase implicit flow](https://supabase.com/docs/guides/auth/sessions/implicit-flow)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google sign-in branding](https://developers.google.com/identity/branding-guidelines)
- [GitHub OAuth App creation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [GitHub OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
