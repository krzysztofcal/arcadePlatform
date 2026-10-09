# Arcade Hub account deletion

Status: separate future-work implementation plan. This plan does not block the first Google, Facebook, and GitHub login release described in `docs/social-login-implementation-plan.md`. It does not authorize a migration, runtime change, secret, WS deployment, or production rollout by itself.

## Objective

Add a secure self-service account-deletion flow that removes or irreversibly anonymizes Arcade Hub user data according to an approved retention policy, preserves chips-ledger integrity, safely settles authoritative poker state, deletes Supabase Auth and all linked identities last, and retains the existing support procedure as a fallback.

The implementation must not begin with a deletion state machine or UI. Delivery starts with a complete user-data inventory, an owner-approved delete/anonymize/retain decision for every store, an approved chips/ledger policy, and a concrete service-to-service contract with the authoritative poker WS runtime.

## Non-goals and release relationship

- This feature is not a prerequisite for the first social-login release. Public PL/EN Privacy and Terms, `account-deletion.html`, verified manual requests through `contact@kcswh.pl`, ownership verification, and an executable support runbook are the OAuth production-readiness gate.
- This plan does not change Google, Facebook, or GitHub OAuth scopes, identity linking, callback handling, or provider-token policy.
- Do not implement direct browser access to service-role APIs, direct deletion of live poker seat rows, destructive rewriting of balanced chips entries, or an unbounded best-effort cleanup request.
- Provider-specific deletion callbacks are adapters to the same deletion service only when a current provider dashboard/review actually requires them. They do not define the core deletion model.

## Required invariants

1. The target account always comes from verified authentication or an independently verified support/provider request; the browser never supplies an authoritative `userId`.
2. A recent, explicit reauthentication and irreversible typed confirmation are required for self-service deletion.
3. No live poker stack, pot, or unsettled chips balance is discarded. Authoritative leave/cash-out completes before identity removal.
4. Chips accounting remains balanced and auditable. Retained ledger rows are anonymized under an approved policy rather than blindly cascaded.
5. External steps are idempotent and retryable. A timeout cannot cause double cash-out, double burn, duplicated deletion, or false completion.
6. Supabase Auth deletion is last. Earlier failures leave a frozen/recoverable account for retry or manual review.
7. Storage and Upstash cleanup is explicit; deleting a Postgres/Auth row is not treated as proof that objects or keys disappeared.
8. Normal product APIs cannot use retained/anonymized data to reconstruct the deleted profile.
9. Logs never contain raw email, provider subject, token, status capability, storage path, or unnecessary user UUID.
10. The manual support procedure remains available for lost-login, blocked, and manual-review cases.

## Phase 1 — complete user-data inventory

Do not design migrations or UI until this phase is reviewed.

### Deliverable

Create `docs/account-deletion-data-inventory.md` with one row for every user-linked table, object/key family, browser cache, log stream, backup, provider identity, and external processor. Each row must contain:

```text
store | schema/key pattern | identity field | FK/cascade behavior | data owner
purpose | sensitivity | current retention | proposed delete/anonymize/retain
blocking dependency | cleanup mechanism | retry/idempotency key | verification query
```

### Minimum inventory scope

- Supabase Auth: `auth.users`, linked identities, sessions, MFA/recovery data, and provider metadata managed by Supabase.
- Public Postgres: `user_profiles`, `profile_avatar_uploads`, `favorites`, bonus eligibility/claims, leaderboard visibility, chips accounts/transactions/entries, poker seats/requests/hole cards/actions/state JSON, and every later migration containing a user UUID, email, profile handle, avatar key, or identity-derived metadata.
- Supabase Storage: processed objects in `profile-avatars` and pending/source objects in `profile-avatar-uploads`, including orphan and missing-object behavior.
- Upstash/Redis: XP total/profile/session/daily/migration/rate keys, all-time/day/week/hidden leaderboard membership, registries, TTLs, and every dynamic key that cannot be derived from one bounded list.
- Authoritative poker WS memory and persistence: room membership, current hand, stack, pending leave, cached public profile, replay/request data, snapshot JSON, and reconnect state.
- Browser state: Supabase session storage plus identity-bound XP, favorites, profile, chips, poker, and pending OAuth/deletion records.
- Operations: KLog/Netlify/WS logs, alerts, exports, database backups, Storage backups/versioning if enabled, support records, CI artifacts, and provider dashboard records.
- External processors: Supabase, Upstash, Netlify, Google, Meta/Facebook, GitHub, and any later analytics/support processor actually receiving user-linked data.

