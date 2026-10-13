# Independent review and validation — #1098

Independent subagent reviewed ledger/escrow, CAS/rollback, live claims, retry/recovery, timeout/action races, private protocol, reconnect and CONTINUOUS_BOT. Final verdict: APPROVE for Draft PR; no remaining blocking findings. Runtime/manual smoke still required.

Findings fixed: CLOSED deferred avatar projection; stale frames restoring own avatar; null deadline coercion; preflight pending evidence requiring seat OR stack OR ACTIVE owner row. Additional review approved durable terminal accounting failure retry through the existing slow rollover scheduler.

Fundamental evidence:
- Engine actual hand transitions/JSON restore: Online=2/SP=3, full 20s per decision, CHECK/FOLD counted, manual FOLD/CALL/CHECK reset, late action cannot reverse marker; missing raw deadline fails closed.
- Timeout handler: Leave callback only after successful persistence; conflict restores without ejection.
- Existing Leave handler: lost response reloads current persistence; retry does not repeat cash-out; failed Leave keeps claims/pending and stable request ID.
- Shared JOIN: both modes reject terminal marker before debit and preserve ledger/state.
- Real deferred finalizer + real terminal-close in existing accounting harness: escrow 3000 equals claims (human 940 + funded bots 710/1350); correct USER/SYSTEM refunds; CLOSED and escrow=0; second finalizer returns already_closed with unchanged three payouts. These are local deterministic fixtures, not Stage/Production accounting evidence.
- Private projection/snapshot: pending owned avatar non-actionable; confirmed detach removes avatar; CLOSED historical seats stay hidden; only owner receives persisted reason after reconnect. Preflight reload handles CLOSED Single Player and OPEN Online.
- Rollover accounting failure: remains SETTLED, does not persist next hand, queues existing retry; CONTINUOUS_BOT lifecycle preserved.

Local verification: npm test PASS (isolated test environment with external DB/service credential variables removed); focused critical suite 97/97, JOIN/timeout subset 89/89, progression endpoint 13/13, rollover/access 18/18, existing Leave behavioral script PASS. ci:guards, test:quick, test:unit and CSP hash guard PASS. check:all reports five pre-existing XP badge violations in unchanged design mockups (poker/designs/luxury-lobby/{index,landscape,portrait}.html, specs/1086-poker-felt/design/index.html, specs/792-premium-table-themes/design/index.html); relevant script and inputs identical to origin/main.

No new migrations/dependencies/frameworks/configuration/CSS/inline scripts. No deployment, funded environment checks, Production mutation or merge. Exact-SHA Preview and manual smoke pending owner GO.
