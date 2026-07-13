# Google, Facebook, and GitHub login

Status: implementation plan. This document does not enable an OAuth provider, add a secret, change runtime code, or migrate data.

## Objective

Add "Continue with Google", "Continue with Facebook", and "Continue with GitHub" to the existing Arcade Hub account experience through Supabase Auth. A first successful provider login creates the same Arcade Hub account, public profile, XP/chips identity, and poker identity as email/password signup. Returning users receive the same Supabase session contract regardless of how they authenticate.

The first release adds social authentication and a safe self-service Arcade Hub account-deletion workflow. It does not import provider avatars, call provider APIs after login, read or persist provider access tokens in Arcade Hub-owned state, or add manual identity-linking controls. Supabase SDK-managed session persistence is treated separately in the provider-token contract below. No production OAuth provider may be enabled until account deletion and the public/support fallback are operational.

## Confirmed current state

- `account.html` contains separate email/password sign-in and signup cards, shared status feedback, password reset/recovery, and the authenticated profile panel.
- `js/account-page.js` owns the account-page state, form handlers, PL/EN feedback, and authenticated/anonymous panel switching.
- `js/auth/supabaseClient.js` creates one browser Supabase client and exposes `signIn`, `signUp`, session hydration, password recovery, and sign-out through `window.SupabaseAuth`. It does not expose `signInWithOAuth` today.
- `scripts/generate-build-info.js` generates `js/auth/supabase-config.js` from the context-specific public Supabase URL and anon key. Deploy previews already use the stage Supabase project.
- Authenticated backend and WS identity is the verified Supabase JWT `sub`/user UUID, not an email address or provider name. XP, chips, favorites, profiles, and poker therefore need no provider-specific identity path.
- Migration `supabase/migrations/20260713090000_user_profile_provisioning_visibility.sql` creates a `public.user_profiles` row after every `auth.users` insert. OAuth-created users receive the same generated public identity without reading email, real name, or provider metadata.
- `public.user_profiles` remains the canonical presentation identity. Provider names and photos are not automatically made public.
- The current browser client uses Supabase's client-only URL session handling. Moving every auth path to PKCE would also change email confirmation and password-recovery semantics, so that migration is not bundled into the first social-login release.
- `js/auth/supabaseClient.js::getCurrentUser()` and `attachAuthSubscription()` currently emit `userId`, `emailDomain`, and `sessionExpiresAt`. That high-cardinality telemetry conflicts with the privacy contract for this rollout and must be removed before OAuth is enabled.
- The browser client currently uses Supabase's default persisted-session storage. Supabase may include `provider_token` or `provider_refresh_token` inside its internally managed serialized session after OAuth even when Arcade Hub never reads those fields.
- `legal/privacy.pl.html`, `legal/privacy.en.html`, `legal/terms.pl.html`, and `legal/terms.en.html` already direct account-deletion requests to `contact@kcswh.pl`, and the account page exposes the same manual-support path. They do not yet disclose Google/Meta/GitHub social-login processing or provide a dedicated stable Meta deletion-instructions URL.
- The effective CSP already allows connections to the configured Supabase host. Full-page OAuth redirects do not require Google, Facebook, or GitHub in `connect-src`, `frame-src`, or `img-src`.

No `arcadePlatform-repomix*.txt` snapshot exists in the current checkout, so this plan was prepared from the tracked source files above.

## Product and architecture decisions

1. Supabase Auth is the only application-facing OAuth broker. Arcade Hub does not implement provider authorization-code exchange itself.
2. The browser calls `supabase.auth.signInWithOAuth()` with a strict provider allowlist: `google`, `facebook`, or `github`.
3. Use a top-level browser redirect, not a popup, embedded WebView, iframe, Google One Tap, or provider SDK. This keeps all three providers on one predictable flow and avoids new third-party scripts.
4. The initial release retains the existing client-only Supabase session flow. OAuth returns to the same-origin `/account.html`; Supabase processes the returned URL fragment before normal session hydration. Tokens in the fragment are not sent in the HTTP request to Netlify.
5. Do not request offline access or provider API access. Arcade Hub code must not read, copy, log, transmit, refresh, or persist `provider_token` or `provider_refresh_token` separately. Application APIs continue to receive only the Supabase access token. The initial recommendation permits those provider fields only if Supabase JS itself places them inside its existing SDK-managed session record; this exception requires the storage audit and owner decision defined below.
6. Keep email/password sign-in, signup, confirmation, reset, and recovery unchanged.
7. Use "Continue with ..." for all provider buttons because the same action signs in an existing identity or creates a new account.
8. Provider metadata is private Auth data. The public profile continues to start with the generated Arcade Hub display name and avatar.
9. Supabase automatic identity linking may attach an OAuth identity to an existing account when the provider returns the same verified email. Manual `linkIdentity()` UI is out of scope until recovery, unlinking, and account-takeover policy is approved.
10. A provider returning a genuinely different email creates a distinct Supabase user and distinct Arcade Hub profile. The UI must not imply that accounts were merged.
11. Stage and production use separate provider applications/credentials. GitHub requires this because an OAuth App has one callback URL; the same separation is also the safer operational boundary for Google and Facebook.
12. Provider activation has two gates: the provider must be enabled in the target Supabase project, and the browser button must be included in a build-time public allowlist. Neither gate is a substitute for the other.
13. Provider order is fixed as Google, Facebook, GitHub. `AUTH_OAUTH_PROVIDERS` selects a subset but cannot reorder the UI.
14. The first release does not show "Signed in with Google/Facebook/GitHub". `user.identities` describes linked identities and `app_metadata.provider` may describe account creation/default metadata; neither reliably proves the provider used for the current session.
15. Self-service account deletion is part of the delivery plan and is a production OAuth prerequisite. It is not implemented by calling `auth.admin.deleteUser()` directly: Arcade Hub must first settle or block active poker/chips state, delete or anonymize application data according to the approved retention policy, remove Storage and XP data, and delete the Supabase Auth user and all linked identities last.
16. The public deletion-instructions page and verified support procedure remain available as a fallback for users who cannot sign in or complete self-service deletion. They do not replace the in-app workflow.

## User flow

```text
account.html
  -> user selects an enabled provider
  -> Arcade Hub records a bounded pending OAuth state in sessionStorage
  -> Supabase Auth authorize endpoint
  -> provider consent/login page
  -> https://<target-project-ref>.supabase.co/auth/v1/callback
  -> allowed current-origin /account.html
  -> Supabase client establishes the session
  -> account page renders the existing authenticated profile
  -> only the matching, fresh OAuth callback may consume its validated return path
```

