# G-LEGAL-A / T033 — readiness review, 2026-10-27

> Historyczny zapis przygotowania. Aktualny stan, SQL i decyzje: [skonsolidowany raport 2026-10-28](g-legal-a-consolidated.md). Nie traktować dawnych flag/hashów/Ads-blocker jako bieżącego wyniku.

Status: technical source review PASS; OWNER/LEGAL decisions and live Terms-ON acceptance OPEN. Technical review is not legal approval. T010/G1 and G2 PASS, owner independently confirms Stage120/120, BIO absent, handle_customized_at retained,51 accounts, catalog16 ON / Terms OFF. Overall phase A remains OPEN. No environment mutation, receipt creation, SQL execution, deployment or APK rebuild in this audit.

## Evidence and scope

Source HEAD631867186ff5efed7f62bdb10b5e439fc6842915. Read agents.md, skills.md, spec/plan/tasks, review-final-legal.md, T010/T012 reports and enable-terms.sql. Current compatible Preview1155 source63186718/deploy6ae0e59d883d7fc228a7ab29; verified WS Preview ea178bb3/run40497329798; accepted APK e370e461/run40508480671. These are prior actual release receipts, not freshly redeployed or relogged in this audit. G2 post-contract authenticated onboarding/profile-me/Account200 and no SQL42703/0A000 errors are documented in t010-contract-reference-review.md. No Production verification or modification is implied here.

Read actual APK ZIP: canonical/versioned Terms and Privacy PL/EN all present. Version2026-10-26-a1/date2026-10-26. Extracted main text matches repo after existing packager branding substitution Arcade Hub→Arcade Poker; packager also converts relative links to packaged legal pages, Stage cookies URL and Poker Lobby. Whole HTML is intentionally not byte-identical. OWNER/LEGAL must approve both presentations, including broad portal wording versus Poker-only app. Do not edit immutable a1 after receipts; material revisions require a separately reviewed version and release plan.

## OWNER/LEGAL decisions — explicit approval required

- [ ] Approve PL/EN a1 content, operator/contact details, scope, prohibited conduct and APK presentation; confirm translations equivalent. Accepting this technical report does not approve that content.
- [ ] Decide when the contract forms: signup, confirmed email, successful Google authentication, or explicit acceptance. Current code allows Auth/session completion before Terms; only explicit authenticated POST records acceptance. No automatic acceptance on email confirmation, OAuth callback, login, or existing session. Confirm this timing and wording; Terms acceptance is not automatically GDPR consent or Google-photo consent.
- [ ] Approve existing-session and guest treatment: no grandfathered receipt; current-version acceptance before new protected use, guest receipt validity1hour. Direct-entry server checks apply independently of browser prompt. Offline has no server receipt requirement.
- [ ] Approve refusal: Not now/cancel records nothing, denies new protected use but preserves current paid participation, safety and exit. Existing game can continue; new reactions/gifts/avatar publication require acceptance. Read-only browsing, support and legal access stay available.
- [ ] Approve retention and disclosures: account receipt has no expiry and FK Auth deletion cascade; guest expiry1hour is logical expiry, physical cleanup only bounded opportunistic deletion on acceptance (up to100 expired rows plus own expired guest rows). “Routine retention” must not be interpreted as a guaranteed hourly purge. Confirm account lifetime, backups, security/accounting exceptions and Privacy declarations match actual V2/V3 processes. No Storage purge authorized.
- [ ] Decide Google Play readiness separately: UGC policy classification/moderation appropriate to exposed features, Privacy/Data safety accuracy, accessible in-app/external deletion. Terms ON alone is not Play compliance or approval. No phases B/C/D are authorized or made prerequisites by this audit; unresolved publishing requirements remain a separate Play gate.