### Repository touchpoints to verify

- `supabase/migrations/*.sql` for actual foreign keys, constraints, JSON fields, RLS, and cascade behavior.
- `netlify/functions/_shared/supabase-admin.mjs`, `user-profile.mjs`, `profile-avatar.mjs`, `store-upstash.mjs`, XP/leaderboard helpers, chips helpers, and poker persistence helpers.
- `ws-server/**` plus shared poker-domain modules for the authoritative owner of seat, stack, hand, and cash-out transitions.
- `js/auth/supabaseClient.js`, `js/account-page.js`, `js/xpClient.js`, favorites/profile clients, and poker browser state for local cleanup.
- `legal/privacy.pl.html`, `legal/privacy.en.html`, `legal/terms.pl.html`, `legal/terms.en.html`, and `account-deletion.html` for disclosure and support consistency.

Acceptance:

- every discovered identity field and dynamic key family has an owner and verification method;
- the inventory distinguishes database cascade from Storage/Redis/Auth deletion;
- unknown or unbounded key families are resolved before implementation, not hidden behind Redis `SCAN` or best-effort logging;
- the inventory records current behavior rather than assuming every `user_id` references `auth.users`.

## Phase 2 — approve delete/anonymize/retain policy

Convert the inventory into an owner/legal-approved data disposition matrix before writing a deletion migration.

### Required decisions

- For every row/store choose exactly one policy: immediate delete, irreversible anonymization, retain until a named deadline, or legally required hold. Record the reason and the user-facing disclosure.
- Define what happens to a positive, zero, or negative virtual chips balance. Choose a balanced burn/transfer/closure policy and identify the system account and transaction type used; do not silently zero a balance.
- Define which chips transactions and entries remain for ledger integrity, which identity columns/metadata are anonymized, and how idempotency/reference fields containing user UUIDs are handled without breaking reconciliation.
- Define poker history retention: delete private hole-card/current-hand data after settlement, and choose delete versus anonymize for action/history records and snapshots.
- Define retention and access restrictions for abuse/security logs, support records, provider records, backups, and restore procedures. Do not promise immediate physical removal from immutable backups unless operations can guarantee it.
- Define the deletion SLA, retry window, manual-review threshold, user status lifetime, and completion/refusal communications.
- Define support ownership verification for users who cannot reauthenticate, including evidence that support must never request a password or OAuth token.

Acceptance:

- no table/store remains marked `TBD`;
- the chips policy is validated against double-entry balance and sequence invariants;
- retained data cannot expose the public profile or remain usable as an active Arcade Hub account;
- PL/EN legal wording and the support runbook can accurately describe the approved outcomes and exceptions.

## Phase 3 — authoritative poker service-to-service contract

Agree and verify this contract before creating deletion workflow state.

### Proposed contract

Add an authenticated internal WS-service operation, with final names fixed during design review:

```text
prepareAccountDeletion({ requestId, userId })
  -> READY { settledAt }
  -> WAITING_FOR_HAND { retryAfterMs }
  -> RETRYABLE_ERROR { code }
  -> MANUAL_REVIEW { code }
```

- `requestId` is the idempotency key across Netlify and WS; repeating it returns the same completed settlement or current bounded status.
- Authentication is service-to-service with a rotated server secret or existing approved internal mechanism. The browser cannot call it directly.
- WS enumerates every authoritative room for the verified user, prevents new joins, performs the normal leave/cash-out transition at the approved safe boundary, persists the result, and only then returns `READY`.
- If the user is in a hand, behavior follows the Phase 2 decision: wait for a safe boundary or apply the existing explicit fold/leave rule. Direct SQL deletion of `poker_seats`, state JSON, or requests is forbidden while WS owns the room.
- A DB/WS disagreement returns a bounded error for reconciliation; the deletion worker does not guess which stack is authoritative.
- The operation must define timeout, retry, deploy-version compatibility, metrics, and rollback behavior. It must not log raw user UUID beyond any owner-approved internal correlation policy.