The provider callback URI configured at Google, Facebook, or GitHub is the Supabase callback shown in that target project's Auth provider settings. The application `redirectTo` is a separate URL: the current origin's `/account.html`, which must be present in the target Supabase project's redirect allowlist.

### Pending OAuth state and safe return path

Add a versioned `sessionStorage` record owned by `js/auth/supabaseClient.js`, for example under `arcade:oauth:pending:v1`, with the closed schema:

```text
{ provider, returnPath, startedAt }
```

- `provider` must be one of the enabled hardcoded providers;
- `returnPath` must already be the output of `normalizeAuthReturnPath(value)`;
- `startedAt` is an integer epoch timestamp;
- use `OAUTH_PENDING_TTL_MS = 10 * 60 * 1000`; missing, malformed, future-dated, or expired records are deleted and ignored;
- write the record immediately before `signInWithOAuth()` and remove it if redirect startup rejects;
- remove it after matching callback success, provider denial/cancellation, callback failure, or stale-state detection;
- a password sign-in, email confirmation, password recovery, normal page refresh, or restoration of an older Supabase session must not consume it;
- a callback cannot consume a record whose provider is unknown or disabled;
- provider-page abandonment through browser Back has no reliable callback signal, so it is cleaned by TTL on the next auth-page read; callback-based denial/cancellation is cleaned immediately.

Add `normalizeAuthReturnPath(value)` in `js/auth/supabaseClient.js`. It accepts only a same-origin path beginning with exactly one `/`, performs validation on the raw and once-decoded form, and rejects schemes, credentials, protocol-relative forms, backslashes, controls, leading encoded slash/backslash sequences, and `/account.html` loop targets. Its canonical fallback is `/account.html#accountPanel`.

Required examples:

| Input | Result |
| --- | --- |
| `/poker/` | `/poker/` |
| `//evil.example` | `/account.html#accountPanel` |
| `https://evil.example` | `/account.html#accountPanel` |
| `/\evil.example` | `/account.html#accountPanel` |
| `/%2f%2fevil.example` | `/account.html#accountPanel` |
| `/account.html`, `/account.html?next=/poker/`, or `/account.html#accountPanel` | `/account.html#accountPanel` |

When the normalized result is the canonical account fallback, callback cleanup must not trigger another navigation to the same account page. Clean the callback URL with `history.replaceState()` after Supabase has hydrated it. Use `location.replace()` only for a distinct accepted return path. The account page may accept `?next=<encoded relative path>`, but it must pass through this normalizer before state is written. No absolute return URL is supported.

Add `readOAuthCallbackResult()` in `js/auth/supabaseClient.js` as the only callback interpreter:

- capture only the presence of a Supabase OAuth success marker before client initialization; never copy token values;
- run final classification only after Supabase session hydration, so URL cleanup cannot remove a fragment before the SDK consumes it;
- inspect only allowlisted `error`/`error_code` keys and a closed code allowlist for cancellation or generic failure; unknown codes collapse to generic failure and are neither returned nor logged;
- initially map only `access_denied` (and provider-normalized `user_cancelled`, if observed in the pinned Supabase flow) to `cancelled`; map `server_error`, `temporarily_unavailable`, `bad_oauth_callback`, and `unexpected_failure` to the generic `failed` message; any other value receives the same generic `failed` status without preserving the value;
- never read or return raw `error_description`, authorization code, state, token, or full callback URL;
- validate the pending provider and TTL, clean query/hash through `history.replaceState()`, and clear pending state on callback error;
- return a controlled result such as `none`, `success`, `cancelled`, `failed`, or `stale`, plus only an allowlisted provider, localized message key, and validated return path when applicable;
- return `none` for password login and an ordinary restored session, even if `onAuthStateChange` emits `SIGNED_IN` or `INITIAL_SESSION`.

`js/account-page.js` consumes this controlled result and renders the corresponding localized message. It does not parse callback parameters or provider payloads itself.

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
- user cancellation/access denial: render the controlled result from `readOAuthCallbackResult()` and return to usable anonymous forms;
- successful session: reuse `renderUser()`, `loadChips()`, `refreshWelcomeBonus()`, and public-profile hydration;
- stale callback or missing session: show "Sign-in was not completed" rather than a raw provider error;
- signed-in state: the social and email forms remain hidden as they are today.

Never put provider error descriptions directly into HTML. `account-page.js` renders only the message key returned by `readOAuthCallbackResult()`; it does not parse query/hash data or map raw provider text.

### Account identity presentation

Do not add a "Signed in with Google/Facebook/GitHub" hint in the first release. No currently selected field has been accepted as a trustworthy current-session provider signal. The authenticated panel continues to use `public.user_profiles.display_name` for public identity and `user.email` only in the private account section. If a provider supplies no usable email, show a neutral localized value instead of `Unknown email`.

## Public build configuration and rollback gate

Extend `scripts/generate-build-info.js::pickSupabasePublicConfig()` and `generateSupabaseConfig()` with the non-secret environment variable:

```text
AUTH_OAUTH_PROVIDERS=google,facebook,github
```

The generated `window.SUPABASE_CONFIG.OAUTH_PROVIDERS` must be a deduplicated array intersected with `OAUTH_PROVIDER_ORDER = ["google", "facebook", "github"]` and emitted in that fixed order. Unknown or malformed values are dropped. The checked-in `js/auth/supabase-config.js` default is an empty array, so local/static builds do not display unusable buttons accidentally.

Rules:

- create separately scoped Netlify values for `deploy-preview` and `production`; do not use an unscoped/site-wide value and do not let deploy previews inherit the production provider list;
- an absent deploy-preview value means an empty list, even when production has providers enabled;
- inspect the generated `js/auth/supabase-config.js` on both contexts and confirm each contains only its intended subset before provider smoke testing;
- enable a button only after that provider works in the matching Supabase project;
- disabling the list hides entry points but is not an authorization control;
- disabling the provider in Supabase is the authoritative emergency stop;
- client IDs and client secrets are never emitted by the build script.

## Legal & Compliance Prerequisites

These are owner/legal production-readiness gates, not OAuth runtime tasks. Stage engineering may proceed with approved test accounts, but no provider button may be enabled in production until every applicable item is complete and publicly verifiable.

### Public legal documents