Primary policy references checked during audit: [Google Play UGC](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en), [Google Play developer policies — User Data/account deletion](https://support.google.com/googleplay/android-developer/answer/18258653?hl=en). These require appropriate UGC safeguards and accurate data/deletion disclosures; applicability and legal acceptance remain OWNER/LEGAL decisions, not an engineering certification.

## Actual enforcement boundaries

| Boundary | Source / behavior |
|---|---|
| Policy/receipt | shared/profile-terms.mjs readTermsStatus: policy FOR SHARE, missing row fail-closed503; exact current version + unexpired subject receipt. requireCurrentTerms rejects409 only when active and no current receipt. OFF still requires compatible schema. |
| Acceptance | acceptTerms: account lifecycle/deletion check or guest advisory lock, policy lock, exact version/requestId. Verified identity is server-derived. Unique subject/version insert preserves original timestamp on replay; conflicting request/version rejected. Account receipts cascade on Auth deletion; private tables RLS and anon/authenticated revoked. |
| HTTP onboarding | profile-onboarding.mjs GET reads only status; POST validates bounded exact body and JWT/verified guest principal, not client subject. OFF rejects acceptance. No provisioning in GET. |
| Browser/Auth | profile-onboarding.js binds displayed version and generation to fresh token identity; rejects stale account response; Not now resolves false. New sessions prompt after Auth, no auto-consent. Table page avoids automatic modal interruption; prompt is available. supabaseClient.js signup/email redirect and Google OAuth remain independent of acceptance. |
| Create/quick-seat | poker-create-table.mjs lifecycle→policy gate; poker-quick-seat.mjs existing participation/idempotent replay branches precede new-use gate. New table/new recommendation gated before creation. |
| Authoritative JOIN | shared/poker-domain/join.mjs existing paid-seat/resume/replay returns before requireTerms; new seat gated before bankroll access/new financial mutation. Direct WS admission cannot bypass it. |
| UGC/new gifts | WS reaction_send uses current lifecycle transaction or one SQL transaction for gate. gift-purchase.mjs paid replay returns before gate, fresh purchase gated in same transaction before BURN. Avatar variant update in user-profile.mjs gated, CAS unchanged. |
| Safety/continuation | No global Terms dispatcher gate. Betting/settlement, existing reconnect/resume, leave, hello/auth, logout, deletion, support and privacy-only update do not acquire a new Terms requirement. Account deletion lifecycle protections remain independent. Offline generated isolated page has no Terms/Auth/HTTP/WS dependency. |

These are source/fundamental-test findings, not a new live funded test. UI modal can be dismissed; it is not the security boundary. Old clients without acceptance UI can receive409 terms_required for new use; do not weaken server gate for compatibility. Single Player new server-backed session is new use; device-local Offline remains independent.

## Activation script review — NOT ready to execute unchanged

operations/enable-terms.sql currently checks only policy version, then updates active=true within BEGIN/COMMIT. It lacks environment/system pin,120 migration/hash verification, expected OFF/catalog/normalization assertions, bounded waits, receipts invariants and exact affected-row verification. This review proposes the following minimal guarded operation; does not modify or execute the SQL.

1. Separate G-LEGAL-B code-only GO: prepare one Stage-only reviewed exact-hash operation, using existing operator-controlled transaction mechanism, not pending migrations or a new framework. Pin project krydukthwdvccggbyjfw/system7656985631720456337 and explicit operator confirmation. Record SQL hash and immutable PL/EN document hashes.
2. Read-only preflight:120/120 migration versions and SHA records match approved repo; no concurrent policy/DDL/deploy; exact active reader SHAs; normalized marker nonnull, catalog true, active false, version a1; verify receipt count/fingerprint and protected profile/Auth/financial/Storage snapshots. Reconcile changes since latest receipt rather than assuming zero receipts or51 profiles forever.
3. One transaction, no nested BEGIN: SET LOCAL short lock_timeout/statement_timeout, lock singleton policy row in established order without taking profile locks out of order; reassert all pins/expected state. Update only active false→true for exact version/singleton; require exactly1 row. No receipt insertion, no version/catalog/normalization/profile/ACL changes. Verify invariants before COMMIT, including receipt fingerprint unchanged. Any error→ROLLBACK, STOP, no retry.
4. Independent post-COMMIT read active=true/catalog=true/a1 and history unchanged120/120. Before any acceptance smoke preserve activation-only receipt baseline. Unexpected result after COMMIT→STOP; do not delete receipts, reconstruct state or silently deactivate. Separate owner GO can set active=false only; retain genuine receipts/version/history. Runtime or DB rollback is not implied.

## Smallest future Stage acceptance (separate explicit GO)

Reuse tests/profile-phase-a.behavior.test.mjs (current version, server timestamp/idempotency, guest expiry, missing policy/schema, verified identity/IDOR, account switch/version display), shared/poker-domain/join.behavior.test.mjs and ws-tests/ws-join-runtime.behavior.test.mjs (OFF/ON/accepted/missing policy and paid rejoin/replay), gift-purchase.behavior.test.mjs (gate before new BURN, paid replay), existing privacy/deletion fundamental coverage. Synthetic isolated transactions prove financial paths without new live charges.

After approved activation, minimally authorize one dedicated Stage account receipt via explicit displayed-version POST and identical replay: required=true/current false→true, one server timestamp/row, wrong version rejected. This is a real data mutation and is NOT authorized by today's audit. Read-only onboarding/account checks and owner manual APK prompt/refusal can accompany it. New-entry/UGC rejection must be exercised via isolated fixtures or a demonstrably nonfinancial dry boundary; do not send a potentially funded live JOIN/gift/create command. Continuation/reconnect proof reuses paid-seat fixtures and existing physical evidence; any live paid-seat test needs separate GO. No account creation, fresh funded game, destructive deletion or Storage operation required.

## Result / gates

- PASS: G1/G2 contract, catalog/manual profile acceptance, source boundary audit and packaged document inventory/text comparison.
- OPEN: OWNER/LEGAL checklist, reviewed guarded activation SQL/hash, explicit execution GO, then scoped receipt/ON integration acceptance. Current minimal enable-terms.sql is not approved for execution.
- T010 final A and T033 Terms branch remain OPEN. Production rollout is separately schema/runtime coordinated and not authorized. Stage policy switch does not change Production, but would immediately gate new protected Stage use on all current readers.
- No changes to runtime, JS/CSS, SQL, APK, Stage or Production. No new requirements for full financial regression, phases B/C/D, redesign or audio.

Verification: existing fundamental suite rerun locally with its isolated environment `XP_TEST_MODE=1 XP_CORS_ALLOW=https://arcade.test node --test tests/profile-phase-a.behavior.test.mjs`:12/12 PASS. Initial invocations without test Redis flag/CORS fixture origin failed at import/403; no application or environment configuration was changed to fix them. `git diff --check` PASS. Earlier exact-HEAD CI evidence remains valid; no new broad test campaign. Report and G2 documentation remain local to avoid triggering an unnecessary hosted APK build; PR description updated with findings, Draft/head unchanged.
