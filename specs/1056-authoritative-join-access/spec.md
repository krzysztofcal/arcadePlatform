# #1056 Authoritative JOIN access preservation

Source of truth: live GitHub issue #1056; base main87f9153e. WS authoritative layer only. Shared executePokerJoinAuthoritative returns fresh trusted access; normalizeSuccess currently drops it, disabling existing handleJoinCommand cachePokerAccess. Preserve it with existing optional semantics; do not invent access for absent payloads. Existing schema-backed access checks remain fail closed.

Acceptance: adapter preserves supplied access; fresh SETTLED JOIN fills existing access cache, publishes WAITING_NEXT_HAND and automatically reaches legal new PREFLOP without periodic-refresh dependence. Existing validations, JOIN funding/idempotency, handler cache, scheduler/retry/interval/table-manager remain unchanged. No UI, ledger, settlement, inactive policy, protocol field, extra refresher, dependency, migration or broad logs.

Stage investigation table4855ec75-c33d-443f-b7d0-002decf688c5 had32.734879s settlement-to-first-action gap; exact historical attempt unknown because DEBUG telemetry absent. Do not claim this timing identifies a particular retry. #1049/#1054/#1055 remain separate.

Verification: two existing fundamental deterministic runtime regressions; required checks; exact latest runtime SHA WS Preview Deploy/metadata/health; one authenticated Stage fresh SETTLED JOIN smoke through Deploy Preview and existing auth/funding/leave. Stage fixture mutations only through existing services, no direct state/balance writer. No Production deploy/mutation or merge. Breaking public impact: none; removes unnecessary access-cache wait.
