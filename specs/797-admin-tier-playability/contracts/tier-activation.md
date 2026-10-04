# Tier activation contract

`evaluatePokerProgression({balance, tiers, enabledBuyIns})` and `evaluatePokerBuyInAccess(...)` consume `enabledBuyIns` derived from fresh known policy with enabled=true and exact NORMAL/SLOW provisioning. The reader filters that evidence; pure progression consumes the resulting list. Missing snapshot/list denies new play. Disabled rows remain in roadmap, never in availableBuyIns; highest active tier remains uncapped. No ENV frontier result/default remains.

Create: configured canonical + operational activation, bankroll seating still checked by JOIN. JOIN: existing class + bankroll/progression + operator activation; financed rejoin unchanged. Quick Seat: existing human-first candidate order, active tier list, automatic Create chooses availableBuyIns[0]. Table preflight uses same progression.

Admin mutation shape/revision/audit and propagationMs=30000 remain unchanged. WS funding snapshots refresh all canonical tiers in existing refresh; stale/missing/unknown/disabled/unprovisioned denies funding. Exact source keys and existing refill/caps stay unchanged.
