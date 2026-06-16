# WS Poker Protocol v1

Status: Draft (PR0 contract).  
Scope: Persistent WebSocket poker room protocol only. No runtime behavior is implemented by this document.

## System context

For WS engine responsibilities, data ownership, and cross-cutting invariants (funds safety, bots, sweep, hole-cards normalization), see [docs/poker-system-spec.md](./poker-system-spec.md). This protocol document remains the wire-contract source for envelopes, message types, idempotency, reconnect/resync, and versioning.

For practical token minting and manual `wscat` auth testing, see [docs/ws-auth-token-mint.md](./ws-auth-token-mint.md).

## Envelope

All frames MUST be UTF-8 JSON objects with the envelope below.

| Field | Direction | Type | Required | Constraints | Notes |
|---|---|---|---|---|---|
| `version` | c→s, s→c | string | yes | exact `"1.0"` for v1 | Protocol major/minor declaration. |
| `type` | c→s, s→c | string | yes | `^[a-z][a-z0-9_.-]{1,63}$` | Message kind. |
| `requestId` | c→s, s→c | string | required for all client commands; optional for server events | UUID v4 string, max 64 chars | Idempotency key and correlation id. |
| `roomId` | c→s, s→c | string | required after successful auth | 1..64 chars | Logical poker room/table id. |
| `sessionId` | c→s, s→c | string | optional | 1..128 chars | Server-issued connection/session handle used for resume. |
| `seq` | s→c | integer | required for stateful server events | `>= 1` monotonic per room | Stream sequence for replayable state events (`table_state`, `stateSnapshot`, `statePatch`) and resume gap detection. |
| `ts` | c→s, s→c | string | yes | RFC 3339 UTC timestamp | Producer timestamp. |
| `payload` | c→s, s→c | object | yes | max serialized frame 32 KB | Message-specific body. |

Frame size limit: 32 KB hard limit per message. Messages above limit MUST be rejected with `error.code = "FRAME_TOO_LARGE"`; server MAY close with 1009.

Example envelope:

```json
{
  "version": "1.0",
  "type": "ping",
  "requestId": "4d3b2e3e-f4c6-4e53-b8d2-e2f95b763f8d",
  "roomId": "table_100_200",
  "sessionId": "sess_01JZ9VYQH8R9M8M5TQ2J4K8H3Z",
  "ts": "2026-02-28T10:15:30Z",
  "payload": {
    "clientTime": "2026-02-28T10:15:30Z"
  }
}
```

## Message types

### Client → Server

| Type | Payload schema (required fields) | Semantics |
|---|---|---|
| `hello` | `{ "supportedVersions": string[], "client": { "name": string, "build": string } }` | Opens protocol negotiation. First command after socket open. |
| `auth` | `{ "token": string }` | Authenticates identity and room access. No table mutation allowed. |
| `resume` | `{ "sessionId": string, "lastSeq": integer }` | Requests stream resume from last acknowledged sequence. |
| `ping` | `{ "clientTime": string }` | Keepalive/latency probe. No state mutation. |
| `join` | `{ "tableId": string }` | Legacy alias of `table_join`; default runtime behavior is authoritative seat/join mutation (idempotent). Optional observe-only runtime mode can make it transport-only. Requires auth. |
| `act` | `{ "handId": string, "action": "fold"|"check"|"call"|"bet"|"raise", "amount": integer }` | Requests poker action mutation. Requires auth and turn validity. |
| `leave` | `{ "reason": string }` | Requests leave/cashout workflow. |
| `ack` | `{ "seq": integer }` | Acknowledges latest processed server sequence (flow-control aid). |
| `table_snapshot` | `{ "tableId": string }` (or envelope `roomId`) | Protected read-only gameplay snapshot command. **Requires `requestId`** like other stateful protected commands. Returns viewer-scoped poker state and does not mutate presence membership. |

### Server → Client

