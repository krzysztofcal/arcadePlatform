# Poker hand audit record v2

`HAND_SETTLED` remains the single compact per-hand audit record in
`public.poker_actions`, uniquely identified by `(table_id, hand_id)`. The
writer stores `meta.auditVersion = 2` and serializes the authoritative
settlement result already present in `state.showdown.potsAwarded`.

The v2 additions are:

- `participants[]`: `userId`, `seatNo`, `folded`, `startingStack`,
  `endingStack`, `contribution`, `payout`;
- `potsAwarded[]`: the existing pot fields plus internal `returnUserId` on an
  uncalled-return pot;
- `integrity`: status, flags, totals, and conservation deltas.

`participants[]` is built only from `state.handSeats`, so a player joining
after hand start is not included. Start stacks come from
`handStartStacksByUserId`, captured before blinds. If an older state does not
have that map, the writer may derive a value for diagnostics but marks the
record `INCOMPLETE` with `STARTING_STACK_DERIVED`.

For each participant:

```text
startingStack = endingStack + contribution - payout
```

Global conservation uses the returned amount separately from contestable
pools:

```text
contributionTotal = contestablePotTotal + returnedTotal
awardedPotTotal = contestablePotTotal + returnedTotal
payoutTotal = awardedPotTotal
startingStackTotal = endingStackTotal + contributionTotal - payoutTotal
```

For example, with user 1 starting at 500 and contributing 240, user 2
starting at 500 and contributing 50, a 100-chip contestable pot and a
190-chip return to user 1 produce ending stacks 550 and 450. The totals are
`starting=1000`, `ending=1000`, `contribution=290`, `returned=190`,
`contestable=100`, `awarded=290`, `payout=290`; every conservation delta is
zero.

The persistence path does not call `buildSidePots()`. It does not reconstruct
domain state and does not write a per-hand ledger settlement. `HAND_SETTLED`
remains best-effort for now; fail-closed persistence is a separate follow-up
because it would change settlement runtime semantics. The existing cleanup
continues to retain human settlement markers for seven days and uses the
configured bot retention for bot-only tables.

The admin reader accepts both v1 and v2 records. Public WS projections expose
only `amount`, `winners`, and `eligibleUserIds` for awarded pots;
`returnUserId` is internal audit data and is removed by both public read
models.