The owner must approve, publish, and date both language versions before production activation:

- `legal/privacy.pl.html` and `legal/privacy.en.html` must identify Google, Meta/Facebook, GitHub, and Supabase as applicable authentication participants/processors; describe the categories and purpose of social-login data, account/profile creation, identity linking, retention, international transfers, and deletion-request route;
- `legal/terms.pl.html` and `legal/terms.en.html` must be reviewed and updated wherever their current account/login wording would inaccurately imply email/password is the only login method;
- the homepage, Privacy Policy, Terms, contact details, and deletion instructions must be reachable over HTTPS without login, provider authentication, cookies consent, or application-only navigation state;
- links must be stable, production URLs on a verified owner-controlled domain and must return successful public responses before they are entered into provider dashboards;
- final legal basis, processor/controller characterization, retention exceptions, response commitments, and wording remain owner/legal decisions; Codex must not invent or approve them.

### Account and data deletion readiness

The first production OAuth release requires both a working self-service deletion flow and a manual support fallback.

This is an Arcade Hub production-readiness decision that is stricter than the providers' common minimum. Meta requires an effective way for users to request deletion and documented instructions or the applicable callback; Google's published OAuth readiness checklist requires public privacy/contact information but does not itself mandate an in-app delete button. The implementation below is included because the owner wants a complete first-party deletion experience, not because the UI control alone is a universal Google/Meta protocol requirement.

- Publish a stable public page such as `https://play.kcswh.pl/account-deletion.html`, with PL/EN instructions for starting an Arcade Hub account/data deletion request through `contact@kcswh.pl` or another owner-approved privacy address.
- The public instructions may ask for the account email and public profile handle/identifier to locate the account, but must state that support will verify account ownership before deletion. Possession of an email address or public identifier alone is not sufficient authorization.
- Document an owner-controlled internal support runbook covering request intake, identity verification, acknowledgement, applicable response target, deletion or legally required retention across Supabase Auth identities/session data, `user_profiles`, XP, chips/ledger, favorites, poker/account data, logs, and backups, plus completion/refusal communication.
- Confirm that the manual procedure can actually be executed with current administrative access before production rollout; a published mailbox without an actionable runbook is not sufficient.
- Keep the account-page support route aligned with the published instructions for users who have lost access to every login method.
- Implement the authenticated self-service workflow in Phase 3. The UI must accurately describe asynchronous/pending states and must never promise immediate deletion when poker settlement or a retry is still outstanding.
- Treat immutable accounting records, security logs, abuse records, and backups according to the owner-approved retention policy: anonymize or retain only what is legally/operationally required, disclose the exception, prevent normal product use of retained data, and expire it on the documented schedule. Do not promise physical removal from every backup immediately unless operations can guarantee it.

### Provider dashboard readiness

Before production activation, the owner must confirm:

- Google OAuth consent/branding configuration contains the public production homepage, Privacy Policy, optional Terms used by Arcade Hub, verified authorized domain, current support contact, and only the approved minimal scopes;
- Meta/Facebook App Dashboard contains the public Privacy Policy and a valid data-deletion configuration. Use the public Data Deletion Instructions URL when that option is accepted for the app; if the dashboard/review requires a Data Deletion Request callback, Facebook remains disabled until a compliant HTTPS callback and human-readable status flow are separately implemented and verified;
- GitHub production OAuth App contains the matching public homepage and owner-approved support/legal links exposed by Arcade Hub, even where GitHub does not provide equivalent dedicated dashboard fields;
- screenshots or an owner-maintained release record capture the configured public URLs, provider app environment, review/live status, and verification date without recording provider secrets.

Production go-live checklist:

- [ ] Privacy Policy updated and published in Polish and English.
- [ ] Terms reviewed and updated in Polish and English where necessary.
- [ ] Public homepage, Privacy, Terms, contact, and deletion instructions verified without authentication.
- [ ] Public account/data deletion instructions URL published.
- [ ] Manual support deletion procedure documented and execution-tested by the owner.
- [ ] Self-service account deletion implemented, stage-tested across password and enabled OAuth accounts, and enabled in production.
- [ ] Chips, poker, XP, Storage, logs, and backup deletion/anonymization rules approved and reflected in PL/EN disclosures.
- [ ] Google OAuth consent/branding links and support contact configured.
- [ ] Meta Privacy Policy and Data Deletion Instructions URL or required callback configured and verified.

## Delivery plan

### Phase 1 — shared OAuth client contract

Files and methods:

- Update `js/auth/supabaseClient.js`:
  - add fixed `OAUTH_PROVIDER_ORDER`, `OAUTH_PENDING_STORAGE_KEY`, `OAUTH_PENDING_TTL_MS`, and the closed callback error-code allowlist;
  - add `isOAuthProviderEnabled(provider)` and reject unknown/disabled provider names before any storage write or SDK call;
  - add `normalizeAuthReturnPath(value)` with the explicit examples and loop behavior above;
  - add `readPendingOAuthState()`, `writePendingOAuthState()`, and `clearPendingOAuthState()` around the closed `{ provider, returnPath, startedAt }` record;
  - add `readOAuthCallbackResult()` as the sole URL callback interpreter and expose only its controlled status contract;
  - add `signInWithProvider(provider, returnPath)` around `client.auth.signInWithOAuth()`;
  - build `redirectTo` only from the validated current HTTP(S) origin plus `/account.html`;
  - expose only the page-facing provider check, sign-in method, and controlled callback-result method through `window.SupabaseAuth`; keep storage primitives private;
  - delete `getEmailDomain()` and remove `userId`, `emailDomain`, and `sessionExpiresAt` from `supabase:session_initial` and `supabase:auth_change` telemetry;
  - retain only aggregate `event`, `hasUser`, and `hasSession`, plus an allowlisted provider name only for a known active pending OAuth callback;
  - do not log raw `Error.message` for OAuth callback failures; map to bounded internal status/code values;
  - never log URLs, URL fragments, authorization data, tokens, email addresses, provider subjects, or raw provider payloads.
- Update `scripts/generate-build-info.js` and the checked-in `js/auth/supabase-config.js` with the public provider array.
- Extend existing auth contract coverage in `tests/account-auth.contract.test.mjs` only for the security-critical allowlist, redirect examples, pending-state lifecycle, callback sanitization, session-source distinction, and telemetry-field removal described in the test contract below.

Provider-token contract for this phase:

