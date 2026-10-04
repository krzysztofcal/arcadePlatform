# Implementation plan — #1042

Accepted architecture and task sequence: spec.md (live issue #1042), parent #786. Baseline origin/main: 4f798bdd56dba0e11b34e8982895650920ec6944.

## Constitution Check

PASS: only fundamental deterministic accounting/domain/WS tests (T010/T011). No UI/CSS/JSP/glue tests, dependencies, tooling cleanup or generic framework. JSP globals; klog only; CSS one physical line per selector. WS owns gameplay; gifts do not change gameplay/ESCROW/settlement/bot bankroll/progression/recipient CH.

## Reconciliation

The WS table ledger wrapper is specialized for table lifecycle. Use the canonical netlify/functions/_shared/chips-ledger.mjs::postTransaction with the same tx; current WS deployment already packages that ledger and root shared/poker-domain. No wrapper ledger extension or deployment configuration change needed.

## Rollout

Publishing supabase/migrations intentionally permits DB Stage Apply PR to create only empty receipts/indexes/RLS, with zero CH/data mutations. Prepare Production-equivalent schema and exhaustive manifest; do not apply Production. Exact runtime-SHA WS Preview Deploy and mandatory authenticated Stage smoke are required; pending smoke means not merge-ready.

The exhaustive migration guard scripts/check-db-migrations.mjs hardcodes inventory/category counts. Update only these counts for the required new manifest entry (54 missing, 33 needs-production-equivalent); this exact tooling change is required by T003, not cleanup.

T012 requires registering the two focused gift suites in scripts/test-all.mjs and classifying the two gift diagnostics in ws-server/poker/observability/poker-log-policy.mjs. Existing vitest-only tests/chips-ledger.test.mjs is not runnable with installed repo dependencies; extend the existing Node canonical-ledger suite tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt migration constraints/RLS/indexes are exercised with existing PGlite in the focused domain suite; external migration DB suite remains gated by CHIPS_MIGRATIONS_TEST_DB_URL. No new framework/dependency.

Gift table/seat row locks use NOWAIT: current gameplay persistence can project seats before updating table activity. Reject a contended gift transaction immediately rather than creating table→seat vs seat→table lock waits. This preserves required validation/atomicity without changing gameplay locking. DB clock_timestamp after buyer advisory lock enforces cooldown; SQL to_char(joined_at) preserves microseconds. Gift recovery/broadcast uses a short per-table cosmetic promise chain separate from the gameplay queue. Every purchase is followed by authoritative aggregate state; storage errors return no recovery frame (never false empty state).

Review correction: the existing seat protocol does not expose joined_at. Keep it private and broadcast current receipt aggregates to all table connections after every accepted authenticated join (including same-user rejoin). This clears old participation badges even when an observer missed the intermediate absence. Browser clears disappeared/changed owners locally; DB exact participation joins remain final authority. Recovery is scheduled without awaiting it on gameplay lifecycle paths, and resume recovery follows replay frames.

The canonical ledger import is lazy after DB availability/auth validation, matching existing shared-domain adapters and keeping file-backed WS startup compatible with WS-package-only CI dependencies. Deploy packages already include root shared/ledger/dependencies.
