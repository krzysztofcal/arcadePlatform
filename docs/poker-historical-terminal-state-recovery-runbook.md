# Poker historical terminal-state recovery runbook

## Metadata

- Issue: `#748`
- Recovery stage: `Runbook C`
- Baseline `origin/main`: `79b5c92c035554dd83920038a7618c31e226ae1e`
- Prepared: `2026-07-24`
- Scope: historical persisted poker tables created before the `SETTLED` bootstrap guard and stale live-hand cancellation refund
- Runtime changes in this PR: none
- Schema changes in this PR: none

## Purpose

Use this runbook only for a persisted poker table which remains open because terminal accounting is fail-closed.

PR A prevents a join during `SETTLED` from replacing conserved state through generic bootstrap. PR B allows a conserved stale live hand to close by refunding each participant's authoritative stack plus own contribution. Neither change invents ownership for a historical state which was already persisted with claims below escrow.

This runbook answers two different operational cases:

1. A conserved live hand can now be closed through the normal janitor or existing admin cleanup path.
2. A corrupt historical `SETTLED` hand remains blocked until its ownership can be proven or disposable Preview data is reset through an approved environment reset.

The runbook does not authorize adding the unexplained difference to a player, bot, treasury account, stack, pot, or claim.

## Safety rules

- Treat WS runtime state as authoritative while a table is loaded and persisted `poker_state` as recovery authority after restart.
- Treat `poker_seats.stack` and public stack projections as secondary data.
- Keep `terminal_claims_mismatch` fail-closed.
- Never run recovery while a socket, WS runtime, janitor, or admin action may mutate the same table.
- Do not use `force_close` to bypass an invariant. The existing endpoint calls the same terminal accounting guard and must fail for an inconsistent table.
- Do not post a compensating ledger transaction before ownership is proven.
- Do not directly edit escrow balance, transaction rows, ledger entries, action audits, or idempotency records.
- Do not log or paste private cards, full state, tokens, secrets, or connection strings.
- Use `klog` for any future operational diagnostics.
- Require explicit approval for each `tableId` and environment. Approval for Preview does not authorize production.

## Required information

Record the following before taking an action:

- environment and Supabase project ref;
- deployed WS SHA;
- table ID;
- table status and last activity;
- persisted state version, phase, hand ID and update time;
- stack total;
- canonical `potTotal`;
- contribution total;
- side-pot total, when present;
- escrow account ID, balance and status;
- active and inactive seats with human/bot classification;
- last conserved settlement version;
- accepted actions after that version in state-version order;
- settlement audit count;
- table cash-out transactions and idempotency keys;
- current janitor classification and failure reason.

Do not copy private hole cards into an issue or runbook record. Record only whether the required private runtime material exists for a deterministic replay.

## Phase 1 — isolate and collect evidence

### 1. Confirm the deployed runtime

For WS Preview:

```text
sudo systemctl is-active ws-server-preview.service
sudo grep -E '"releaseSha"|"deployRef"|"environment"' /opt/arcade-ws-preview/ws-server/release-metadata.json
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS https://ws-preview.kcswh.pl/healthz
```

For production:

```text
sudo systemctl is-active ws-server.service
sudo grep -E '"releaseSha"|"deployRef"|"environment"' /opt/arcade-ws/ws-server/release-metadata.json
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS https://ws.kcswh.pl/healthz
```

If paths or local ports differ, resolve them from the corresponding systemd unit. Do not guess.

### 2. Capture table-specific logs

Replace `TABLE_ID` and the time range with explicit values:

```text
sudo journalctl -u ws-server-preview.service --since 'YYYY-MM-DD HH:MM:SS' --until 'YYYY-MM-DD HH:MM:SS' --no-pager -o short-iso-precise | grep 'TABLE_ID'
```

Production uses `ws-server.service`.

Evidence must include, when present:

- `ws_table_janitor_classified`;
- `poker_inactive_cleanup_stale_live_hand_closing`;
- `poker_terminal_accounting_invariant_failed`;
- `poker_terminal_accounting_closed`;
- `ws_state_persist_start`;
- `ws_hand_settlement_audit_written`;
- `ws_settled_rollover_*`;
- admin cleanup results.

### 3. Read the persisted snapshot

Use the read-only Admin table details/evaluation UI or equivalent authenticated read-only endpoints first. If SQL is required, run it in the correct Supabase project using a read-only transaction or the SQL editor. Query only the explicit table and its escrow key.

Minimum relations:

- `poker_tables`;
- `poker_state`;
- `poker_seats`;
- `poker_actions`;
- `poker_requests`;
- `chips_accounts`;
- `chips_transactions`;
- `chips_entries`.