| Type | Payload schema (required fields) | Semantics |
|---|---|---|
| `helloAck` | `{ "version": "1.0", "sessionId": string, "heartbeatMs": integer }` | Confirms negotiated version and returns initial session id. Activity lifecycle is WS connection driven; HTTP poker heartbeat is retired. |
| `authOk` | `{ "userId": string, "roomId": string, "permissions": string[] }` | Auth success event. |
| `pong` | `{ "clientTime": string, "serverTime": string }` | Ping response. |
| `stateSnapshot` | `{ "stateVersion": integer, "table": object, "you": object, "public": object, "private"?: object }` | One-shot room-core snapshot for `table_state_sub` snapshot mode; does not subscribe socket to legacy `table_state` broadcasts. |
| `statePatch` | `{ "stateVersion": integer, "patch": object }` | Incremental room state update. |
| `table_snapshot` | `{ "tableId": string, "state": { "version": integer, "state": object }, "myHoleCards": array, "legalActions": string[], "actionConstraints": object, "viewer": object }` | Read-only gameplay snapshot response for `table_snapshot` command. Distinct from presence `table_state`. |
| `commandResult` | `{ "requestId": string, "status": "accepted"|"rejected", "reason": string|null }` | Deterministic outcome for a client command. |
| `resync` | `{ "mode": "required", "reason": string, "expectedSeq": integer }` | Signals that client must request/accept full snapshot. |
| `error` | `{ "code": string, "message": string, "retryable": boolean, "requestId": string|null }` | Protocol or domain error (see Errors). |

Minimal server-initiated events in v1 include: `error`, `resync`, `pong`, and state updates (`stateSnapshot`/`statePatch`).

Examples:

```json
{
  "version": "1.0",
  "type": "hello",
  "requestId": "29f8bc4f-8a65-4a71-b53b-a4a0f2550e41",
  "ts": "2026-02-28T10:16:00Z",
  "payload": {
    "supportedVersions": ["1.0"],
    "client": {
      "name": "arcade-web",
      "build": "2026.02.28"
    }
  }
}
```

```json
{
  "version": "1.0",
  "type": "resync",
  "requestId": "resume-req-1",
  "roomId": "table_100_200",
  "sessionId": "sess_01JZ9VYQH8R9M8M5TQ2J4K8H3Z",
  "ts": "2026-02-28T10:16:05Z",
  "payload": {
    "mode": "required",
    "reason": "last_seq_out_of_window",
    "expectedSeq": 187
  }
}
```



### Presence vs gameplay snapshot contract

- `table_state` remains the **presence-only** WS membership frame with payload `{ tableId, members }`.
- New `table_snapshot` is the gameplay snapshot command/response path and MUST NOT overload `table_state`.
- `table_snapshot` is WS-native snapshot/resync payload shaping (state normalization + private-state stripping + viewer-scoped `myHoleCards`) and does not depend on HTTP `poker-get-table`.
- `table_snapshot` deterministic error messages are limited to known contract/state codes (`table_not_found`, `state_missing`, `state_invalid`, `contract_mismatch_empty_legal_actions`); unknown backend/storage failures collapse to `snapshot_failed`.

### table_join / join contract (authoritative seat lifecycle boundary)

`table_join` (and legacy alias `join`) is a seat/join command by default:

- Loads/attaches the socket to the table stream and returns current `table_state`.
- In default runtime mode, applies authoritative WS join semantics (seat-bearing membership mutation) when allowed by room constraints.
- Is idempotent for repeated calls from the same authenticated socket/user/table.

Optional runtime mode: deployments may explicitly enable observe-only `table_join` via server config (`WS_OBSERVE_ONLY_JOIN=1`). In that mode, `table_join` is transport-level connect/observe/resync for non-seated users and does not allocate seats.

Authoritative seat acquisition/buy-in remains server-authoritative, and browser gameplay runtime MUST use WS as the only write path for `table_join`/`join`, `leave`, `start_hand`, and `act`.

Table runtime policy is strict: `/poker/table-v2.html` MUST be 100% WS-only for active gameplay state (bootstrap + refresh + resync). The browser runtime MUST NOT use `poker-get-table`, `poker-heartbeat`, or any gameplay HTTP read fallback.

The HTTP gameplay endpoints (`poker-join`, `poker-heartbeat`, `poker-get-table`, `poker-start-hand`, `poker-act`, `poker-leave`, `poker-sweep`) are retired and return explicit non-authoritative errors (`410`) instead of mutating or sourcing live gameplay state.

`leave` remains authoritative for already-seated users: when the authenticated user is an authoritative table member, WS `leave` executes authoritative member removal/cashout semantics in both default and observe-only runtime modes.

Authoritative leave success-shape validation is strict: if backend authoritative state still contains the leaving user in `state.seats`, WS MUST reject the command as `commandResult.status = "rejected"` with `reason = "authoritative_state_invalid"`, and MUST NOT emit fabricated membership mutation broadcasts to observers.

### Table state membership snapshot (runtime compatibility)

`table_state` frames emitted by the current runtime use:

- `payload.tableId: string`
- `payload.members: Array<{ userId: string, seat: number }>`

Membership snapshot semantics:

- Sorted by `seat` ascending, then `userId` ascending for stability.
- Connected-only projection: members are derived from core membership intersected with active presence.
- No duplicates.

Example `table_state` frame:

```json
{
  "version": "1.0",
  "type": "table_state",
  "requestId": "req-table-join-1",
  "roomId": "table_100_200",
  "sessionId": "sess_01JZ9VYQH8R9M8M5TQ2J4K8H3Z",
  "seq": 42,
  "ts": "2026-02-28T10:16:07Z",
  "payload": {
    "tableId": "table_100_200",
    "members": [
      { "userId": "user_1", "seat": 1 },
      { "userId": "user_2", "seat": 2 }
    ]
  }
}
```

### State snapshot read-model (PR7 room-core contract)

For read-only room projection, runtime supports `table_state_sub` with `payload.view = "snapshot"` or `payload.mode = "snapshot"`.
When snapshot mode is requested after successful auth, server emits exactly one `stateSnapshot` frame and **does not** subscribe that socket to legacy `table_state` broadcasts.

Canonical payload branches:

- `payload.stateVersion: integer`
- `payload.table: object`
- `payload.you: object`
- `payload.public: object`
- `payload.private?: object` (only for the authenticated seated user; omitted for observers). Runtime includes `{ userId, seat, holeCards }` for seated users.

Canonical room-core fields in `payload.public`:

- `payload.public.roomId: string`
- `payload.public.hand: { handId: string|null, status: string|null, round: string|null }`
- `payload.public.board: { cards: string[] }`
- `payload.public.pot: { total: number, sidePots: any[] }`
- `payload.public.turn: { userId: string|null, seat: number|null, startedAt: number|null, deadlineAt: number|null }`
- `payload.public.legalActions: { seat: number|null, actions: string[] }`
- `payload.public.showdown?: { winners: string[], potsAwarded: any[], potAwardedTotal: number, reason: string|null, handId: string|null }`
- `payload.public.handSettlement?: { handId: string|null, settledAt: string|null, payouts: Record<string, number> }`

Canonical compatibility fields:

- `payload.table.tableId: string`
- `payload.table.members: Array<{ userId: string, seat: number }>` (stable sorted by `seat` asc then `userId` asc)
- `payload.table.memberCount: number`
- `payload.table.maxSeats: number` (when runtime-known)
- `payload.you.userId: string` (authenticated user)
- `payload.you.seat: number | null` (null for authenticated non-seated observer)

Missing room-core data MUST fail safe to canonical defaults and never expose foreign private state: `public.hand.status` resolves to `"LOBBY"` (members present) or `"EMPTY"` (no members), `public.pot.total` resolves to `0`, list fields resolve to `[]`, and optional scalars remain `null` when unavailable.

PR8 contract delta: when WS room-core has bootstrapped a live initial hand, `stateSnapshot` may return `public.hand.status = "PREFLOP"` with live `public.turn`, `public.pot`, and per-user `public.legalActions`, while `payload.private.holeCards` is still emitted only for the authenticated seated user. This delta is limited to initial hand bootstrap/read-model projection and does **not** promise full WS `act` mutation support yet.

PR9 contract delta: WS `act` is supported for initial PREFLOP scope (`fold`/`check`/`call`/`bet`/`raise`). Successful or rejected domain outcomes are emitted as `commandResult` (`status = "accepted"|"rejected"`) and malformed payloads still use `error.code = "INVALID_COMMAND"`. On accepted fresh `act`, server emits fresh post-action `stateSnapshot` to the acting connection and currently connected table-associated sockets (joined or subscribed for that table). Idempotent accepted replay returns accepted command semantics but does not trigger a new post-action snapshot fanout wave. Post-action `stateSnapshot` projection preserves existing private scoping guarantees.

PR11 contract delta: a WS-owned hand can settle terminally after fold-win or river-complete showdown. Terminal snapshots use `public.hand.status = "SETTLED"`, `public.turn.userId = null`, and `public.pot.total = 0`. Runtime may include additive `public.showdown` and `public.handSettlement` metadata. Settled hands are no longer live/actionable; fresh `act` requests for the settled hand are rejected while replayed identical accepted requests remain idempotent.