- Arcade Hub does not access `session.provider_token` or `session.provider_refresh_token`, does not copy either field into application state, and does not send either field to Netlify, WS, KLog, analytics, profile APIs, or local application records.
- Supabase access and refresh tokens remain managed by the existing Supabase client because they are the Arcade Hub session credentials.
- Before implementation is accepted, manually inspect `localStorage`, `sessionStorage`, IndexedDB, cookies, application logs, and post-callback network traffic for every provider. Record whether Supabase JS internally persisted provider-token fields and verify that no Arcade Hub-owned key contains them.
- If the owner requires zero provider-token persistence even inside Supabase SDK storage, Phase 1 is blocked pending a separate technical decision. The implementation must then use and validate either a custom Supabase auth storage adapter that strips only provider-token fields before every write, or a non-persistent-session design; it must cover reload, refresh, recovery, sign-out, and cross-tab behavior. Do not silently claim the default client satisfies an absolute prohibition.

Acceptance:

- an unknown provider cannot reach `signInWithOAuth()`;
- the redirect target cannot leave the current origin;
- password sign-in and restored sessions cannot consume pending OAuth state;
- callback success/error/cancel and TTL expiry clean pending OAuth state under the rules above;
- callback output contains no raw `error_description`, URL, token, authorization code, state, or unknown provider/code;
- no provider token is read, copied, logged, forwarded, or stored in an Arcade Hub-owned record;
- auth telemetry contains no `userId`, `emailDomain`, email, session expiry, provider subject, or other high-cardinality identity field;
- existing email/password and recovery contracts remain unchanged;
- an empty provider config retains today's UI and behavior.

### Phase 2 — account UI and callback feedback

Files and methods:

- Update `account.html` with the provider group, divider, legal notice, local icons, and responsive styles using the existing account-card design.
- Update `js/account-page.js`:
  - capture `[data-oauth-provider]` buttons in `selectNodes()`;
  - add `renderOAuthProviders()` and `setOAuthBusy(provider)`;
  - add `handleOAuthSignIn(event)`;
  - call `readOAuthCallbackResult()` and render only its controlled localized message key;
  - consume a validated return path only for a fresh, matching OAuth callback with a confirmed session, never for password login or old-session hydration;
  - continue using existing authenticated rendering after success.
- Update `js/i18n.js` with complete English and Polish copy for labels, progress, cancellation, stale callback, generic failure, legal notice, divider, and missing-email fallback. Do not add provider-hint copy.
- Add approved provider SVG assets below the existing local asset tree and record provenance/license requirements in the existing third-party documentation if required by the provider's terms.

Acceptance and manual UI validation:

1. Keyboard-only and screen-reader navigation exposes each provider once with an accurate accessible name.
2. Desktop and narrow mobile layouts have no overflow, clipped labels, or layout shift when buttons enter the busy state.
3. Double-clicking cannot start two OAuth attempts.
4. Cancellation returns to a usable email/social login page.
5. A successful login shows the existing profile, XP, chips, favorites, and poker identity for the Supabase user UUID.
6. Email signup, confirmation, sign-in, password reset, password recovery, and sign-out still work.
7. Browser history does not retain a usable OAuth token fragment after session hydration and return-path replacement.
8. Password login, refresh with an old session, email confirmation, and password recovery leave unrelated pending OAuth state unconsumed until an actual callback or TTL cleanup.

Per the project testing policy, do not add CSS, DOM-rendering, or Playwright tests solely for this UI. Update existing static contract expectations only when necessary; validate visual and provider behavior manually on the deploy preview.

### Phase 3 — self-service Arcade Hub account deletion

This phase is mandatory before production OAuth activation. It is a cross-store, destructive workflow and must be delivered independently from the OAuth button/callback change so it can be reviewed, migrated, deployed, and rolled back safely.

#### Server contract and persistence

Files, functions, and properties:

- Add a migration such as `supabase/migrations/<timestamp>_account_deletion_workflow.sql`:
  - create a private `public.account_deletion_requests` table with an opaque request ID, nullable `user_id` not protected by an `auth.users` cascade, status, step markers, attempt count, timestamps, bounded internal error code, and a hash of a high-entropy status confirmation token; clear `user_id` after Auth deletion and do not store email, provider token, provider subject, raw error, or plaintext confirmation token;
  - allow at most one non-terminal request per user and deny direct browser reads/writes with RLS;
  - add the minimum account freeze/deletion marker needed for every mutating HTTP/WS path to reject new XP, chip, profile, favorite, bonus, and poker changes once deletion processing starts;
  - replace the current `chips_accounts.user_id -> auth.users.id` blocking relationship with an approved ledger-safe contract. A deleted user's settled `USER` account may be closed and detached/anonymized, but `chips_entries` and balanced transactions must not be blindly cascaded or rewritten in a way that breaks ledger invariants;
  - add only the indexes and bounded cleanup metadata required by the orchestrator; do not expose deletion requests through public APIs.
- Add `netlify/functions/account-delete-challenge.mjs` as authenticated `POST` only. It creates a short-lived, one-use server record bound to the current verified Auth UUID and requested deletion action. A refreshed JWT `iat` alone is not proof of recent authentication.
- Add `netlify/functions/account-delete-start.mjs` as authenticated `POST` only:
  - derive the target user solely from a verified Supabase JWT; never accept a target `userId` or email from the browser;
  - require a recent reauthentication proof, strict allowed Origin/CORS, an exact typed confirmation, rate limiting, and a one-time/idempotency key;
  - create or return the caller's active deletion request and its controlled status token; never perform an unbounded multi-store deletion inside the initial request;
  - return closed status/error codes such as `reauth_required`, `poker_active`, `deletion_pending`, and `deletion_unavailable`, without raw backend details.
- Add `netlify/functions/account-delete-status.mjs` for a high-entropy, single-request status capability. It returns only a controlled status and timestamps required by the UI; it never exposes user ID, email, provider identity, storage path, ledger metadata, or internal error details. Rate-limit it and make terminal status records expire under the approved retention policy.
- Add `netlify/functions/_shared/account-deletion.mjs` with an idempotent `processAccountDeletion(requestId, deps)` state machine. Persist step completion before advancing, tolerate a retry after any external timeout, and never roll a completed destructive step backward.
- Add `netlify/functions/account-deletion-scheduled.mjs` using the repository's existing scheduled-function pattern. It atomically leases a bounded batch of due requests, calls `processAccountDeletion()`, and releases or reschedules each lease. The browser request must not depend on post-response work continuing in an ordinary Netlify Function.
- Reuse `verifySupabaseJwt()`, `baseHeaders()`, `corsHeaders()`, `klog()`, the existing SQL helpers, and the Storage request patterns in `netlify/functions/_shared/profile-avatar.mjs`. Add a service-role Auth Admin helper only inside server code; the service-role key must never reach browser config or logs.

