# Accounting safety self-review — #1066

Root cause: participant-only state.seats omitted a still-seated sit-out human whose authoritative stack was preserved. Existing classifier rejected this ownership despite conserved escrow.

The original exact state-seat mapping remains the normal human path. Fallback requires SETTLED, persisted is_bot=false and ACTIVE, valid state.seats/handSeats arrays, explicit sitOut=true, no left flag, absent human state mapping and no occupant at its persisted seat number. Hand-seat entries must be valid and cannot contain that human or seat number. Existing persisted/state duplicate-user/duplicate-seat checks run first; occupiedClaimSeats remains mandatory. Bot identity/provenance branch is unchanged.

projectTerminalClaimAmounts still provides amounts from state.stacks; persisted stack is never read by the new branch. Existing unresolved-pot, total-claims, escrow, bot provenance/source validation all occur before ledger writes. Final zero escrow, optimistic version and table-close transaction guards unchanged. No scheduler/engine/WS/UI/migration/config/dependency changes.

One new fundamental regression uses executeInactiveCleanup and real terminal close via existing harness. Persisted human stack deliberately 9999; authoritative claim 940, bots 710/1350 with genuine-shaped BOT_SEED_BUY_IN provenance. Assertions prove human USER credit 940, bot SYSTEM credits 2060, escrow zero, one CLOSED transition and inactive seats. RED against baseline; GREEN after correction.

Focused existing accounting/cleanup/leave/human-stack suites: 46/46 PASS. check:all, ci:guards, CSP, test:quick, test:unit and diff checks PASS. Full npm test and exact-head CI/WS Preview deployment evidence follow in handoff. Baseline first attempt lacked local postgres package; reused existing temporary node_modules, baseline then 41/41 PASS. No dependency manifests changed.

Breaking impacts: no schema/protocol/API changes. Existing shared terminal callers can now close the previously blocked unambiguous SETTLED sit-out ownership case. Non-sit-out, INACTIVE, left, malformed/missing hand collection, occupied/mismatched seat and ambiguous identity cases retain existing rejection path; no general missing-seat forgiveness.

No Production writes/deploy/cleanup and no merge. Incident table remains for separately authorized post-deployment automatic janitor smoke. Draft, implementation ready, awaiting manual runtime verification.