Do not execute an update in this phase.

### 4. Compute the conservation equations

Use overflow-safe integer arithmetic and record:

```text
stackTotal = sum(state.stacks)
contributionTotal = sum(state.contributionsByUserId)
liveClaimTotal = stackTotal + contributionTotal
settledClaimTotal = stackTotal
```

For an action phase, require:

```text
contributionTotal == canonical potTotal
liveClaimTotal == escrow balance
```

For `SETTLED`, require:

```text
canonical potTotal == 0
settledClaimTotal == escrow balance
```

When both `pot` and `potTotal` exist, they must normalize to the same value. Side pots must not contradict the canonical total.

## Phase 2 — classify the table

### Class A — conserved stale live hand

All conditions must hold:

- phase is `PREFLOP`, `FLOP`, `TURN`, or `RIVER`;
- stacks and contributions are valid non-negative integer maps;
- every positive claim has an unambiguous human or bot seat identity;
- contributions equal the canonical pot;
- stacks plus contributions equal escrow;
- no connected human presence remains;
- the existing janitor classifies the table for stale cleanup.

This is the PR B path. It does not require historical state repair.

### Class B — conserved settled or inert hand

All conditions must hold:

- phase is `SETTLED` or an existing terminal/inert phase;
- unresolved canonical pot is zero;
- stack claims equal escrow;
- identities and bot funding provenance are unambiguous.

Use the existing terminal close path. Do not add historical contributions to settled claims.

### Class C — corrupt historical state

Any one of these conditions is sufficient:

- settled stack claims do not equal escrow;
- live contributions do not equal the canonical pot;
- live stacks plus contributions do not equal escrow;
- pot fields or side pots contradict each other;
- a claimant cannot be mapped unambiguously;
- bot funding provenance is incomplete;
- the last conserved version cannot be established.

Keep the table fail-closed. Do not run cash-out or force-close repeatedly.

### Class D — insufficient evidence

Use this class when a state might be replayable but required actions, private runtime material, seed, version ordering, identities, or ledger history are incomplete.

Treat Class D exactly like Class C until the missing evidence is recovered.

## Phase 3 — approved action

### Class A: use normal cleanup

1. Verify the running WS contains PR B or a later `main`.
2. Ensure the table is not loaded by an active socket and no human presence remains.
3. Allow the existing stale-seat/open-table janitor to evaluate it, or invoke the existing authenticated admin `reconcile`/applicable cleanup action once with a unique idempotency key.
4. Do not call an internal terminal-close function directly.
5. Verify the result before invoking another action.

Expected terminal policy:

```text
claimPolicy = live_hand_cancellation_refund
claim(user) = authoritative stack + own contribution
contributionTotal = canonical potTotal
sum(claims) = escrow before close
```

Expected outcome:

- exactly one `poker_terminal_accounting_closed`;
- one cash-out for each positive claim;
- unique ledger idempotency keys;
- escrow zero;
- table `CLOSED`;
- all seats inactive;
- inert persisted state;
- no `HAND_SETTLED` audit for the cancelled hand;
- later janitor triggers are no-ops.

If any invariant fails, stop and reclassify the table as Class C. Do not retry with changed data.

### Class B: use existing terminal close

Use only the existing authenticated admin action applicable to the table. A `force_close` request is acceptable only when preflight already proves stack claims equal escrow; it does not grant permission to bypass the accounting guard.

Verify the same idempotency, zero-escrow, closed-table, inactive-seat and no-duplicate conditions as for Class A.

### Class C or D in WS Preview

Preview data may be disposable, but the accounting evidence is not.

1. Save the evidence bundle and record the explicit table ID and known mismatch.
2. Confirm that the table is Preview/stage data by checking the Supabase project ref and environment context.
3. Obtain approval to reset the affected Preview economy data.
4. Prefer the existing environment-level procedure in `docs/ch-economy-reset-runbook.md` when a clean Preview reset is acceptable.
5. Do not improvise a targeted delete which leaves orphan escrow, ledger, request, seat, state, or action rows.
6. After reset, verify account conservation, no orphan escrow, no closed-table residual and healthy Admin poker estate metrics.

If an environment-level reset is not acceptable, leave the table blocked. This runbook deliberately provides no targeted destructive SQL because the repository does not currently contain a proven per-table rollback procedure for a corrupt settled ledger state.

### Class C or D in production

Do not reset or delete the table.

Create a per-table recovery record containing the full evidence bundle and obtain accounting-owner approval. A deterministic replay proposal must prove all of the following before implementation:

- the last conserved persisted/settled version;
- exact accepted actions after that version, in order;
- deterministic hand IDs and seeds;
- availability and integrity of required private runtime material;
- exact settlement results for every replayed hand;
- unchanged ledger and escrow history;
- stable human/bot identity and bot funding provenance;
- a final conserved state whose claims equal escrow.

Only a separately reviewed one-off tool may apply a replayed state. It must:

- accept an allowlist of explicit table IDs;
- default to read-only dry run;
- require the expected current state version and state fingerprint;
- lock the table, state, seats and escrow using existing transaction/locking patterns;
- abort if any fingerprint, version, escrow, identity or audit value changed;
- persist one corrected state with an audit record;
- release the transaction before normal terminal close is invoked through the existing path;
- remain idempotent;
- never synthesize the missing amount or modify past ledger rows.

The one-off tool and its execution require a separate PR and approval. They are not authorized by this documentation PR.

If deterministic replay cannot prove ownership, keep the table blocked for manual accounting review.

## Phase 4 — verification checklist

For every executed Class A or B recovery, record:

- [ ] exact environment and WS SHA;
- [ ] explicit table and hand IDs;
- [ ] preflight state version and phase;
- [ ] stack, contribution, pot, side-pot and escrow totals;
- [ ] selected recovery class and approver;
- [ ] one terminal close;
- [ ] expected and actual cash-out count;
- [ ] expected and actual aggregate claim total;
- [ ] unique cash-out idempotency keys;
- [ ] no duplicate ledger movement;
- [ ] no normal settlement for a cancelled live hand;
- [ ] escrow exactly zero;
- [ ] table `CLOSED`;
- [ ] all seats inactive;
- [ ] inert state persisted;
- [ ] later janitor trigger produces no mutation;
- [ ] no table-specific `ws_table_janitor_*failed`;
- [ ] no table-specific unexpected `poker_terminal_accounting_invariant_failed`;
- [ ] local and public `/healthz` healthy.

Representative verification command:

```text
sudo journalctl -u ws-server-preview.service --since 'YYYY-MM-DD HH:MM:SS' --no-pager -o short-iso-precise | grep 'TABLE_ID' | grep -E 'poker_terminal_|ws_table_janitor_|ws_hand_settlement|persist_conflict|runtime_error'
```

## Known issue #748 examples

### `ec3f4897-c7bb-4d92-b63d-a38401e9a5c4`

Historical evidence showed a conserved `PREFLOP` state:

```text
stackTotal = 590
contributionTotal = potTotal = 10
escrow = 600
```

After PR B this table qualifies for Class A only if a fresh read-only preflight still proves those values and identities. Do not rely solely on the historical report.

### `7af59a48-5804-4c78-b8c3-d81e5e721d6c`

Historical evidence showed a corrupt `SETTLED` state:

```text
settled stack claims = 585
potTotal = 0
escrow = 600
unexplained difference = 15
```

The last known conserved settled version was 85 with total 600. Generic bootstrap then persisted version 86 from a non-authoritative projection, and later hands conserved only 585.

This table is Class C unless a fresh deterministic replay proves otherwise. Do not:

- add 15 CH to the human;
- spread 15 CH across bots;
- move 15 CH to treasury;
- reduce escrow to 585;
- force close around the invariant.

For Preview, preserve evidence and use an approved environment reset when appropriate. For production, leave it blocked until a separately reviewed deterministic replay or accounting decision exists.

## Rollback and incident response

- Documentation has no runtime rollback.
- A successful existing terminal close is ledger-idempotent and should not be reversed ad hoc.
- If an approved action partially appears to execute, stop all further attempts and inspect the transaction, entries, escrow and request idempotency record before doing anything else.
- If duplicate movement, non-zero residual escrow, or chip-conservation failure is observed, treat it as an accounting incident and do not compensate manually.

## Out of scope

- automatic repair of corrupt historical state;
- weakening terminal conservation;
- generic replay or cache framework;
- direct mutation of historical ledger rows;
- caching poker state, balances or ledger data;
- changing normal settlement or winner selection;
- changing reconnect, stale thresholds, janitor cadence or coalescing;
- broad poker architecture refactoring.

## Notes

- This runbook covers critical realtime poker and ledger accounting.
- Prefer no action over an unproven ownership assignment.
- Reuse existing admin actions, terminal close, idempotency and environment-reset procedures.
- No browser JavaScript, JSP, CSS or CSP change is included.
- Any future browser script must remain JSP-compatible and update the CSP SHA.