Required state contract:

```text
QUEUED -> BLOCKED_POKER | PROCESSING -> RETRYABLE_ERROR | MANUAL_REVIEW | COMPLETED
```

- `BLOCKED_POKER` is resumable after the authoritative table has safely completed leave/cash-out; it is not a terminal deletion failure.
- `RETRYABLE_ERROR` records only a closed step/error code and retry schedule. Repeated non-recoverable failures become `MANUAL_REVIEW` and enter the owner support runbook.
- `COMPLETED` is written only when required stores have been deleted/anonymized and the Auth user is gone. Status lookup remains possible through the hashed capability, not through the deleted session.

#### Deletion order and data contracts

`processAccountDeletion()` must use this order and these invariants:

1. Verify the request and freeze new account mutations. Concurrent start calls return the same active request.
2. Query the authoritative poker service for every active human seat. Use the existing WS leave/cash-out domain path at a safe hand boundary; do not delete seat rows directly while a live room still owns the state. If funds or a hand cannot be settled, move to `BLOCKED_POKER` and retry instead of deleting the account.
3. Close and settle the chips account under a single SQL ledger transaction. The owner must first choose the approved disposition of remaining virtual chips. Preserve balanced `chips_entries`; detach/anonymize retained accounting records and scrub user UUIDs from free-form transaction/reference/metadata fields where the schema permits.
4. Remove the user's XP totals, profile snapshot, rate/migration keys, and membership in all-time/day/week/hidden leaderboard sets through a bounded `deleteUserXpData(userId)` helper built on `netlify/functions/_shared/store-upstash.mjs`. Do not use an unbounded Redis `SCAN` in a request; add a per-user registry/index or a bounded retention-window strategy for every dynamic key family.
5. Delete pending avatar uploads and the processed public avatar object through the existing Supabase Storage service-role path before the cascading profile rows disappear. A missing object is idempotent success; an unavailable Storage service is retryable rather than silently ignored.
6. Delete or anonymize Postgres product data according to the approved table-level matrix: cascade `favorites`, `user_profiles`, avatar receipts, bonus claims, and other account-owned rows where deletion is safe; remove active poker request/seat/hole-card state only after authoritative settlement; anonymize retained poker actions/history and chips ledger rows rather than leaving a usable Supabase UUID.
7. Delete the Supabase Auth user with the server-side Admin API last. This removes password credentials, sessions, and every linked Google/Facebook/GitHub identity together. Never delete or unlink only the identity used for the current session.
8. Mark the opaque request `COMPLETED`, revoke/clear the browser session and Arcade Hub identity-bound caches, and make all former public-profile URLs and leaderboard entries return the normal not-found/absent state.

The implementation must publish a table-by-table deletion matrix in the same delivery PR, covering `auth.users`/identities/sessions, `user_profiles`, avatar objects and upload receipts, favorites, bonus claims, XP and leaderboard keys, chips accounts/transactions/entries, poker seats/requests/hole cards/actions/state JSON, application logs, and backups. Each row must name `delete`, `anonymize`, `retain until`, the responsible step, and the retry behavior. This matrix requires owner/legal approval before the migration reaches production.

#### Reauthentication and account UI

Files and methods:

- Update `js/auth/supabaseClient.js` with a narrow `reauthenticateForAccountDeletion()` contract that obtains the server challenge and completes an explicit fresh Supabase authentication without exposing provider tokens. A normal old session or automatic token refresh is insufficient.
- Password users re-enter their password through Supabase; OAuth users complete a fresh top-level OAuth authentication with one of their enabled linked identities. The callback presents the fresh JWT plus the opaque challenge to the server, which must compare its verified `sub` with the UUID bound to the challenge before marking reauthentication complete. A callback that signs into a different account invalidates the challenge and can never delete either account.
- The browser does not infer the provider used for the current session. It may use `identities` only to build an allowlisted choice of login methods available for this explicit reauthentication flow; if that field is unavailable or ambiguous, show the configured providers plus password where applicable and rely on the server's same-`sub` check. Cancellation clears only deletion reauth state and never starts deletion.
- Update `account.html` to turn the existing delete-account support control into a localized danger-zone flow: consequences summary, public support fallback, typed irreversible confirmation, reauthentication, pending/progress state, and final confirmation. Do not combine deletion confirmation with an OAuth login button click.
- Update `js/account-page.js` with `startAccountDeletion()`, `pollAccountDeletionStatus()`, and `clearDeletedAccountState()`. After terminal success, sign out locally even if remote sign-out reports the already-deleted user, clear Supabase session storage through the SDK, clear the pending OAuth record, favorites/XP/profile/chips identity caches, and render the anonymous account state.
- Update `js/i18n.js`, `legal/privacy.pl.html`, `legal/privacy.en.html`, `legal/terms.pl.html`, and `legal/terms.en.html` with owner-approved PL/EN copy. Publish `account-deletion.html` as a stable unauthenticated PL/EN entry point for support instructions and deletion-status guidance.
- Keep the manual support path visible for lost-login, blocked, and `MANUAL_REVIEW` cases. It must not require the user to disclose a password, OAuth token, or provider subject.

#### Provider callbacks and Meta

The stable public instructions URL is the default Meta configuration because the self-service flow is initiated inside Arcade Hub. If the current Meta dashboard/review also requires a Data Deletion Request callback, add it as a separately reviewed adapter that verifies Meta's signed request using a server-only app secret, maps the provider identity to the Supabase user, starts the same deletion orchestrator, and returns the required confirmation code/status URL. In that case the Meta App Secret becomes an explicitly scoped server secret as well as a Supabase provider credential; Facebook stays disabled until rotation, signature validation, replay protection, and status behavior are verified. Google and GitHub do not get provider-specific deletion endpoints unless their current documented configuration requires one.

Acceptance:

