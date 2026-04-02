# Poker hole-cards normalization (historical note)

## Status

This document is kept only as historical context for a former HTTP `poker-get-table` implementation detail.

Current runtime policy is unambiguous:

- Active table gameplay runtime is **WS-only**.
- `poker-get-table` is a **retired HTTP stub** that returns `410` and is not a gameplay read model.
- HTTP gameplay endpoints are retired contract shims and must not be used for runtime bootstrap, refresh, or resync.

## Historical context (retired path)

In the retired HTTP path, `poker-get-table` could fail with `state_invalid` when hole cards were stored as stringified JSON arrays and not normalized to arrays before validation.

That behavior no longer defines active runtime semantics and is intentionally not an active fallback path.

## Verification path (active)

Use WS-focused coverage for runtime verification (`tests/poker-ui-ws-*.behavior.test.mjs`, WS guard tests, and `ws-tests/*`).