Acceptance:

- duplicate calls cannot produce duplicate cash-out or leave transitions;
- no ghost seat, stale reconnect membership, cached public profile, or unsettled stack remains after `READY`;
- old and new WS versions fail safely during rolling deployment;
- the contract has targeted behavior/contract coverage and passes `WS Preview Deploy` with a real stage exercise.

## Phase 4 — workflow, migrations, and cleanup adapters

This phase starts only after Phases 1–3 are approved.

### Files and methods

- Add `supabase/migrations/<timestamp>_account_deletion_workflow.sql` for private request/challenge/lease state, one active request per user, RLS denial for direct browser access, the approved chips-account detachment/anonymization constraints, and only the indexes justified by the inventory.
- Add `netlify/functions/account-delete-challenge.mjs` to create a short-lived, one-use challenge bound to the currently verified account. An automatically refreshed JWT is not recent reauthentication.
- Add `netlify/functions/account-delete-start.mjs` as authenticated `POST` only. Verify strict Origin/CORS, same-account completed challenge, typed confirmation, rate limit, and idempotency key; never accept a target UUID/email.
- Add `netlify/functions/account-delete-status.mjs` with a high-entropy capability that exposes only a controlled status and safe timestamps after the Auth session is gone.
- Add `netlify/functions/account-deletion-scheduled.mjs` using the existing scheduled-function pattern to lease a bounded batch. Do not rely on ordinary Netlify work continuing after its response.
- Add `netlify/functions/_shared/account-deletion.mjs::processAccountDeletion(requestId, deps)` and small store-specific adapters. Persist completed steps, use closed error codes, and move exhausted failures to `MANUAL_REVIEW`.
- Add a bounded `deleteUserXpData(userId)` using a per-user registry or approved retention-window key list. Never use unbounded Redis `SCAN` in the request path.
- Reuse the Storage service-role patterns from `netlify/functions/_shared/profile-avatar.mjs`; missing objects are idempotent success and service outage is retryable.
- Add the server-only Supabase Auth Admin deletion helper. The service-role key never enters browser config, logs, or status output.

### State machine and order

```text
QUEUED -> BLOCKED_POKER | PROCESSING -> RETRYABLE_ERROR | MANUAL_REVIEW | COMPLETED
```

Processing order:

1. Verify request and freeze only the mutations identified by the approved inventory/policy.
2. Obtain authoritative poker `READY` through Phase 3.
3. Settle/close/anonymize chips in one approved ledger transaction.
4. Remove bounded Upstash XP and every leaderboard membership.
5. Remove pending and processed avatar objects before their lookup rows disappear.
6. Delete or anonymize remaining Postgres product data according to the matrix.
7. Delete the Supabase Auth user and all linked identities last.
8. Scrub the request's user identifier, mark `COMPLETED`, retain only the opaque status record for the approved lifetime, and expire it.

Acceptance:

- retry after failure at every external boundary is safe and cannot report false completion;
- a failed pre-Auth step leaves the account recoverable for retry/support;
- completed deletion passes every inventory verification query without breaking chips-ledger balance;
- status and KLog contain no raw identity, provider subject, token, storage path, or plaintext status capability.

## Phase 5 — self-service UI and support fallback

- Update `js/auth/supabaseClient.js` with a deletion-specific reauthentication flow. Password and OAuth reauthentication must complete a server challenge and return the same verified `sub`; a different account invalidates the challenge.
- Update the existing control in `account.html` into a localized danger zone with consequences, typed confirmation, reauthentication, pending/manual-review status, and the public support fallback.
- Update `js/account-page.js` with `startAccountDeletion()`, bounded status polling, and `clearDeletedAccountState()`. On completion, clear the SDK session and identity-bound XP/favorites/profile/chips/poker/OAuth/deletion browser state, then render anonymously.
- Update `js/i18n.js` and owner-approved PL/EN legal text. Keep `account-deletion.html` public and useful without login for support requests and status guidance.
- Do not infer the current login provider from `identities`. Offer only configured/linked methods suitable for explicit reauthentication, and enforce the same-`sub` comparison server-side.

Acceptance:

