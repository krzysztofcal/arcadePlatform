# Canonical bot seeding

## User story US1 (P1)
Fresh NORMAL/SLOW JOIN on an Enabled canonical tier with both exact pools provisioned seeds configured bots from the exact class/tier pool. Production table 0d031387-e0cc-4819-93a4-bc40227ed1f8 exposed a premature legacy 100/500 guard.

## Requirements
- seedBotsForJoin resolves funding once via getBotFundingSystemKeyForBuyIn with resolved poolClass. Legacy callers without class retain existing 100/500 behavior.
- Disabled/unprovisioned/unknown/invalid class cannot fund; no cross-tier/class/TREASURY fallback.
- Pure rollover replacement/top-up planning accepts the canonical catalog; existing snapshot decision and persistence retain sole funding authority. CONTINUOUS_BOT remains 100 CH.
- No schema/config/framework/refill/caps/accounting changes. No Production mutation/deploy/merge.

## Acceptance
Fundamental existing-suite regressions cover fresh NORMAL/SLOW 1000, representative 10M, exact ledger debits and denial, plus 100/500. Exact runtime-SHA WS Preview deployment and focused fresh JOIN smoke precede merge-ready.