- a caller cannot delete another account by changing body/query fields, and an old session without successful recent reauthentication cannot start deletion;
- repeated start calls and worker retries do not double-burn chips, duplicate cash-out, corrupt ledger entry sequences, or fail because an earlier step already removed data;
- an active hand/seat blocks deletion until authoritative leave/cash-out completes; no stack is lost and no ghost seat remains;
- the public avatar object, pending uploads, profile, favorites, bonus eligibility/claims where deletable, XP keys, and all leaderboard memberships are absent after completion;
- retained chips/poker/accounting records contain no directly usable Auth UUID except where owner/legal explicitly approved time-bounded retention, and ledger totals remain balanced;
- Supabase Auth deletion is the final destructive dependency step and removes all linked identities; failed earlier steps leave the Auth account frozen but recoverable by retry/support;
- partial failures in SQL, Upstash, Storage, WS, or Auth Admin produce a bounded retry/manual-review state, never false `COMPLETED`;
- the browser clears identity-bound local data and returns to the anonymous UI after completion; a stale tab cannot resume authenticated mutations;
- the public deletion page and support route work without authentication; the full flow works for password-only, Google, Facebook, GitHub, and automatically linked multi-identity accounts;
- no raw user ID, email, provider subject, storage path, token, or deletion confirmation capability is written to KLog.

Critical automated coverage may extend existing auth, chips, poker, and store tests for authorization/recent-auth enforcement, idempotent retry, ledger balance, active-poker blocking, bounded Upstash cleanup, Storage cleanup, Auth-deletion-last ordering, and controlled status output. Do not add tests for CSS or simple DOM glue. Manual stage verification must use disposable accounts and confirm the resulting rows/objects/keys without copying personal data into CI artifacts.

This phase is expected to touch authoritative poker leave/cash-out behavior in `ws-server/**` or its shared runtime. Its implementation therefore requires `WS Preview Deploy` and a real stage poker deletion exercise before merge. If the final implementation proves it can use the existing deployed authoritative contract without any WS/shared/protocol change, document that evidence and the normal WS-preview exemption in the implementation PR.

### Phase 4 — stage provider setup and end-to-end verification

This phase is primarily owner-controlled configuration; Codex can verify public results but cannot create or approve external provider applications without the owner's accounts and authority.

Configure the stage Supabase project first:

- `SITE_URL`: the canonical non-production URL selected for stage auth operations;
- additional redirect URL for local development if used;
- Netlify preview pattern scoped to this site, for example `https://**--playkcswh.netlify.app/account.html` rather than a wildcard covering all Netlify sites;
- exact stage Supabase callback from Authentication -> Providers in each provider application;
- stage-only client ID and secret in each Supabase provider panel;
- Netlify `deploy-preview`-scoped `AUTH_OAUTH_PROVIDERS` only after provider configuration succeeds; no unscoped or production-inherited fallback.

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
11. inspect Supabase SDK browser storage separately, record whether provider-token fields are present inside its session record, and compare the observation with the owner-approved token-persistence decision.
12. verify pending OAuth state cleanup for success, denial/cancel callback, callback error, redirect-start failure, and TTL expiry; verify password login and old-session restoration do not consume it.
13. inspect the generated preview config and confirm provider order is Google, Facebook, GitHub filtered to the deploy-preview subset, with no production-only provider inherited.

### Phase 5 — production release

- Treat every item in `Legal & Compliance Prerequisites` as a hard go-live gate. Do not enable a production provider merely because its technical OAuth callback succeeds.
- Create/use production provider applications and configure the production Supabase project with its own credentials.
- Set production Supabase `SITE_URL` to `https://play.kcswh.pl` and add the exact `https://play.kcswh.pl/account.html` redirect URL. Do not use a broad production wildcard.
- Complete Google publishing/verification requirements and branding review.
- Complete Facebook required app details, email/public-profile permission setup, Live mode/review as applicable, privacy policy, Terms, and user-data-deletion instructions/callback.
- Configure a production GitHub OAuth App with the production Supabase callback and keep Device Flow disabled.
- Publish approved PL/EN Terms and Privacy changes before enabling buttons.
- Publish and execution-test the self-service deletion workflow, public instructions, and manual support runbook before enabling buttons. Complete at least one disposable-account deletion per enabled login method on stage and verify the table-by-table deletion matrix.
- Enable one provider at a time in Supabase, then in production `AUTH_OAUTH_PROVIDERS`; smoke test and monitor before enabling the next.
- Keep the production provider list scoped only to Netlify `production`; compare the generated production and deploy-preview configs before activation.
- Roll back a provider by removing it from the public list and disabling it in the target Supabase project. Do not delete users, identities, public profiles, XP, chips, or poker data during rollback.

## Provider-specific owner checklist

### Google

- Create a Web OAuth client in Google Auth Platform for stage and another for production.
- Configure the audience/consent screen, support contact, authorized domains, homepage, Privacy Policy, and Terms links.
- Add the exact target Supabase callback URI as an authorized redirect URI and the appropriate application origin as an authorized JavaScript origin if Google requires it for the chosen client configuration.
- Store Client ID and Client Secret only in the matching Supabase project.
- Use only the basic authentication identity scopes supplied by Supabase. Do not request Drive, YouTube, contacts, offline access, or forced consent.
- Approve the final Google button against current branding requirements.
- Verify the public production homepage, Privacy Policy, optional Terms URL used by Arcade Hub, verified domain, and support contact in the OAuth consent/branding configuration.

### Facebook

- Create a stage/test Meta app and a separate production app or approved production test-app arrangement.
- Add Facebook Login, configure the exact target Supabase callback under Valid OAuth Redirect URIs, and enable only `public_profile` plus `email` required by Supabase.
- Complete app icon, domain, contact, Privacy Policy, Terms if applicable, and data-deletion URL/instructions.
- Configure the public Data Deletion Instructions URL when accepted by the current dashboard; if Meta requires a Data Deletion Request callback for this app, keep Facebook disabled until that separately scoped callback/status flow is implemented.
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