- password-only, each enabled OAuth provider, and linked multi-identity disposable accounts can complete deletion;
- cancellation never starts deletion, stale tabs cannot resume mutations, and another account cannot satisfy the challenge;
- inaccessible, blocked, or manual-review users receive the verified support route without being asked for credentials;
- UI copy distinguishes queued, blocked, retrying, manual-review, and completed states and does not promise immediate removal from approved retained backups/logs.

## Testing and rollout

Add only critical coverage to the closest existing auth, chips, poker, Storage, and Upstash suites:

- authorization, Origin, recent-reauthentication, same-account binding, idempotency, and capability secrecy;
- authoritative poker wait/settle/retry behavior and no double cash-out;
- chips balance/entry-sequence invariants and approved anonymization;
- bounded XP/leaderboard and Storage cleanup;
- Auth-deletion-last ordering, partial-failure retry, lease recovery, and manual-review transition;
- inventory verification queries for a disposable completed account.

Do not add tests for CSS or simple DOM glue. Run repository checks, migration validation, WS checks, `WS Preview Deploy`, and a real stage exercise with disposable password/OAuth accounts before production. Roll out behind an owner-approved server flag, monitor aggregate status/error/latency only, and keep the manual support path operational throughout rollback.

## Codex versus owner responsibilities

| Work item | Codex can implement after approval | Owner must decide/perform |
| --- | --- | --- |
| Inventory | Trace schema, stores, keys, processors, browser caches, logs, and verification queries | Confirm external processors, backup/support systems, and completeness |
| Data policy | Encode approved delete/anonymize/retain rules | Approve legal basis, retention, SLA, chips disposition, ledger/poker history policy |
| Poker contract | Implement and verify the approved service-to-service protocol | Approve active-hand behavior, credentials/rotation, rollout timing |
| Workflow | Migrations, endpoints, scheduler, adapters, idempotency, retries, diagnostics | Approve production migration and feature enablement |
| UI | Reauthentication, danger zone, status, cache/session cleanup, PL/EN wiring | Approve destructive copy, screenshots, support escalation |
| Support/legal | Publish repository pages after approved copy is supplied | Own mailbox, identity verification, manual runbook, exceptions, completion records |

## Breaking and operational impact

- Requires database migrations and changes to the chips-account deletion/anonymization contract.
- Adds irreversible authenticated API behavior, scheduled processing, service-role Auth deletion, Storage/Upstash cleanup, and operational manual-review queues.
- Requires a versioned internal poker contract and likely WS/shared runtime changes; `WS Preview Deploy` is mandatory for that implementation.
- May require new server-only internal secrets/flags. None may be public build config.
- Does not require provider image domains or provider access tokens. CSP changes are not expected unless implementation introduces inline/browser resources outside this plan.
- Log/dashboard correlation must use opaque request/status codes rather than raw user identity.

## Definition of done

- The inventory and per-store disposition matrix are complete and owner/legal approved.
- Chips balance/ledger and poker history policies are explicit, implemented, and reconciliation-safe.
- The authoritative poker contract is idempotent, stage-verified, and cannot leave a stack or ghost seat.
- Every external cleanup step is bounded, retryable, independently verifiable, and safe after partial completion.
- Auth and all linked identities are deleted last; retained data is irreversibly anonymized and inaccessible to normal product flows.
- Password, OAuth, linked-identity, lost-login support, retry, and manual-review flows are verified with disposable accounts.
- Public PL/EN deletion instructions and the support runbook remain available regardless of self-service status.
- Required migrations, repository checks, WS checks, WS Preview Deploy, stage verification, legal approval, and owner production decision are complete.

## Owner decisions before implementation

1. Approve the complete inventory and identify any external store not visible in this repository.
2. Approve delete/anonymize/retain and retention duration for every inventory row, including logs and backups.
3. Approve remaining-chips disposition and the exact ledger anonymization/reconciliation policy.
4. Approve poker active-hand behavior, retained history policy, and the service-to-service authentication/rollout contract.
5. Approve recent-reauthentication behavior for password, OAuth, and linked accounts.
6. Approve deletion SLA, retry/manual-review thresholds, status retention, and support communications.
7. Approve migrations, server flags/secrets, stage deletion exercise, and production enablement only after the earlier decisions are recorded.

