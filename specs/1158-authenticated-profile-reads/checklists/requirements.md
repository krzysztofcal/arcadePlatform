# Specification Quality Checklist — #1158

Local preparation2026-10-28; [spec](../spec.md), [plan](../plan.md).

- [x] Scope follows live OWNER issue decision; anonymous APIs, not just HTML, are gated.
- [x] Owner, operator suppression, table identities, independent leaderboard preference and finance boundaries preserved.
- [x] OWNER chose existing external-browser login fallback; no token handoff/SSO.
- [x] Edge cases cover initial session, expiration, account switch, logout, in-flight responses and browser Back cache.
- [x] Fundamental existing tests only; no UI/CSS/layout framework or funded coverage requirement.
- [x] Stack/Preview environment, automatic APK, squash ancestry, exactSHA and release gates explicit.
- [x] PL/EN/immutable legal versions/Google Play dependencies separated from implementation; LEGAL OPEN.
- [x] No unresolved fact is treated as PASS: actual child Preview and manual acceptance remain gates.
- [x] OWNER local implementation and fallback approval received; no push or release approval.
