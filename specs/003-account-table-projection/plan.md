# Implementation Plan: Account Poker Table Projection

**Branch**: `003-account-table-projection` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

Add an opt-in Account projection to `netlify/functions/profile-me.mjs`. It combines the existing owner profile and chips-ledger balance with a best-effort read-only projection fetched from the token-protected WS server. The WS server delegates table membership and sanitized table fields to `tableManager`; the Account page requests the opt-in response and abbreviates only the visible table label while retaining the complete ID in DOM data.

## Technical Context

**Language/Version**: Node.js ESM on Netlify Functions and Node.js WS server; browser JavaScript is classic JSP-compatible IIFE code.

**Primary Dependencies**: Existing `ws`, Supabase admin/ledger helpers, `ProfileClient`, `tableManager`, and `klog`; no new dependency.

**Storage**: Existing chips ledger and existing WS runtime/persistence bootstrap. No schema or migration change.

**Testing**: Node built-in `node:test` behavior suites, existing Account-page VM harness, syntax checks, and the repository test runner.

**Target Platform**: Netlify deploy-preview/production functions, Ubuntu WS runtime, and existing desktop/mobile Account page.

**Performance Goals**: One bounded WS projection request per opt-in Account profile load; the existing WS internal timeout bounds the optional dependency and does not block the balance result when WS is unavailable.

**Constraints**: Preserve the existing profile-me GET/PATCH contract without `includePoker=1`; never synthesize a balance on error; never expose private poker state; never abbreviate backend identifiers; keep the WS Preview Deploy gate for `ws-server/**` and browser/WS protocol changes.

**Scale/Scope**: One authenticated user projection over currently materialized WS tables, with a small sanitized table list; no table actions, persistence changes, or broad UI test suite.

## Constitution Check

Pre-research: PASS. The change extends `profile-me`, `poker-ws-runtime-notify`, `table-manager`, `server.mjs`, `profile-client`, and the existing Account page instead of introducing a parallel table source, database query, dependency, or browser module. WS runtime state remains authoritative; the chips ledger remains the balance authority. Failure is safe (`poker: null`, no fabricated balance), logging uses `klog`, and private state is excluded.

Post-design: PASS. The design has no schema/config/ignore/dependency edits, uses existing internal-token and timeout patterns, keeps JSP/CSP compatibility, extends existing deterministic behavior tests, and names the exact WS Preview Deploy gate required before preview E2E verification. No Production action or PR merge is part of the plan.

## Project Structure

### Documentation

```text
specs/003-account-table-projection/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/account-poker-projection.md
└── tasks.md
```

### Source and Tests

```text
netlify/functions/profile-me.mjs
netlify/functions/_shared/poker-ws-runtime-notify.mjs
ws-server/poker/table/table-manager.mjs
ws-server/server.mjs
js/profile-client.js
js/account-page.js
js/i18n.js
account.html
tests/public-profiles.behavior.test.mjs
tests/public-profile-ui.contract.test.mjs
ws-server/poker/table/table-manager.behavior.test.mjs
ws-server/server.behavior.test.mjs
tests/account-page.test.mjs
```

**Structure Decision**: Reuse the existing Netlify function, shared WS adapter, WS internal HTTP routing, table manager, global browser clients, Account markup, and their current behavior tests. No new project or test suite is introduced.

## Implementation Phases

1. Add failing tests for the profile response success/fallback and the table-manager projection contract; add the minimal server-route and Account rendering assertions needed by the accepted scenarios.
2. Implement `tableManager.projectUserTables(userId)` using authoritative core members, `tableSnapshot`, and `tableMeta`, returning only sanitized fields with the complete `tableId`.
3. Add the token-protected read-only WS route and the existing shared adapter call. Extend `profile-me` only for exact `includePoker=1`; resolve balance independently and convert WS failure/invalid output to `poker: null`.
4. Extend the existing ProfileClient request options and Account-page rendering. Keep the full ID in `data-table-id`/navigation values and use a UI-only abbreviation helper for visible text.
5. Run targeted tests, syntax/full checks, self-review, and the exact-SHA WS Preview Deploy. Only after the deploy succeeds for the implementation SHA run preview E2E verification.

## Complexity Tracking

No constitution violations or new abstraction beyond the existing WS internal adapter seam. The only new helper is the small projection method/normalizer required to keep the WS authority and the Netlify response contract explicit.
