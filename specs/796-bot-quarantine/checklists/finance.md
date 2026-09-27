# Finance and Authority Checklist: NORMAL/SLOW periodic pools

**Purpose**: Independent review of requirements quality, economic containment and authority boundaries.
**Created**: 2026-09-26
**Feature**: [spec.md](../spec.md), [contract](../contracts/bot-quarantine.md)

**Review Ownership**: Reviewer-owned; `[x]` means requirements quality reviewed, never implementation complete. Left unchecked for independent review.

## Classification / admission / limits

- [ ] CHK001 Does FORCE_NORMAL affect only effective class while threshold still persists automatic SLOW, with Return to AUTO immediately using stored SLOW without another threshold check and no is_slow_only reset? Are the states distinct from #869 SLOW? [FR-001]
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
- [ ] CHK011 Is each current UTC3h pool bucket limited to one configured amount, including policy revision changes, retries and disable/re-enable? [FR-012/013]
- [ ] CHK012 Does existing ledger/idempotency protect scheduled SYSTEM MINT without new receipts, per-funding identity or table-linked retention? [FR-013]
- [ ] CHK013 Is VPS/systemd authenticated dispatch the primary wake-up, with bootstrap only for fresh/rebuilt hosts and a separate owner-approved existing-host install? Are installation/activation separate, with no deploy/install auto-enable/start, DB credentials/SQL on VPS, native cron reliance or backlog? [FR-014/021]
- [ ] CHK014 Before T001, has no drift between live #1018 and this Spec Kit been confirmed, with independent approval and separate implementation instruction? [FR-021]

## Integration / scope

- [ ] CHK015 Are WS live lobby slowOnly and DB Quick Seat compatibility minimal, preserving resume and final JOIN authority? [FR-015/016]
- [ ] CHK016 Does CONTINUOUS_BOT retain lifecycle, no new SLOW lifecycle, no forced hand interruption or rotation bypass? [FR-019]
- [ ] CHK017 Are Admin Users/Ops reused without generic policy/moderation product, public overrides or unnecessary UI tests? [FR-017/020]
- [ ] CHK018 Are Sybil, split wealth, below-threshold farming and pool-chunk exhaustion explicitly accepted residual risks? [spec Assumptions]
- [ ] CHK019 Are breaking impacts and shared Stage forward-only effects explicit? Is required manual exact-SHA WS Preview/workflow verification/smoke separate from a conditional Stage ledger-MINT canary requiring explicit user authorization, whose absence cannot block WS completion, with Production a wholly separate GO? [FR-021]
- [ ] CHK020 Are tests fundamental, JS JSP/global compatible, logging klog-only, CSS one selector per line and future inline CSP SHA accounted for? [FR-020]

- [ ] CHK021 Do T016/T019/T020 extend `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs` with minimal deterministic guards for workflow_dispatch-only, canonical repo/ref, actor/environment/feature gates, read-only default, separate Production GO and rejection of input-only authorization; exact VPS dispatch with no DB secrets/SQL; fresh-only installation without activation and separate existing-host install? Do tests avoid real dispatch/systemd/DB mutations and new frameworks/broad suites? [FR-014/020/021]

## Notes

Live sync is complete, not an external blocker. CHK014 is a no-drift/approval check. No checkbox is evidence of executed tests or deployed changes. #869/#1017 remain unchanged; future RESTRICTED is out of scope.