PR14 contract delta: `stateSnapshot.payload.public.turn` now includes additive authoritative timer metadata: `startedAt` and `deadlineAt` (epoch milliseconds). These fields are server-projected from WS-owned hand state for live turns so clients can render countdowns without inferring timing from client clocks. For non-live/no-turn/terminal states, both fields resolve to `null`. Timer metadata is public and does not change timeout authority or private-state visibility.

Example `stateSnapshot` frame:

```json
{
  "version": "1.0",
  "type": "stateSnapshot",
  "requestId": "req-sub-snapshot-1",
  "roomId": "table_100_200",
  "sessionId": "sess_01JZ9VYQH8R9M8M5TQ2J4K8H3Z",
  "seq": 43,
  "ts": "2026-02-28T10:16:08Z",
  "payload": {
    "stateVersion": 7,
    "table": {
      "tableId": "table_100_200",
      "members": [
        { "userId": "user_1", "seat": 1 },
        { "userId": "user_2", "seat": 2 }
      ],
      "memberCount": 2,
      "maxSeats": 10
    },
    "you": {
      "userId": "user_1",
      "seat": 1
    },
    "public": {
      "roomId": "table_100_200",
      "hand": { "handId": null, "status": "LOBBY", "round": null },
      "board": { "cards": [] },
      "pot": { "total": 0, "sidePots": [] },
      "turn": { "userId": "user_1", "seat": 1, "startedAt": null, "deadlineAt": null },
      "legalActions": { "seat": null, "actions": [] }
    },
    "private": {
      "userId": "user_1",
      "seat": 1,
      "holeCards": []
    }
  }
}
```

## Errors

Canonical v1 `error.code` values:

- `UNSUPPORTED_VERSION` — client requested only unsupported protocol versions.
- `INVALID_ENVELOPE` — malformed JSON or missing required envelope fields.
- `FRAME_TOO_LARGE` — frame exceeds 32 KB limit.
- `UNAUTHENTICATED` — command requires auth, but auth is missing/expired.
- `FORBIDDEN` — authenticated user lacks permission for room/command.
- `INVALID_COMMAND` — command payload invalid (schema/domain rules).
- `CONFLICT` — optimistic or state/version conflict.
- `DUPLICATE_REQUEST` — duplicate `requestId` detected and safely ignored/replayed.
- `RATE_LIMITED` — command frequency exceeded contract limits.
- `INTERNAL` — unexpected server failure.

Close vs error event rules:

- Server SHOULD send `error` event without closing for recoverable command-level failures (`INVALID_COMMAND`, `CONFLICT`, `DUPLICATE_REQUEST`, `RATE_LIMITED`).
- Server SHOULD close for protocol-level failures (`UNSUPPORTED_VERSION`, repeated `INVALID_ENVELOPE`, auth gating breach) using WebSocket close codes 1002/1008 as appropriate.
- On close-worthy errors, server SHOULD send terminal `error` frame first when possible, then close.

## Idempotency

- Every stateful client command (`table_join`/`join`, `act`, `leave`, `resync`, `table_state_sub`) MUST include `requestId` UUID.
- Server MUST treat `(userId, roomId, type, requestId)` as idempotency scope.
- Duplicate request handling:
  - If original command already resolved, server MUST return same `commandResult` semantics (or `error.code = "DUPLICATE_REQUEST"` with prior outcome reference) and MUST NOT apply mutation twice.
  - If original command is still pending, server MAY return `commandResult.status = "accepted"` with no additional side effects.
- Runtime note (PR9 WS server): in-memory idempotency replay for `act` is bounded by per-table cache size; oldest requestIds may be evicted, after which replay is no longer guaranteed.
- Runtime note (PR9 WS server): `act` replay cache is keyed by user-scoped idempotency tuple within a room; reusing a requestId from a different user MUST NOT reuse another user's cached outcome.
- Non-mutating commands (`hello`, `auth`, `resume`, `ping`, `ack`) SHOULD still include `requestId` for tracing/correlation.

## Reconnect/Resync

1. Client reconnects and sends `hello`, then `auth`, then `resume` with `sessionId` and `lastSeq`.
2. Server resume decision:
   - If stream continuity is valid (`lastSeq` within replay window) and missing events exist, server replays only missing replayable events (`seq > lastSeq`) in original order.
   - If stream continuity is valid and no events are missing (`lastSeq === latestSeq`), server returns `commandResult` with `{ "status": "accepted", "reason": null }` for that resume request.
   - If continuity cannot be guaranteed (sequence gap/window expired/session unknown/session-user mismatch), server sends `resync` with payload `{ "mode": "required", "reason": string, "expectedSeq": integer }`.
