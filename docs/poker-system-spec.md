# Poker System Spec (WS migration PR0)

Status: source-of-truth for WS poker functional requirements and boundaries.  
Scope of this document: functional requirements and invariants only (documentation, no runtime contract changes).

Related documents:
- WS protocol and envelope details: [docs/ws-poker-protocol.md](./ws-poker-protocol.md)
- Funds-safety and sweep notes: [docs/poker-deployment.md](./poker-deployment.md)
- Bots runtime behavior reference: [docs/poker-bots.md](./poker-bots.md)
- Hole-cards normalization and validation behavior: [docs/poker-hole-cards-normalization.md](./poker-hole-cards-normalization.md)

## Scope and boundaries

- WS core engine scope:
  - realtime gameplay loop,
  - stateful table progression,
  - server-authoritative command validation and turn resolution,
  - reconnect/resync orchestration under the WS protocol.
- Serverless scope:
  - ledger/economy primitives,
  - authentication and identity,
  - operational jobs/endpoints (including sweep trigger),
  - non-poker platform functions.
- Source-of-truth boundaries:
  - Seat occupancy and lifecycle are authoritative in `public.poker_seats`.
  - Escrow movement authority is ledger transaction history (`TABLE_BUY_IN`, `TABLE_CASH_OUT`).
  - Stack authority:
    - Authoritative (active gameplay): `poker_state.state.stacks`.
    - Authoritative (seat snapshot): `public.poker_seats.stack`.
    - Gameplay decisions use `poker_state.state.stacks`; `public.poker_seats.stack` is the persisted snapshot for join/lobby/seat validation and recovery/reconciliation starting state.
    - Synchronization is required at lifecycle boundaries (join, leave/cash-out, hand end/settlement, sweep cleanup).

## Actors

- Human player: authenticated user controlling a seat.
- Bot player: runtime-controlled seat participating under bot policy constraints.
- System/scheduler: operational actor invoking maintenance (especially sweep cleanup/timeouts).

## Data model (conceptual)

- `poker_tables`: table identity, blinds/config, lifecycle metadata.
- `poker_seats`: per-table seats; includes seat status, occupant identity, and persisted snapshot `stack`.
- `poker_state`: current hand/table JSON state, including authoritative active gameplay stacks.
- `poker_actions`: append-only action/event trail for gameplay and diagnostics.
- `poker_hole_cards`: private per-user hand cards for active hands.

Authoritative vs derived/cache:
- Authoritative:
  - `poker_state.state.stacks` during active gameplay.
  - `public.poker_seats.stack` as the persisted seat snapshot (must not be `NULL` after successful join).
  - ledger entries for buy-in/cash-out flows.
- Derived/cache:
  - Non-stack JSON projections/materializations used for transport/read optimization.
- Stack synchronization rule:
  - If both stack stores are present, gameplay decisions are driven by `poker_state.state.stacks`.
  - `public.poker_seats.stack` must be synchronized at lifecycle boundaries (join, leave/cash-out, hand end/settlement, sweep cleanup) and must not contradict funds-safety outcomes.

## Invariants (non-negotiable)

1. Funds safety invariant
   - Each buy-in must move chips USER → ESCROW via `TABLE_BUY_IN`.
   - Each leave/timeout must move chips ESCROW → USER via `TABLE_CASH_OUT`.
   - Sweep is required as a safety path so no chips remain stranded in escrow.

2. Idempotency invariant
   - Mutating requests are idempotent by scoped request identity (conceptually `(actor, table/room, command, requestId)`).
   - Replays/duplicates must not apply state mutation more than once.

3. Determinism/validation invariant
   - Hole-cards loader normalization rule:
     - array input: pass through,
     - string input: `JSON.parse`, then accept only if parsed result is an array.
   - Strict validation remains mandatory; malformed/non-array cards remain invalid and surface as `state_invalid`.

4. Reconnect privacy/safety invariant
   - Reconnect/resync must never leak private game state (including hole cards) to non-owning users.
   - Resync requires client replacement of speculative state with authoritative snapshot.

## Functional requirements (MVP for WS engine)

These requirements align with the protocol sections for envelope, errors, idempotency, reconnect/resync, and versioning in [docs/ws-poker-protocol.md](./ws-poker-protocol.md).

1. Connect + `hello`
   - Given a new socket connection,
   - When client sends `hello` with supported protocol versions,
   - Then server negotiates/acknowledges a supported version or returns protocol error for unsupported versions.

2. `auth`
   - Given a connected client,
   - When client sends valid `auth`,
   - Then server binds identity and room access before permitting mutating gameplay commands.

3. `join_table` / `join`
   - Given authenticated user and available seat,
   - When client sends join with seat and buy-in intent,
   - Then join succeeds only if funds path and seat preconditions are valid, and authoritative seat snapshot stack is persisted (`public.poker_seats.stack` non-`NULL`).

4. `leave_table` / `leave`
   - Given seated player (human or bot seat flow),
   - When leave/timeout resolves,
   - Then table escrow chips are returned with `TABLE_CASH_OUT` and seat state is updated for consistent cleanup/rejoin behavior.

5. `table_state` snapshot after join/reconnect
   - Given successful join or reconnect/resync,
   - When server emits state snapshot,
   - Then client receives authoritative table state with private fields scoped to owning player only.

6. `act`
   - Given authenticated player with turn eligibility,
   - When client submits `act`,
   - Then server validates legality against authoritative state and applies exactly one deterministic result per idempotency scope.

7. `ping` / `pong`
   - Given active connection,
   - When client sends `ping`,
   - Then server responds with `pong` without mutating game state.

8. `resync` (reconnect/resync flow)
   - Given reconnect with sequence/session mismatch or replay-window gap,
   - When continuity cannot be guaranteed,
   - Then server requires resync and provides full snapshot; client discards speculative local state and adopts snapshot.

## Bots requirements

- Bot runtime participation is gated by `POKER_BOTS_ENABLED`.
- Bot configuration source is `getBotConfig`.
- Max bots per table is `POKER_BOTS_MAX_PER_TABLE` (default `2`).
- Bot seeding requires at least one active human at the table.
- Seat-capacity policy must keep at least one seat available for humans.
- Bot autoplay is allowed only under bot-turn and policy/runtime guard conditions; details remain implementation-specific.
- Integration points and behavior coverage are defined by current runtime/tests reference in [docs/poker-bots.md](./poker-bots.md).

## Operational requirements

- Sweep endpoint must be protected by shared secret (`POKER_SWEEP_SECRET`) as an operational security requirement.
- WS engine must preserve data consistency needed by cleanup:
  - coherent seat status transitions,
  - synchronized stack persistence at lifecycle boundaries,
  - reconcilable timeout/leave states enabling deterministic sweep cash-out.

## Out of scope (explicit)

- IaC, infrastructure provisioning, and monitoring implementation.
- Frontend UX redesign.
- Payments, XP, and portal-level product features.

## Glossary

- escrow: table-held chips balance between buy-in and cash-out ledger operations.
- stack: player chip amount available at table; authoritative for gameplay in `poker_state.state.stacks`, with persisted seat snapshot in `public.poker_seats.stack`.
- seat: table position and occupancy record in `poker_seats`.
- table_state: runtime game state representation returned to clients.
- derived state: computed/cached representation that is not the canonical source for gameplay decisions.
- authoritative state: canonical persisted values used for correctness decisions.
- resync: forced full-state replacement when incremental continuity is not safe.
- idempotency scope: key space ensuring retried mutating commands are applied at most once.
