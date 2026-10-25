# #1150 — preserve private audit metadata after normal WS Leave

Medium/P2, before public 1.0. Independent branch from main `6ecbc8a36a19952b7e86255436e8be903ea5d646`; no #1149/#1147 changes.

Use the existing full persisted reload, not field copying from runtime. `handleLeaveCommand` reloads after committed successful Leave (including idempotent replay); `server.mjs` supplies `restoreTableFromPersisted`. Keep public Leave responses/snapshots unchanged. Existing repository/bootstrap/version fencing validates and installs current authoritative state. No ledger/rules/bot strategy changes, migrations or historical repair.

1. Add one fundamental handler→real manager→real bot action reducer→real settlement audit writer regression. Full original starting-stack map survives; public response and snapshots omit it. Observe RED (undefined map), then GREEN (audit OK).
2. Replace public Leave response restore with existing full persisted reload. Preserve failure rejection; never fall back to the public projection. Update existing boundary fixtures and cover reload failure/retry/already-left with newer hand/version.
3. Run existing authoritative Leave/idempotency/cashout, manager/bootstrap, settlement/bot, reconnect and WS suites plus root tests. Review SQL cost and privacy boundaries.
4. Draft PR closes #1150, report exact SHA/checks and remaining runtime gate. No deploy or merge.

Runtime smoke after separate GO: shared Preview occupancy/accounting preflight; workflow definition main, application exact runtime SHA; confirm metadata/restart/module hashes/health. One Online Leave during hand, bots finish with original starting-stack audit OK, normal cashout; reconnect/idempotent replay without another cashout; one SP folded-human continuation/settlement/Leave. Public responses/snapshots must omit the map. Stop on mismatch or ambiguity, no manual correction.