- Keep provider secrets exclusively in Supabase provider configuration for the OAuth frontend flow. They are not browser config, source files, build logs, or GitHub secrets. The only conditional exception is a separately scoped server-side Meta App Secret if Meta requires the signed Data Deletion Request callback described in Phase 3; never reuse or expose it client-side.
- Treat `SUPABASE_ANON_KEY` as the existing public client credential; do not confuse it with provider secrets.
- Let Supabase generate and validate the OAuth protocol `state`. The Arcade Hub pending record is short-lived UI/navigation correlation only: never pass it as the OAuth `state` parameter and never treat it as CSRF protection or proof of identity.
- Use exact production redirects and a site-scoped Netlify glob only on the stage project.
- Request the minimum identity scopes; provider API access is not part of login.
- Do not read, copy, retain separately, refresh, or forward provider tokens in Arcade Hub code. Treat possible Supabase SDK-internal persistence as an explicit audited exception, not as application-owned storage or as proof of zero persistence.
- Remove the existing `userId`, `emailDomain`, and `sessionExpiresAt` auth diagnostics in Phase 1. Log only aggregate event/status, `hasUser`, `hasSession`, and optionally an allowlisted provider name tied to a fresh pending callback. Never log user ID, email/domain, provider subject, authorization code, state, URL/query/fragment, access/refresh token, raw error description, or raw provider response.
- Use existing `KLog`/`klog` integration; never add `console.log`.
- Update PL/EN Privacy and Terms to identify social-login providers, categories/purpose of data, Supabase processing, retention/deletion, and support contact. Legal basis and final wording are owner/legal decisions.
- CSP should not gain provider domains for the planned full-page redirect. If implementation adds a provider SDK, iframe, hotlinked icon, or inline script, stop and revise the plan and CSP review instead of silently broadening the policy.

## Codex versus owner responsibilities

| Work item | Codex can implement | Owner must do/approve |
| --- | --- | --- |
| Auth wrapper | Provider allowlist, pending-state TTL/lifecycle, safe redirect, controlled callback result, telemetry cleanup, no-token application handling | Approve client-only flow, SDK-storage token exception or absolute prohibition, and any later PKCE/storage redesign scope |
| Account UI | Buttons, responsive/accessibility states, PL/EN strings, legal links, local assets | Approve copy, provider order, screenshots, and brand compliance |
| Public build config | Parse `AUTH_OAUTH_PROVIDERS`, preserve fixed provider order, hide disabled buttons, document contexts | Set independent deploy-preview/production-scoped values without site-wide inheritance |
| Google | Integrate configured provider and verify callback behavior | Own Cloud project/client, consent screen, domain verification, credentials, publishing/verification |
| Facebook | Integrate configured provider and verify callback behavior | Own Meta app/testers, permissions, app review/Live mode, credentials, privacy/data deletion setup |
| GitHub | Integrate configured provider and verify callback behavior | Own stage/prod OAuth Apps, credentials, homepage/callback configuration |
| Supabase | Verify generated profile and existing JWT consumers, document exact settings | Enable providers, enter secrets, set Site URL and redirect allowlists in stage/prod dashboards |
| Legal/privacy | Only wire owner-approved final URLs/copy when separately requested; do not make legal determinations | Own legal review; approve, publish, and date PL/EN Terms/Privacy and public deletion instructions; configure provider-dashboard links |
| Account deletion runtime | Implement the authenticated start/status endpoints, idempotent orchestrator, migrations, Storage/XP cleanup, ledger-safe anonymization, poker coordination, session cleanup, danger-zone UI, and controlled diagnostics | Approve remaining-chip disposition, poker/ledger/log/backup retention, recent-reauth window, deletion SLA, and production feature enablement |
| Account deletion support | Publish the repository-owned public instructions page and wire the fallback path after owner supplies approved text | Own the mailbox, ownership-verification policy, executable manual runbook, exceptional request handling, and completion/refusal records |
| Testing | Run repository checks and guide/inspect deploy-preview smoke results | Use real provider accounts, approve external consent screens, execute final production smoke |
| Rollout | Prepare flags, diagnostics, and rollback instructions | Decide provider order, enable production, monitor support/security impact |

Codex must stop and ask for owner action when external credentials, domain/app verification, provider review, legal approval, or production enablement is required. Those steps cannot be safely inferred or automated from this repository.

## Test and verification contract

Automated work follows the project policy:

- extend `tests/account-auth.contract.test.mjs` only for critical provider allowlisting, redirect/open-redirect examples, pending-state TTL and lifecycle, callback sanitization, password/old-session non-consumption, and removal of high-cardinality auth telemetry;
- extend the closest existing auth/chips/poker/Upstash/Storage tests only for Phase 3's destructive security and accounting invariants: caller identity, recent reauthentication, idempotent retry, active-seat settlement, balanced ledger, bounded key cleanup, Auth-deletion-last ordering, and controlled status output;
- update existing static/build-config expectations for the new public provider array;
- do not introduce a new UI test framework or tests for CSS/layout/simple DOM glue;
- run the existing syntax and repository test commands before merge.

Manual stage verification is mandatory because provider dashboards, real consent screens, redirects, account-linking outcomes, destructive multi-store cleanup, and the Supabase SDK's actual browser-storage shape cannot be proven by repository tests. Record for each provider: target Supabase project ref, provider app environment, preview URL, resulting Supabase user UUID comparison (same/different only, not the UUID value in logs), profile creation result, SDK storage audit result, pending-state cleanup result, generated provider list/order, disposable-account deletion result, and pass/fail timestamp. Before production, the owner must also record successful unauthenticated access to the published legal/deletion URLs, one successful self-service deletion per enabled login method, and a dry run of the manual support fallback.

This documentation-only PR does not require `WS Preview Deploy`. Phase 3 implementation is presumed to affect authoritative poker settlement and therefore requires `WS Preview Deploy` unless its implementation PR proves and documents that no `ws-server/**`, shared WS runtime dependency, or browser/WS protocol changed.

## Breaking and operational impact

| Area | Expected impact |
| --- | --- |
| Browser auth API | Additive `signInWithProvider()` and provider/config helpers. Existing email/password methods remain. |
| Browser auth storage | Add a versioned, session-scoped pending OAuth record with a ten-minute TTL. Existing Supabase session persistence remains unless the owner chooses the absolute provider-token prohibition, which requires a separate storage/session design. |
| Callback contract | Additive controlled `readOAuthCallbackResult()` output. `account-page.js` no longer interprets raw callback parameters. |
| Auth accounts | First provider login may insert `auth.users`; same verified email may be automatically linked by Supabase. |
| Public profiles | Existing trigger creates one generated profile for a newly inserted Auth user. No provider metadata is published. |
| XP/chips/favorites/poker | OAuth keeps the UUID/JWT `sub` contract. Account deletion adds a freeze and destructive cleanup/anonymization path; chips and poker require settlement before identity removal. |
| Database | Phase 3 requires a migration for deletion workflow state and a ledger-safe closed/anonymized user-account contract. Stage must also contain the automatic profile-provisioning migration. |
| Secrets | Three provider credential pairs per environment are owner-managed in Supabase. A server-side Meta App Secret is added only if the optional signed deletion callback is required and approved. |
| Public ENV | Add non-secret `AUTH_OAUTH_PROVIDERS` separately per Netlify context. |
| Diagnostics | Breaking operational change: remove `userId`, `emailDomain`, and `sessionExpiresAt` from existing auth telemetry. Troubleshooting loses per-user/domain correlation and must use aggregate event/status plus request-side diagnostics that do not identify a user. Dashboards or alerts depending on removed fields must be updated before rollout. |
| CSP | No change planned. Full-page navigation and existing Supabase connection policy are sufficient. |
| Account deletion API | New authenticated destructive start operation and capability-based status lookup. It is additive to ordinary account APIs but irreversible after processing begins. |
| WS | OAuth itself does not change WS. Phase 3 may coordinate authoritative leave/cash-out and is WS-preview gated as described above. |
| Legal/support | Hard production gate: owner-approved public PL/EN legal documents, stable deletion instructions URL, operational self-service deletion, provider-dashboard links, and an executable manual fallback runbook. |

