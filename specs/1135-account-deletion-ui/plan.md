# #1135 — Account Deletion UI

Scope: account.html, css/portal.css, js/account-page.js and js/i18n.js only; backend/API/lifecycle/financial behavior unchanged. Reuse account buttons, Poppins/dark Arcade surfaces and native dialog infrastructure styled as an Arcade modal; no framework or inline script. Safe initial focus Cancel, close/ESC/backdrop cancel, keyboard trap and focus return. Unsupported showModal fails closed without POST. Existing avatar/handle confirms remain unchanged.

Preserve authenticated GET before consent/POST, received-request acknowledgement/sign-out, busy/double-submit protection and one-time uncertain response lookup. Confirmed retry retains consent; stale owner/session changes cannot POST. POST payload stays confirmation=DELETE_ACCOUNT and acknowledgeForfeiture=true.

Fundamental regression tests extend tests/account-page.test.mjs only: cancel/ESC/focus, exactly one POST, existing request, lost response and retry. Register the existing account-page file in scripts/test-all.mjs so fundamental deletion regressions execute in CI. Existing syntax/CSP/guards/CI; manual browser visual review at desktop/mobile in PL/EN, no UI snapshots.

Stage-only Netlify PR Preview, pinned Supabase Stage and Redis V3 namespace, no Production variable/configuration change. Keep Stage DB admission OFF; no actual deletion POST or new request during review. If necessary the PR-only Functions flag may expose authenticated GET for visual confirmation, but DB admission must be freshly verified OFF before and after; do not activate DB/WS deletion. No WS runtime changes/deploy required. No migration or financial operation. Draft PR and owner visual review before merge.

Compatibility: native dialog requires supported modern browsers; no unsafe window.confirm fallback. CSS changes scoped to Danger Zone/dialog. Account.html remains JSP-compatible; no new CSP script hash needed.
