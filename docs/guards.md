# XP Guardrails

Two guard scripts protect XP lifecycle integration and badge placement. Run them with:

```
npm run check:all
```

## Lifecycle centralization

`npm run check:lifecycle` ensures that lifecycle event listeners and direct `window.XP` session controls live in `js/xp.js` unless an explicit temporary waiver is documented.

- Allowed files are listed in `guard.config.json` under `lifecycle.allowedFiles`.
- Temporary exceptions require a same-line comment `/* xp-guard:allow-adhoc <ticket> */`.
- Violations are reported with offending line numbers to help move code back into `js/xp.js`.

## XP badge expectations

`npm run check:xpbadge` loads each HTML file and verifies there is at most one XP badge element and that it has the configured id.

- The selector and expected id are defined in `guard.config.json` under `badge`.
- Pages without the badge are ignored, but if present there must be exactly one `a.xp-badge#xpBadge` element.

## Git hooks and CI

The Husky pre-commit hook runs `npm run precommit:run`, which includes these guard checks alongside tests (advisory by default). GitHub Actions executes the same checks in CI. Set `STRICT_GUARDS=1` to turn warnings into failures when you are ready to enforce them.
