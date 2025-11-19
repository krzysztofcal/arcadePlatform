# Speckit Codex — XP bridge doc sync

## Affected files
- `docs/guards.md`: Update the XP bridge wiring section to reference the combo/scoring/core module scripts plus the existing bootstrapper and `xp.js` / hook tags.

## Methods / touch-points
- Revise the "XP bridge wiring" bullet list to enumerate the four script tags plus the inline bootstrapper.
- Extend the "Bridge guard scope & remediation" description so it states the guard enforces the four module files alongside `xp.js` and the bridge snippet.

## UI rules
- Documentation only; no UI adjustments required.

## Acceptance criteria
- Guard doc clearly lists `/js/debug.js`, `/js/xp/combo.js`, `/js/xp/scoring.js`, `/js/xp/core.js`, `/js/xp.js`, and `/js/xp-game-hook.js` (with the inline auto bootstrap) as required for playable pages.
- The guard workflow description matches the updated enforcement behaviour so contributors know the expected order and asset list.

## Tests
- `npm test` (confidence check even though the change is docs-only).

## Breaking impact
- None; documentation-only alignment.
