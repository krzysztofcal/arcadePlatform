# Data Model

No schema additions. Existing locked archive batch carries immutable archive ID hashes/counts, five prune receipt fields and three cleanup receipt fields.

Allowed retry states: complete prune + absent cleanup + complete matching registry; or complete prune + authorized Stage/v1 cleanup + zero registry. Neither retry changes state.

Cleanup validity: all three fields present; key count equals transaction count (positive by existing input validation); digest matches `^[0-9a-f]{64}$`; canonical Stage project, format 1, exact existing-30d policy and committed timestamp. Existing proof/prune hashes and counts must match supplied IDs. Residual, wrong and extra mappings remain forbidden.
