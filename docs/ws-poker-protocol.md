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
| `join` | `{ "seat": integer, "buyIn": integer }` | Requests seat/join mutation. Requires auth. |
| `act` | `{ "handId": string, "action": "fold"|"check"|"call"|"bet"|"raise", "amount": integer }` | Requests poker action mutation. Requires auth and turn validity. |
| `leave` | `{ "reason": string }` | Requests leave/cashout workflow. |
| `ack` | `{ "seq": integer }` | Acknowledges latest processed server sequence (flow-control aid). |

### Server → Client

| Type | Payload schema (required fields) | Semantics |
|---|---|---|
| `helloAck` | `{ "version": "1.0", "sessionId": string, "heartbeatMs": integer }` | Confirms negotiated version and returns initial session id. |
| `authOk` | `{ "userId": string, "roomId": string, "permissions": string[] }` | Auth success event. |
| `pong` | `{ "clientTime": string, "serverTime": string }` | Ping response. |
| `stateSnapshot` | `{ "stateVersion": integer, "table": object, "you": object }` | Full room state snapshot (canonical PR5 read-model contract; private data scoped to authenticated seat only). |
| `statePatch` | `{ "stateVersion": integer, "patch": object }` | Incremental room state update. |
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

### State snapshot read-model (PR5 runtime contract)

For read-only room projection, runtime currently supports `table_state_sub` with `payload.view = "snapshot"`.
When this view is requested after successful auth, server emits `stateSnapshot` with canonical payload branch:

- Snapshot view is a one-shot response for that request; it does not implicitly subscribe the socket to legacy `table_state` broadcast updates.

- `payload.stateVersion: integer`
- `payload.table: object`
- `payload.you: object`

Initial PR5 snapshot projection fields:

- `payload.table.tableId: string`
- `payload.table.members: Array<{ userId: string, seat: number }>` (stable sorted as above)
- `payload.table.memberCount: number`
- `payload.table.maxSeats: number` (when configured/runtime-known)
- `payload.you.userId: string` (authenticated user)
- `payload.you.seat: number | null` (null when authenticated observer is not seated)

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
- `bounds_exceeded` — join rejected because the table is already at max seats.
- `CONFLICT` — optimistic or state/version conflict.
- `DUPLICATE_REQUEST` — duplicate `requestId` detected and safely ignored/replayed.
- `RATE_LIMITED` — command frequency exceeded contract limits.
- `INTERNAL` — unexpected server failure.

Close vs error event rules:

- Server SHOULD send `error` event without closing for recoverable command-level failures (`INVALID_COMMAND`, `CONFLICT`, `DUPLICATE_REQUEST`, `RATE_LIMITED`).
- Server SHOULD close for protocol-level failures (`UNSUPPORTED_VERSION`, repeated `INVALID_ENVELOPE`, auth gating breach) using WebSocket close codes 1002/1008 as appropriate.
- On close-worthy errors, server SHOULD send terminal `error` frame first when possible, then close.

## Idempotency

- Every mutating client command (`join`, `act`, `leave`) MUST include `requestId` UUID.
- Server MUST treat `(userId, roomId, type, requestId)` as idempotency scope.
- Duplicate request handling:
  - If original command already resolved, server MUST return same `commandResult` semantics (or `error.code = "DUPLICATE_REQUEST"` with prior outcome reference) and MUST NOT apply mutation twice.
  - If original command is still pending, server MAY return `commandResult.status = "accepted"` with no additional side effects.
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
