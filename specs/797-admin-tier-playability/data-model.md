# Data Model

No persisted schema change. Existing `poker_bot_tier_policy`: canonical buy_in, boolean enabled, refill thresholds/amounts, hourly caps, positive revision and audit fields. Existing active SYSTEM accounts prove exact NORMAL/SLOW provisioning.

Shared snapshot: schemaBacked, expiresAtMs, tiers keyed by canonical buy-in. Each tier contains normalized policy fields plus provisioned.NORMAL/SLOW. Transaction-local reuse prevents repeated reads; WS caches this shape using existing refresh. Expired or unknown evidence denies activation.

Progression: full configured tier rows retain bankroll milestones; activation is independent; availableBuyIns selects top two active unlocked tiers. Financed seat rejoin bypasses new activation check.
