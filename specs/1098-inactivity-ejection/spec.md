# #1098 Mode-aware terminal inactivity

Source: GitHub issue #1098, including Binding owner clarifications — 2026-10-13. Owner approved implementation and Draft PR on 2026-10-13.

## Requirements
- Count committed distinct human decision timeouts equally for CHECK/FOLD: Online 2, persisted Single Player 3. Accepted human actions/preactions reset only before terminal intent. Preserve full existing 20s deadlines, cross-hand counts, restore and queue/audit dedupe.
- Persist irreversible intent with the timeout before financial work. Preserve live claims and suppress future enrollment. Use existing executePokerLeave and deferred finalizer, CAS, ledger idempotency, terminal-close and existing timeout sweep/settled rollover retries.
- Finance-first detach: retain visibly pending owned seats until authoritative cash-out/detach. Online releases seat and preserves other humans and CONTINUOUS_BOT. Last human STANDARD closes; Single Player closes without socket disappearance or redirect completion, bot funding refunds and escrow=0.
- Only affected viewer receives authoritative private pending/removed status and reason. Confirmed removal starts existing 5s redirect: Online “Removed for inactivity”; Single Player “Game ended due to inactivity”. Old snapshots cannot cancel it or enable actions/auto-JOIN. Restore/reload recovers reason from durable evidence; no automatic debit.
- Trusted hydrated isSinglePlayer only; unknown UUID mode fails closed. No heuristics, heartbeat, scheduler, framework, schema, dependencies, CH/blind/timer changes, inline scripts or CSS changes.

## Durable origin and recovery
Add inactivityEjectionByUserId entries {handId, isSinglePlayer} to existing persisted poker state JSON, generated only by authoritative committed timeout policy. It is a terminal tombstone, retained across rollover/terminal-close. Financial completion is derived from absent authoritative seat AND stack (or confirmed CLOSED), never from intent alone. Pending marker blocks actions/JOIN and new enrollment. The same table remains terminal for that user; a different table requires explicit participation. Existing poker-progression preflight reads per-user persisted marker/seat/stack evidence for reload and excludes this table from Resume. Existing timeout sweep retries Leave under per-table queue; settled rollover finalizes before starting another hand. No migration.

## Acceptance and authorization
Fundamental deterministic engine, accounting/lifecycle, queue/retry and reconnect projection tests only; UI presentation via manual smoke. Independent subagent ledger/race review required. Draft PR references #1098 without closing it. WS Preview Deploy exact SHA and manual Online/SP smoke remain pending separate GO. No deployments, funded Stage tests, migrations, Production mutations or merge authorized.

## Binding PR #1099 owner review corrections
- `table_snapshot` persistence loader is read-only, including expired deadlines. It cannot increment counters, alter turns, create ejection intent or write timeout audit. Timeout decisions remain exclusively in the existing authoritative queued WS path with trusted mode.
- Authoritative JOIN rejection `removed_for_inactivity` survives adapter normalization to the WS command result without debit/runtime seating.
- Browser inactivity state/countdown belongs to the authenticated identity: logout/change clears it and its timer, same-account token refresh/reconnect preserves it. Late callbacks remain protected by existing generation gates.
- Timeout sweep reconciles only pending authoritative Leave work (retained seat/stack and no already-committed deferred leave) on non-CLOSED tables. Completed tombstones remain durable without repeated queue work; existing hand progression/settled finalizer/retry continues handling deferred claims.
- No deployment, funded Stage tests, migrations, Production change or merge; PR remains Draft for another owner review.

## Additional reconnect/post-settlement verification
Transport reconnect/resync, page refresh/bootstrap and token refresh cannot count a missed decision or create inactivity intent. Only successfully persisted authoritative decision timeout crosses Online 2/SP 3; valid human actions reset pre-threshold count. A real timeout during disconnection remains a missed decision, independent of the later reconnect.
Completed inactivity can leave historical seat identity in persisted JSON. A committed left marker, absent authoritative stack and absent ACTIVE seat owner establish detached ownership only when no live-hand claim remains. Bootstrap must exclude that historical current-seat entry before identity reconciliation, retaining hand history/tombstone. Completed private snapshots return removed, no avatar/member/actions, no queued Leave/cash-out. Pending deferred claims remain pending without re-running Leave on reconnect; existing settlement/retry remains server-owned.