3. Client MUST discard local speculative state and request/accept full current snapshot after `resync`.
4. Server MUST NOT apply hidden mutations on connect/reconnect; only explicit commands may mutate game state.

Resync triggers (non-exhaustive): sequence gap, stale client state version, session expiration, schema/protocol mismatch requiring full snapshot.

## Versioning

- Protocol uses semantic version string in envelope `version`.
- v1 contract target is `1.x` with backward-compatible additions only:
  - Adding new optional fields/events is allowed in minor versions.
  - Renaming/removing required fields or changing meaning is breaking and requires major bump (`2.0`).
- Negotiation:
  - Client sends `hello.payload.supportedVersions` ordered by preference.
  - Server selects one supported version and responds with `helloAck.payload.version`.
  - If no overlap exists, server emits `error.code = "UNSUPPORTED_VERSION"` and closes.

## Security notes (contract-level)

- Auth gate: no room data, seat info, or private cards before successful `auth`.
- Private state isolation: hole cards and equivalent sensitive fields MUST only be present in `stateSnapshot`/`statePatch` for the owning player.
- Rate limits: server enforces per-connection and per-user command limits; excess uses `RATE_LIMITED`.
- Server-authoritative poker transitions: client commands are requests only; legality and final state are determined server-side.

PR15 contract delta: WS transport now assigns server-authoritative `seq` for stateful room-stream events (`table_state`, `stateSnapshot`, `statePatch`, `resync`) with deterministic per-table monotonic ordering. Runtime keeps a bounded in-memory replay window and resume is best-effort only within the current process lifetime.

PR15 resume/ack behavior (implemented):
- `ack` advances receiver-local watermark only and never mutates poker table state.
- `resume` replays only in-window events (`seq > lastSeq`) in order when continuity is provable for the same receiver/session stream.
- On replay miss (`last_seq_out_of_window`, unknown session, or mismatch), server emits `resync` and then sends fresh `stateSnapshot` fallback.
- Legacy PR9/PR11 live fanout paths remain `stateSnapshot`-based for v1.x compatibility.
- `statePatch` is reserved for additive/opt-in transport optimization paths and does not redefine default legacy post-action or timeout delivery.
- `stateSnapshot` remains canonical fallback/resync truth path.

Durability note: replay buffer is process-local and bounded; server restarts or long gaps may require full snapshot recovery.

## Authoritative gameplay write contract (join/start/act)

Gameplay write commands are authoritative over WS. `start_hand` and `act` use `commandResult` as the primary command ack. `join` / `table_join` preserves legacy actor-visible `table_state` first-frame behavior and may additionally emit `commandResult` for deterministic client ack.

- `join` / `table_join` payload: `{ tableId, seatNo?, autoSeat?, preferredSeatNo?, buyIn }` (`buyIn` required for gameplay-equivalent authoritative joins)
- `start_hand` payload: `{ tableId }`
- `act` payload: `{ handId, action, amount? }`

Success contract:

1. server validates payload + session/table binding
2. server applies mutation once for `(userId, requestId)` idempotency key
3. server persists authoritative state once
4. for `join`/`table_join`, server emits actor-targeted `table_state` deterministically on success before follow-up fanout
5. server emits `commandResult.status = "accepted"` only after required post-mutation persistence/restore checks complete (no early accept + later reject for the same requestId)
6. server emits/broadcasts authoritative snapshot updates

Rejection contract:

- malformed command uses `error.code = "INVALID_COMMAND"`
- join/bootstrap/load validation failures that were historically protocol errors remain `error` frames (for example `TABLE_NOT_FOUND`, `TABLE_BOOTSTRAP_FAILED`)
- domain/persistence rejection uses `commandResult.status = "rejected"` with stable reason codes such as `not_your_turn`, `action_not_allowed`, `invalid_amount`, `state_invalid`, `hand_not_live`, `already_live`, `not_enough_players`
- rejection MUST NOT emit success snapshot broadcasts
- on persistence conflicts server restores authoritative state and emits `resync` with reason `persistence_conflict`

Client resync expectation:

- UI must treat WS snapshots as source-of-truth after accepted gameplay writes
- `table_join`/`join`, `start_hand`, and `act` are WS-only gameplay writes for browser runtime
- client must not replay rejected or failed WS gameplay writes over HTTP fallback for the same operation
- accepted gameplay writes must converge UI from WS `table_state` / `stateSnapshot` / `table_snapshot` data, not from HTTP write responses
