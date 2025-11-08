# XP Guardrails

Three guard scripts protect XP lifecycle integration, badge placement, and the game XP hook wiring. Run them together with:

```
npm run check:all
```

## Lifecycle centralization

- `npm run check:lifecycle` ensures that lifecycle event listeners stay centralized in `js/xp.js` (or an allowed override) with explicit audit trails.

- Allowed files are listed in `guard.config.json` under `lifecycle.allowedFiles`, and the waiver token can be customized via `lifecycle.waiverToken`.
- Temporary exceptions require a same-line comment `// xp-lifecycle-allow: temporary(YYYY-MM-DD)`; the script prints the waiver and expiry.
- The guard exits non-zero when a disallowed listener is found and surfaces the file/line plus a one-line summary.

## XP badge expectations

`npm run check:xpbadge` walks committed HTML and enforces exactly one `<a id="xpBadge" class*="xp-badge">` per page.

- The selector and expected id are defined in `guard.config.json` under `badge`.
- Run with `--fix` to automatically add the id to a single badge anchor or strip an accidental `id="xpBadge"` from the label.
- Each run prints a short summary such as `Badge: OK (9 pages)` or highlights the first violation for quick triage.

## XP bridge wiring

`npm run check:games-xp-hook` ensures every committed playable HTML page includes exactly one copy of the three XP bridge snippets injected by `npm run wire:xp`:

- `<script src="…/xp.js" defer></script>`
- `<script src="…/xp-game-hook.js" defer></script>`
- The inline bootstrapper that calls `GameXpBridge.auto()` after DOM readiness.

The script fails fast when any of the tags are missing or duplicated and reports the offending pages.

## Score-mode limits

Score-driven awards add rolling rate and burst limits so that large score deltas are metered in addition to the existing visibility/input gates. The new thresholds stack on top of the legacy guards—windows must still satisfy the time-based activity checks before the score buckets are considered.

## Git hooks and CI

The Husky pre-commit hook uses `lint-staged` so only changed HTML/JS files are checked locally. The XP hook guard runs alongside the badge and lifecycle checks for staged HTML. GitHub Actions runs `npm run check:all` as a required status along with the test suite (set `CI_NO_E2E=1` to skip Playwright in restricted environments).
