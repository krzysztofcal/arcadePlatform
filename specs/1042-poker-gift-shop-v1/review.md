# Review and validation — #1042

Author review covers simplicity, idempotency, ledger invariants, breaking impact and agents.md/skills.md compliance. Independent review via requesting-code-review found observer same-user rejoin badge retention, corrected by broadcasting authoritative participation-filtered gift aggregates after accepted joins; the real WS test covers observer recovery. Resume recovery now follows replay frames. DB exact joined_at (microseconds) remains private and authoritative. Recovery work does not occupy the gameplay command queue.

Existing postTransaction receives the same caller tx. BURN has exactly USER(-catalog price) and SYSTEM/GENESIS(+catalog price), no recipient/ESCROW/TREASURY/HOUSE/bot-pool entry. Unique hashed purchase key and buyer/table advisory lock serialize replay/cooldown. Receipt and BURN roll back together. NOWAIT row locks avoid conflicting with gameplay projection lock order. No second payment system, dependency, browser module, inline script, console logging or unrelated cleanup.

Intentional additive breaking effects: backend-only receipt schema, CH sink, gift_send/table_gift/table_gift_state vocabulary. Compatible Production schema is required before Production-deploying merge; owner GO is separate and no Production mutation was performed.

Local evidence: focused PGlite purchase/migration + handler 12/12; canonical Node ledger suite passes; existing browser/WS client runtime 148/148; final WS server suite 140/140; npm test passes (DB-gated suites explicitly skip without credentials). Syntax, check:all, ci:guards, CSP inline guard and exhaustive migration guard pass (108 Stage source files, 7 Production replacements). No UI/CSS/JSP test expansion.

The vitest-only tests/chips-ledger.test.mjs cannot run with installed repo dependencies. Accounting coverage extends existing tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt constraints/RLS/indexes execute in the focused suite using existing PGlite, avoiding an external mutation/test database. These narrow plan/code reconciliations are recorded in plan.md.

Required runtime evidence (to record after publication): Stage migration apply, exact-SHA WS Preview Deploy, RELEASE_SHA == DEPLOY_REF, mandatory authenticated Deploy Preview -> WS Preview smoke. Authenticated Stage credentials are not present in this environment; manual smoke remains required and the draft must not be described as merge-ready.