The browser API additions are non-breaking, but the telemetry schema change is intentionally breaking for operations. The material product risk is identity linking/account duplication and provider-token persistence policy, not only code compatibility. Do not make existing synchronous account UI methods asynchronous beyond the already promise-based submit handlers without updating every caller.

## Definition of done

- Enabled Google, Facebook, and GitHub buttons complete login through the matching stage and production Supabase projects.
- Disabled/unconfigured providers are not shown and cannot be invoked through the wrapper.
- Email/password signup, confirmation, sign-in, reset, recovery, and sign-out remain operational.
- A first OAuth login creates a generated Arcade Hub public profile and uses the same UUID-based XP, chips, favorites, and poker paths.
- Same-email linking and different-email separation match the approved product policy and are verified on stage.
- OAuth cancellation and errors produce controlled PL/EN feedback without raw provider text or token leakage.
- Redirects are current-origin only; production uses exact URLs and stage preview wildcards are site-scoped.
- Pending OAuth state is provider-bound, TTL-limited, cleaned on every observable terminal callback, and never consumed by password login or restored sessions.
- Provider scopes are minimal; provider tokens are never handled or stored separately by Arcade Hub, the approved Supabase SDK-storage policy is verified manually, and no provider avatar is hotlinked or published.
- Auth telemetry contains no user ID, email/domain, session expiry, provider subject, or raw callback/error data, and the operational loss of per-user correlation is accepted.
- Generated provider lists are independently scoped for deploy preview and production and render in fixed Google, Facebook, GitHub order.
- Google/Meta/GitHub branding, app configuration, legal disclosures, and data-deletion requirements are owner-approved before production.
- Public PL/EN Privacy/Terms, homepage, contact, and account/data deletion instructions are available without authentication; Google and Meta dashboard links resolve to the approved production pages.
- A recently reauthenticated user can permanently delete a password, single-provider, or linked multi-identity Arcade Hub account through the danger-zone UI, with accurate pending/manual-review states and no cross-account deletion path.
- Deletion safely settles poker/chips, preserves ledger invariants, removes or approved-anonymizes Postgres data, Storage avatars, XP/leaderboard data, and linked Supabase identities, and remains retryable after a partial external failure.
- The owner has execution-tested and documented both self-service deletion and the manual fallback procedure using disposable stage accounts.
- Rollout can be stopped per provider using the public UI list plus the authoritative Supabase provider switch.
- No new provider CSP domain or provider secret in browser/repository output is introduced. Required account-deletion migrations and any WS-preview deployment are completed before production OAuth activation.

## Plan verdict and owner decisions before implementation

Verdict: ready for implementation only after the decisions below are recorded. The architecture remains valid—Supabase is the sole OAuth broker and existing UUID/JWT consumers remain unchanged—but OAuth must not be implemented from the earlier, ambiguous return-path, telemetry, or token-storage contract.

Owner decisions:

1. Approve the recommended provider-token boundary: Arcade Hub never reads, copies, logs, forwards, refreshes, or stores provider tokens separately, while Supabase SDK-internal session persistence is allowed only after the documented browser-storage audit. If zero persistence is required even inside Supabase storage, pause implementation and approve a separate custom-storage or non-persistent-session design.
2. Accept the breaking operational removal of `userId`, `emailDomain`, and `sessionExpiresAt` from auth telemetry, including updates to any dashboards or troubleshooting procedures that depend on them.
3. Approve the first-release omission of the "Signed in with ..." hint until a reliable current-session provider signal is identified and reviewed.
4. Approve the fixed UI order Google, Facebook, GitHub; environment configuration selects a subset only.
5. Create separately scoped `deploy-preview` and `production` values for `AUTH_OAUTH_PROVIDERS`, with no site-wide production list inherited by previews.
6. Approve the client-only Supabase flow for the first release and treat any PKCE migration as a separate cross-flow change covering email confirmation and password recovery.
7. Create/configure separate stage and production provider applications, credentials, Supabase provider settings, Site URLs, and redirect allowlists.
8. Approve provider branding, PL/EN legal copy, privacy/data-deletion disclosures, automatic-linking behavior, duplicate-account support, and lost-provider recovery policy.
9. Approve the destructive-data matrix: remaining-chip disposition; ledger and poker-history anonymization; treatment and retention duration for security/abuse logs and backups; and the deletion completion/SLA wording.
10. Approve the recent-reauthentication maximum age and UI for password, OAuth, and linked multi-identity accounts. Decide whether deletion blocks until a safe poker boundary or forces an immediate fold under existing rules; it must never lose an unsettled stack.
11. Publish the stable public account/data deletion instructions URL, configure the applicable Meta deletion field, and approve an executable manual support runbook with ownership verification and retention rules.
12. Decide whether Meta accepts the public instructions URL or requires the signed Data Deletion Request callback. If the callback is required, approve the additional server-secret ownership, rotation, replay protection, and status-retention contract before Facebook activation.
13. Perform real-provider stage and production smoke tests, including browser-storage inspection, pending-state lifecycle, generated environment config, public legal/deletion URL checks, self-service deletion of disposable accounts, and same/different UUID outcomes without logging UUID values.

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
- [Meta data deletion request callback and privacy-policy requirement](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/)
- [Google OAuth production readiness and policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google sign-in branding](https://developers.google.com/identity/branding-guidelines)
- [GitHub OAuth App creation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [GitHub OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
