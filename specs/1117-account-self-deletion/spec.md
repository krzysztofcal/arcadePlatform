# Feature Specification: Account Danger Zone / bezpieczne usuwanie konta

**Feature Branch**: `docs/1117-account-self-deletion`
**Created**: 2026-10-16
**Status**: Revised 2026-10-17 after owner review; R5 legal and R6 feasibility gates remain, separate GO required
**Input**: [#1117](https://github.com/krzysztofcal/arcadePlatform/issues/1117), including owner decisions recorded in its body as 2026-10-17. Initial audit dated 2026-10-16; revision dated 2026-10-17. Issue decision labels are source labels, not deployment evidence.

## Scope and authorization

This change set contains documentation only. No implementation, migration file, database mutation, service/configuration change, deployment, financial smoke or implementation PR is authorized. Read-only catalog inspection of Stage and Production is allowed; no user records or secrets are read. Existing unrelated workspace files are untouched. This spec, plan, research and tasks are one review package, as explicitly requested; generating the package is not approval to execute it.

## User Scenarios & Testing

### US1 — Confirm deletion and lose access immediately (P1)

An authenticated owner can initiate deletion at any time, including during multiple hands or all-in, without manually leaving or spending chips. An irreversible warning, explicit confirmation and fresh server-verified proof of identity precede durable acceptance.

**Independent test**: deterministic backend authorization and suspension tests; manual presentation check later on authorized Preview.

1. Given a password or Google-only account, when fresh proof and explicit confirmation succeed, then one durable request is accepted; response distinguishes accepted/pending from completed.
2. Given an old JWT, signed WS token, existing socket, XP session or concurrent JOIN/bonus/profile write, when acceptance commits, then no later user operation can commit or expose private account state. Operations that already committed are included in settlement/cleanup.
3. Given another user's UUID, expired/replayed proof, checkbox without proof or refreshed JWT, when deletion is requested, then it is denied without destructive effects.
4. Given a service outage before durable intent, then report retryable failure and no success; after durable intent (including suspension preparation), closing the browser does not cancel work.

### US2 — Safely settle, forfeit and erase (P1)

The suspended user leaves every table through authoritative Poker, forfeits wallet and eventual cash-out/winnings, and receives a truthful pending state until irreversible cleanup completes.

**Independent test**: deterministic multi-table/settlement/restart tests with ledger conservation assertions.

1. Given a live non-all-in hand, when forced Leave runs, then normal fold/deferred detach and settlement preserve opponents and escrow.
2. Given all-in with side pots, then preserve hand participation/cards/contributions through normal showdown; detach after settlement and burn only the former user's rightful cash-out. Current Leave requires correction for this scenario.
3. Given crash after payout, BURN, Storage delete or Auth delete, when recovery resumes, then no duplicate posting occurs, no dependency is skipped and completion is recorded only after positive reconciliation.
4. Given missing or contradictory financial evidence, then remain suspended with an operator incident; never manufacture successful completion or delete Auth prematurely.
5. Given completion, then CH is zero and closed, removable profile/avatar/XP/achievements/favorites/session data is gone; necessary financial evidence remains private under its approved retention policy.

### US3 — New account, retained reward limits (P1)

After actual hard Auth deletion, the same verified email/password or Google identity can create a fully functional new UUID with a new wallet/profile and fresh streak, without inheriting assets, roles, sessions or history.

**Independent test**: backend bonus concurrency tests; later authorized disposable-account Auth integration smoke.

1. Given the same verified email across password/Google and recreated UUIDs, then welcome payments 1–3 can succeed under current campaign configuration, payment 4 is denied without timeout while the same welcome program operates; failed attempts and replays do not consume slots.
2. Given today's paid Poker Daily reward, when a new UUID claims, then deny until next UTC day; start the new account's streak fresh. One-time campaign payments remain once per verified identity/campaign. Other daily/weekly/monthly policies do not change.
3. Given unknown/unverified identity or unavailable HMAC infrastructure, then reward claim fails closed while registration, login and deletion remain possible.
4. Given no remaining welcome reward and Daily below minimum buy-in, then clearly explain the available balance; do not promise immediate Poker access or create a replacement CH source.

### Edge cases

Concurrent actions/settlement/claims; multi-tab deletion; old WS reconnect; persistent table absent from runtime; all-in last human versus bots; uncertain Auth HTTP outcome; late signed avatar upload; email change during challenge/claim; two active accounts sharing an identity; UTC midnight while waiting on locks; campaign recreation; HMAC rotation; exhausted privacy retention; historical payouts with no recoverable verified-email evidence.

## Requirements

- **FR-001**: Accept verified owner intent regardless of wallet, seats or active hand. Use one request per old UUID, durable state and an idempotent operation key. Never accept submitted target UUID/email as authority.
- **FR-002**: Durable intent starts SQL suspension; accepted_at is recorded only after Redis atomic fence is confirmed. A persisted suspension_preparing step resumes without login. Fully acknowledged acceptance is the cross-runtime authorization barrier; Postgres and Redis are not one atomic transaction. All ordinary HTTP, WS, database/RLS, CH, XP and profile operations serialize against it. Internal settlement/Leave/BURN are narrow privileged exceptions, never a client-selected flag.
- **FR-003**: Recover `PENDING → PROCESSING → FINALIZING → COMPLETED` without user login. Retry transient errors durably; financial ambiguity enters an actionable incident and stays suspended. Do not keep an HTTP invocation alive to await a hand.
- **FR-004**: Reuse authoritative table queues, persistence/recovery, normal cash-out and balanced canonical BURN (USER debit / GENESIS credit). Do not confiscate shared pot, alter balances directly or erase ledger/escrow/idempotency evidence.
- **FR-005**: Seal financial obligations before BURN/retirement; no late USER postings after closure. Retain USER account ID/type and historical identity semantics. Hard Auth deletion comes after finances, cleanup and Storage safety checks.
- **FR-006**: Remove removable identity data and invalidate browser/Redis/WS caches; prevent stale services from repopulating them. This includes raw Redis SET/SETEX/ZADD/TTL renewal, background session touch, status snapshot persistence, admin backfill and visibility sync; award Lua alone is insufficient. Cleanup-only exact-owner removal remains permitted while blocked. Historical identifiers embedded in financial proofs are pseudonymous retained audit, not a new account's data.
- **FR-007**: New UUID, profile, wallet, handle allocation and sessions after hard deletion; no restored XP/streak/assets/roles. Pending deletion is not immediately re-registerable. No anti-farming block on signup itself.
- **FR-008**: Welcome cap three confirmed payouts per recognized verified normalized email without timeout; no rolling expiry/cooldown. Retain minimized proof for the justified program purpose, subject to approved GDPR rights handling and explicit historical-coverage limitations. Increment proof atomically with new ledger payout, never on signup, failure or replay.
- **FR-009**: Poker Daily at most one payout per identity/UTC day across all Poker Daily campaigns; `once` promotions at most one per identity/stable campaign ID. Keep amounts and active-account streak rules; recreated account starts fresh. Do not widen other policies.
- **FR-010**: Derive identity server-side from authoritative confirmed email, never editable metadata. Versioned HMAC, server-only access, purpose-bound retention and recognition-safe key lifecycle; no raw email, plain SHA, IP/device fingerprint or permanent tracking registry.
- **FR-011**: Privacy basis/purpose-bound retention, historical coverage, email normalization and deletion-request treatment require owner/privacy review before implementation. The plan is complete as a review package but these gates remain explicitly unresolved; do not silently select a lawful basis.
- **FR-012**: Fresh proof must work for password and Google-only users, bind old UUID/original session/purpose/request_id/challenge generation and expire after five minutes, single use. JWT `iat`, refresh and Google account selection alone are insufficient.
- **FR-013**: Bilingual accessible Danger Zone below account settings, cancel/focus handling, clear forfeiture and retention disclosures; pending/completed/incident states, including potentially more than two hours waiting_storage_expiry; not-before time is not a completion promise. JSP-compatible JS, one CSS selector per line, `klog`, CSP SHA updates when new inline scripts require them. No new packages/frameworks.
- **FR-014**: Fundamental deterministic backend/WS/ledger tests only. Future Stage destructive smoke, migrations and all deployments require separate task GO under the current explicit restriction; Production always separate GO. Never merge automatically.

## Key Entities

Deletion request and single-use proof; live USER account and retired USER financial identity; verified-email reward identity with minimal paid receipts. Details and constraints: [data-model.md](data-model.md). Interfaces: [contracts/account-deletion.md](contracts/account-deletion.md).

## Success Criteria

- **SC-001**: Every accepted request has a durable progress record; duplicate/restart tests produce one financial result and truthful status.
- **SC-002**: No new operation linearizes after confirmed suspension/accepted_at in concurrent HTTP/WS/SQL/Redis tests; SQL intent already denies new SQL/WS authorization while Redis preparation is retried; no old private subscriptions deliver after the barrier.
- **SC-003**: Opponent balances/pots and total ledger conservation hold for non-all-in/all-in/side-pot multi-table scenarios; former user's final wallet zero, USER closed, historical receipts replay safely.
- **SC-004**: Auth hard-delete/recreate yields a different UUID, independent data and rejects old JWT/WS/XP credentials. Same-email and Google-only flows both verified before release.
- **SC-005**: Concurrent/replayed welcome attempts cannot pay a fourth welcome reward without timeout for the same program; Daily/once identity uniqueness and UTC boundaries hold; unchanged policies retain baseline behavior.
- **SC-006**: Private proof records are inaccessible to anon/authenticated roles; program/campaign closure purge, Daily expiry, key continuity and rights handling match approved disclosure. No unnecessary personal data appears in logs or public status.

## Assumptions and review decisions

V1 recognizes verified normalized email, not a person; aliases/different addresses can evade it. Reauthentication transport feasibility, retention policy and legacy claim coverage are release blockers (research R5/R6). Reuse existing WS process and its janitor tick for durable progression, with startup scan; no new worker/cron/framework. Eventual completion assumes dependencies recover and the existing WS service is supervised; permanent faults require incident handling. See [research.md](research.md) for evidence and limitations.
