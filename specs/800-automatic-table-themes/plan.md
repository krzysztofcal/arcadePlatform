# Implementation Plan — #800

Approved frontend-only scope. Base: origin/main 22e4d043d90ae164825df7d85b383043bd7248c7.

## Design and concrete changes
- poker/poker-v2.js: keep TABLE_THEME_CATALOG in fixed Classic/Royal/Neon/Midnight/Crimson/Emerald order. Add resolveTableThemeId(tableId), FNV-1a over trimmed ID UTF-16 code units (same normalization as PokerWsClient) using Math.imul/unsigned 32-bit arithmetic, modulo six. Missing/non-string/blank ID -> Classic; no RNG, clock, identity or storage inputs. Catalog order/hash is a stable compatibility contract.
- Generalize applyPreviewTheme(themeId) to applyTableTheme(themeId); remove Preview-only gate and selector/status coupling. Reuse Promise.all over all seven existing assets, naturalWidth check, 15-second timeout and generation guard. Classic removes data-table-theme; failure explicitly restores Classic and uses klog. init() applies once after selectElements(); snapshots/auth/hand/reconnect never invoke theme loading. Full reload recomputes same assignment and retries assets if necessary.
- bindCelebrationPreview(): remove only theme label/select/status/change handler; retain unrelated FX review controls and their isThemePreviewBuild() gate.
- poker/poker-v2.css: rename existing data-preview-theme to data-table-theme; retain art/layout and one physical line per selector.
- poker/table-v2.html: inspect existing deferred loading; no change/new inline script expected. No CSP SHA changes needed unless an inline script is introduced.
- tests/poker-v2-live.behavior.test.mjs: extend existing VM harness with controllable Image outcomes; only fundamental agreement, stable reload/reconnect and fallback scenarios. Run existing live/reconnect and authoritative join/rebuy regressions. No UI/layout suite or dependencies.

## Constitution Check before implementation
Pass: existing architecture/catalog/loader; JSP IIFE; klog; one-line CSS; fundamental deterministic tests only; no configuration/dependency/ignore edits, database mutations or backend/protocol changes. WS and ledger remain authoritative. No Production or merge. No WS Preview Deploy is required for this presentation-only diff.

## Verification
Run failing fundamental tests before implementation, then focused suite and existing relevant regressions. Check syntax, CSP/lifecycle guards and diff. Self-review async loader, deterministic arithmetic/catalog order, fallback, removal of chooser and untouched economics/reconnect. Create Draft PR linked to #800 and verify CI and Netlify Preview at exact head. Use existing browser tooling for portrait/landscape, different tables, reload and network recovery; state limits of mocks versus authenticated runtime evidence.

## Rollout
Every table uses the same resolver. No legacy classification, migrations or client version mechanism. Owner accepts a one-time manual refresh of own cards after future deployment; this task does not authorize Production.
