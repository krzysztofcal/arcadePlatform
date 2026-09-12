# Data Model

No database schema changes are required. The feature adds a read-only response projection over existing runtime and ledger entities.

## Account Poker Projection

```text
profile fields from ownerProfile
balance: safe integer from getUserBalance(userId).balance
poker: null | {
  inPoker: boolean,
  tables: PokerTableProjection[]
}
```

`poker: null` means the optional authoritative WS projection was unavailable or invalid. It is distinct from an available empty projection: `{ inPoker: false, tables: [] }`.

## Poker Table Projection

```text
{
  tableId: non-empty string,       # complete runtime identifier
  status: string,                  # authoritative table lifecycle status
  seatNo: integer | null,          # requested user's authoritative seat
  seatStatus: string | null,       # requested user's public seat status
  stack: safe integer | null,      # requested user's public stack only
  stakes: { sb: integer, bb: integer } | null,
  maxPlayers: positive integer | null,
  stateVersion: non-negative integer,
  handStatus: string | null
}
```

Invariants:

- Every row's `tableId` is the full identifier; no layer before Account UI may shorten it.
- Rows are produced only when the requested user is an authoritative non-bot member of a non-closed materialized runtime table.
- `inPoker === (tables.length > 0)`.
- Missing optional public values are `null`, never fabricated from private state.
- The projection contains no hole cards, deck, hand seed, private branch, access token, or other user's private fields.
