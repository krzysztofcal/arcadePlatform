# XP Guardrails

Two guard scripts protect XP lifecycle integration and badge placement. Run them with:

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

## Score-mode limits

Score-driven awards add rolling rate and burst limits so that large score deltas are metered in addition to the existing visibility/input gates. The new thresholds stack on top of the legacy guards—windows must still satisfy the time-based activity checks before the score buckets are considered.

## Git hooks and CI

The Husky pre-commit hook uses `lint-staged` so only changed HTML/JS files are checked locally. GitHub Actions runs `npm run check:all` as a required status along with the test suite (set `CI_NO_E2E=1` to skip Playwright in restricted environments).
