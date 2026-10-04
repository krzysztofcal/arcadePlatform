# Review and validation — #1042

Author review covers simplicity, idempotency, ledger invariants, breaking impact and agents.md/skills.md compliance. Independent review via requesting-code-review found observer same-user rejoin badge retention, corrected by broadcasting authoritative participation-filtered gift aggregates after accepted joins; the real WS test covers observer recovery. Resume recovery now follows replay frames. DB exact joined_at (microseconds) remains private and authoritative. Recovery work does not occupy the gameplay command queue.

Existing postTransaction receives the same caller tx. BURN has exactly USER(-catalog price) and SYSTEM/GENESIS(+catalog price), no recipient/ESCROW/TREASURY/HOUSE/bot-pool entry. Unique hashed purchase key and buyer/table advisory lock serialize replay/cooldown. Receipt and BURN roll back together. NOWAIT row locks avoid conflicting with gameplay projection lock order. No second payment system, dependency, browser module, inline script, console logging or unrelated cleanup.

Intentional additive breaking effects: backend-only receipt schema, CH sink, gift_send/table_gift/table_gift_state vocabulary. Compatible Production schema is required before Production-deploying merge; owner GO is separate and no Production mutation was performed.

Local evidence: focused PGlite purchase/migration + handler 12/12; canonical Node ledger suite passes; existing browser/WS client runtime 148/148; final WS server suite 140/140; npm test passes (DB-gated suites explicitly skip without credentials). Syntax, check:all, ci:guards, CSP inline guard and exhaustive migration guard pass (108 Stage source files, 7 Production replacements). No UI/CSS/JSP test expansion.

The vitest-only tests/chips-ledger.test.mjs cannot run with installed repo dependencies. Accounting coverage extends existing tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt constraints/RLS/indexes execute in the focused suite using existing PGlite, avoiding an external mutation/test database. These narrow plan/code reconciliations are recorded in plan.md.

Required runtime evidence (to record after publication): Stage migration apply, exact-SHA WS Preview Deploy, RELEASE_SHA == DEPLOY_REF, mandatory authenticated Deploy Preview -> WS Preview smoke. Authenticated Stage credentials are not present in this environment; manual smoke remains required and the draft must not be described as merge-ready.

## Published runtime evidence (2026-10-04 UTC)

- Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1047 (not merge-ready).
- Latest runtime-affecting SHA: `eb4144882028f44233609ade15b1323b553e9564`.
- Stage Apply: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37240353552 — success. Log: 107 applied / 1 pending, then applied `20261004220956_poker_gift_purchases.sql` with CREATE TABLE / ALTER TABLE / REVOKE / GRANT / two CREATE INDEX statements. Schema-only source; no receipts/ledger/CH changes. Applied source is immutable.
- Exact-SHA WS Preview Deploy: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37240373077 — success. Workflow selected from main; input ref equals the runtime SHA. Checks compare `releaseSha`/`deployRef` to that SHA in extracted artifact, installed-before-restart and installed-after-restart metadata; local/public health gates pass. Additional public `/healthz` returns `ok`.
- First dispatch had an incorrect SHA and was cancelled (run 37240357195); it provides no deployment evidence.
- Frontend: https://deploy-preview-1047--playkcswh.netlify.app/poker/table-v2.html. `/js/build-info.js` confirms full runtime commitHash, isPreview=true and pokerWsPreviewUrl=`wss://ws-preview.kcswh.pl/ws`.
- Runtime-SHA CI: Tests (core, Playwright, WS persistence integration, chips retention integration), WS PR Checks, WS Server Deploy validation, CI, migration guard, Infra VPS, catalog and Netlify preview checks succeeded. WS Server Deploy PR validation is not deployment; only the manual preview run above proves WS deployment.
- Required authenticated Stage Gift Shop smoke: **PENDING**, no login credentials in this environment. Existing CI Playwright is not a substitute for the issue's gift smoke. Cover cheap/premium gifts to human/self/bot, exact CH/BURN, insufficient funds, duplicate/retry, 3-second cooldown, ordinary rendering/reconnect/resync, leave/rejoin, mobile/reduced-motion and normal poker actions/settlement. No Production smoke.
- Production-equivalent schema is prepared and identity-gated; **not applied by this task**, current Production presence not verified. Separate owner GO required before Production DB mutation; compatible schema must be verified before Production-deploying merge.

Subsequent commits only record this evidence in SpecKit. A diff against the runtime SHA must contain only specs/**; no runtime/deployable/configuration change is permitted without redeploy and smoke.

Status: implementation ready, awaiting manual runtime verification. T013 remains incomplete until the mandatory authenticated smoke is confirmed; T014 Production handoff is prepared, owner-gated; final completion gate T015 remains pending those required outcomes. Do not merge.
