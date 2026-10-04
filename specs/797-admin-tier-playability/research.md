# Research

- Decision: reuse `readSettledBotFundingSnapshot` shape with batched shared reader, all `CANONICAL_POKER_BUY_IN_TIERS`. Rationale: active-table-only cache misses newly enabled tiers; one policy query and one exact-key accounts query avoids 2 reads per catalog tier. Existing 25s refresh/30s expiry is sufficient. Alternative rejected: new scheduler/config/cache.
- Decision: JOIN stays transaction-based and replaces its already-loaded two policy/pool queries with the full snapshot. Rationale: highest + fallback needs all enabled tiers; WS cache injection would add precedence and adapter plumbing. Funding uses the same selected policy/provisioning from that snapshot.
- Decision: no missing-schema enablement fallback. Rationale: sole Enabled authority cannot be inferred when unavailable; old human fixtures must model valid provisioned policies. Financed rejoin stays independent.
- Decision: require both exact NORMAL/SLOW active pool accounts, never balances as provisioning evidence. Reuse existing source key helper and Admin checks; thresholds and hourly limits remain independent.
- Decision: manual Create gains operational activation only, retaining #788's separation from bankroll seating; schema supports live revisioned toggles, no migration required.
- Decision: Stage rollout is authorized by requested Preview smoke and issue target. Production target is documented only until separate authorization. No new pools/account provisioning/direct-balance editing.

- Verification finding: required WS JOIN harness used a pre-schema file-backed SQL adapter. Reuse its existing fixture document to model policy rows, exact SYSTEM accounts and user access fields; missing policy still returns schemaBacked=false. No runtime bypass/default activation. Existing lifecycle tests retain their scenarios, no new glue suite.
- API choice: pass the compact `enabledBuyIns` derived once from trusted policy into pure progression/access; do not expose funding thresholds or internal snapshot details in progression responses.
- Verification finding: marking known-absent schema as unknown stalled already financed file-backed hand rollover. Its funding decision is now known-denied (no source/funding), preserving financed continuation; missing/expired snapshots and unknown individual policy retain existing bounded retry.
