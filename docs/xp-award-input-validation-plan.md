# XP award payload validation — implementation plan (#729)

Status: accepted and implemented by this PR.

## Goal and boundaries

Reject unsupported games and structurally impossible XP award payloads before any XP session or profile mutation. Preserve the existing XP formulas, atomic ledger, replay protection, caps, boosts, activity rules, and the `status` operation. Per-game anti-cheat policies remain follow-up issue #730.

No database migration, WebSocket change, CSP change, inline script, CSS, or new environment variable is required.

## Current flow and findings

`netlify/functions/calculate-xp.mjs` currently canonicalizes unknown game IDs into a permissive default rule. It also coerces counters, clamps reversed/oversized time windows, and truncates event arrays. Anonymous conversion and signed-session TTL refresh can happen before these inputs are rejected.

The catalog in `js/games.json` contains 26 browser XP games plus `open-poker`. Browser pages publish their current identity in `data-game-id`. Poker is an explicit exception because its XP does not use the browser award endpoint.

A deliberately large legal request fixture was measured at 4,781 UTF-8 bytes: maximum identity/session strings, a 2,048-character signed token, all scalar fields, and 50 current-shape events. The fixed 16 KiB request limit provides more than three times that measured size without an environment-specific policy.

## Implementation tasks

### 1. Supported-game contract

- Update `netlify/functions/_shared/xp-identity.mjs`.
- Export `SUPPORTED_XP_GAME_IDS` and `isSupportedXpGameId()` beside `canonicalizeXpGameId()`.
- Normalize all current `open-*` catalog aliases to their browser IDs.
- Keep Poker outside this allowlist as an explicit transport exception.

### 2. Catalog drift guard

- Extend `scripts/check-games-xp-hook.mjs`, which already runs in CI.
- Compare every non-Poker catalog ID and slug with the allowlist.
- Read each catalog source page and require its `data-game-id` to resolve to the same canonical ID.
- Fail when a supported ID lacks a catalog entry or a catalog browser game is unsupported.

### 3. Pure award normalizer

- Add `netlify/functions/_shared/xp-award-input.mjs`.
- `normalizeXpAwardInput(body, { maxWindowMs })` must not read the clock or mutate state.
- Require a supported non-empty `gameId`; safe-integer `windowStart`, `windowEnd`, and `inputEvents`; a non-negative finite `visibilitySeconds`; and non-negative safe integers for optional `scoreDelta` and `gameplayActions`.
- Reject reversed windows and windows longer than 30 seconds.
- Default optional score/actions/events only when absent. Reject stringified numbers rather than coercing them.
- Require `gameEvents` to be an array with at most 50 entries; do not add per-event policies in this PR.

### 4. Handler ordering and responses

- Update `netlify/functions/calculate-xp.mjs`.
- Reject request bodies over 16 KiB before JSON parsing with `413 payload_too_large`.
- Preserve identity, rate-limit, and signed-session validation, but delay `touchSession()`, anonymous conversion, session-state reads, and all XP writes until the award payload is valid.
- Keep `operation: "status"` outside the award-input gate.
- Return `422 unsupported_game` without exposing the allowlist.
- Return `422 invalid_award_payload` with only an allowlisted `field` name.
- Log only the controlled error and field through `klog`.
- Replace the public `GAME_XP_RULES.default` entry with a private fallback used only after allowlist validation; do not alter supported-game formulas.

### 5. Focused verification

- Extend the existing Node runner with one deterministic helper test covering supported aliases, unsupported games, invalid counters/windows, event count, and the measured payload-size margin.
- Use the existing XP hook guard as the automatic catalog/HTML drift check.
- Run the existing syntax, XP, and full repository suites; do not create a new framework or broad DOM tests.

## Acceptance and manual verification

- A supported game with the current legal request shape still awards XP.
- Unknown games return `422 unsupported_game` and do not change session state, combo, totals, ledger, leaderboard, or profile.
- String, negative, fractional, non-finite internal numeric values, reversed/oversized windows, oversized event arrays, and oversized bodies are rejected without award-state mutation.
- `status` still reads canonical XP without requiring award fields.
- Deploy Preview smoke checks one legal award, one unsupported game, one malformed counter, and one status request.
- Netlify Deploy Preview is required. WS Preview Deploy is not required because no WS runtime imports these modules.

## Rollout, rollback, and breaking impact

Deploy the Netlify function and browser assets together. Monitor controlled `unsupported_game`, `invalid_award_payload`, and `payload_too_large` telemetry. Rollback is a normal code rollback; there is no persistent schema or data transition.

Intentional breaking behavior: unofficial or stale clients relying on unknown game IDs, string-number coercion, negative/fractional counters, window clamping, or event truncation stop earning XP until corrected. Supported games, stored XP, status reads, ledger semantics, and WebSocket poker are unchanged.
