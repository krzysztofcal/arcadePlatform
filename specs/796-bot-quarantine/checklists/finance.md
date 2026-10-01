# Finance and Authority Checklist: NORMAL/SLOW periodic pools with manual RESTRICTED

**Purpose**: Independent review of requirements quality, economic containment and authority boundaries.
**Created**: 2026-09-26
**Feature**: [spec.md](../spec.md), [contract](../contracts/bot-quarantine.md)

**Review Ownership**: Reviewer-owned; `[x]` means requirements quality reviewed, never implementation complete. Left unchecked for independent review.

## Classification / admission / limits

- [ ] CHK001 Do FORCE_NORMAL and FORCE_RESTRICTED affect only effective state while threshold still persists automatic SLOW, with Return to AUTO immediately using stored NORMAL/SLOW without another threshold check and no is_slow_only reset? Are the states distinct from #869 SLOW? [FR-001]
- [ ] CHK002 Are JOIN wallet and existing authoritative settled stacks used without global wealth aggregation or per-hand policy/account/override reads? [FR-002/003]
- [ ] CHK003 Are cache refresh interval/expiry, revision races and Admin propagation explicit, while UNKNOWN cannot block lawful payout or falsely promote? [FR-003/017]
- [ ] CHK004 Is SLOW owner-only safe promotion at accepted final JOIN, with Create remaining empty/unfunded and is_slow_only sticky? [FR-004/005]
- [ ] CHK005 Do both classes have max4 distinct active and max4 pending, with rejoin free and fifth requests denied before financial/table mutations? [FR-006/007]
- [ ] CHK006 Do Create/fallback/JOIN share user-scoped transaction lock, fresh counts and consistent lock ordering across table IDs, plus mandatory user-leading active/creator-leading pending predicate-matched access paths, early limit five and T027 local EXPLAIN proof without global seat/table scans or duplicate indexes? [FR-008]
- [ ] CHK007 Does first accepted JOIN move pending to active and set has_human_participant only on actual admission/rejoin? [FR-007/018]

## Pools / refill / operations

- [ ] CHK008 Are exact 100/500 NORMAL/SLOW pools and explicit future-tier provisioning defined with no TREASURY/cross-tier/class fallback? [FR-009/010]
- [ ] CHK009 Do all runtime funding paths spend only existing CH and preserve historical source returns? [FR-010]
- [ ] CHK010 Are enabled/four threshold+amount fields/revision/audit dynamically tunable, positive safe integers and backend-authorized? [FR-011/017]
- [ ] CHK011 Is each current UTC-hour pool bucket limited to one configured amount, including policy revision changes, retries and disable/re-enable? [FR-012/013]
- [ ] CHK012 Does existing ledger/idempotency protect scheduled SYSTEM MINT without new receipts, per-funding identity or table-linked retention? [FR-013]
- [ ] CHK013 Is the only future scheduler the exact Supabase Cron job `poker-bot-pool-refill-hourly` (`0 * * * *`, `select public.poker_bot_pool_refill_hourly();`), while this PR leaves pg_cron/job/control disabled? Are live VPS cleanup, bootstrap and profile/table activation excluded pending separate owner GO? [FR-014/021]
- [ ] CHK014 Has no drift between live #1018 and this Spec Kit been confirmed, with the accepted implementation instruction recorded before T001? [FR-021]

## Integration / scope

- [ ] CHK015 Are WS live lobby slowOnly plus minimal bot occupancy and DB Quick Seat compatibility minimal, preserving restricted bot-free filtering, resume and final JOIN authority? [FR-015/016]
- [ ] CHK016 Does CONTINUOUS_BOT retain lifecycle, no new SLOW/RESTRICTED lifecycle, no forced hand interruption or rotation bypass, and deny fresh RESTRICTED targets? [FR-019]
- [ ] CHK017 Are Admin Users/Ops reused without generic policy/moderation product, public overrides or unnecessary UI tests? [FR-017/020]
- [ ] CHK018 Are Sybil, split wealth, below-threshold farming and pool-chunk exhaustion explicitly accepted residual risks? [spec Assumptions]
- [ ] CHK019 Are breaking impacts and shared Stage forward-only effects explicit, including that shared Stage may automatically receive only a dark disabled control/function, while Production P2 remains unapplied? Is live VPS cleanup, Cron activation and Production a separate GO? [FR-021]
- [ ] CHK020 Are tests fundamental, JS JSP/global compatible, logging klog-only, CSS one selector per line and future inline CSP SHA accounted for? [FR-020]

- [ ] CHK021 Do the existing workflow/VPS guard tests prove that the retired poker refill workflow/worker/timer/canary are absent while the chips cleanup service/auth remain unchanged? Do the disposable PostgreSQL tests cover the database refill invariants without requiring real pg_cron or touching shared Stage/Production? [FR-014/020/021]

## Manual RESTRICTED amendment

- [ ] CHK022 Is FORCE_RESTRICTED accepted only through `requireAdmin`/revision/audit flow, while automatic state remains NORMAL/SLOW and no automatic classifier, bankroll, refill policy or table marker is added? [FR-001/017]
- [ ] CHK023 Does fresh RESTRICTED JOIN/Quick Seat choose only ordinary bot-free STANDARD targets and reject bot-populated, SLOW-only and CONTINUOUS_BOT targets before buy-in, while funded rejoin/settlement/payout remain legal? [FR-004/010/015/016/019]
- [ ] CHK024 Does the new forward-only migration extend only `chips_accounts_poker_access_override_chk`, remain exhaustive-manifest classified as `needs-production-equivalent`, and preserve pre-migration Production compatibility? [FR-021]

## Notes

Live sync is complete, not an external blocker. CHK014 is a no-drift/approval check. No checkbox is evidence of executed tests or deployed changes. #869/#1017 remain unchanged. RESTRICTED is manual-only and has no independent table/pool lifecycle.
