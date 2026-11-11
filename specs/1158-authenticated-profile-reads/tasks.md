# Tasks: #1158 independent authenticated-read scope

Status: local implementation GO received, branch based on #1155 SHA810a77b1. No checkbox below authorizes push, PR, apply or release.

- [x] T001 Read live #1158/#1154 and parent/currentmain; document minimal browser-login fallback recommendation and separate approvals.
- [x] T002 Prepare spec/plan/stack/release constraints locally; initial proposal preserved until later OWNER authorization.
- [x] T003 OWNER accepts fallback UX and grants scoped implementation; start child from final published parent SHA, keep only child work in its review diff.
- [x] T004 Gate profile-public and xp-leaderboard with existing JWT verifier; keep OPTIONS/CORS, block and independent ranking privacy; no-store all gated results. Extend only existing fundamental HTTP tests including fail-closed schema/verifier failure.
- [x] T005 Adapt ProfileClient/public-profile-page/leaderboard-page using auth bridge, initial-session wait, identity-generation invalidation, sign-out/account-switch/pageshow and existing login navigation. Preserve owner and Poker paths. Add only missing fundamental session-race assertions.
- [x] T006 Update PL/EN signup/Google/profile/leaderboard copy and noindex headers/meta; keep CSP/AdSense removal. Prepare legal/version/Play disclosure delta for separate publication approval, not TermsON.
- [x] T007 Syntax/CSP/SRI, relevant fundamental regression and independent self-review. Verify no WS source/protocol/dependency change; otherwise prepare separate exact-SHA WS gate.
- [ ] T008 Separate GO for Draft stacked PR/push, expected CI/Netlify/automatic hosted APK effects. Validate new Preview exactSHA and branch-scoped Stage config; preserve parent Draft and no Stage APPLY.
- [ ] T009 Separate nonfinancial Preview acceptance: direct anonymous401, signed-in200, existing blocked test fixture404/opt-out excluded, owner unchanged; manual WWW logout/Back/session switch. No live block/unblock or funded smoke without its own GO.
- [ ] T010 Separate authorized Android test artifact pinning child API Preview, then OWNER physical browser-login fallback acceptance. No JWT transfer, app/browser accounts remain separate. #1154 discovery updated in future authorized issue work, not silently closed now.
- [ ] T011 Reconcile legal/Play publication versions and privacy/children risks; LEGAL remains OPEN until justified acceptance, not just product approval.
- [ ] T012 After parent merge authorization/result, reconcile stack against actual squash main and review final delta. Separate coordinated Production release GO for compatible parent+child code, preserved schema and guarded code rollback; no Terms/flag activation implied.

Local T003–T007 completion covers implemented code, draft-only PL/EN/Play delta and fundamental checks, not hosted or physical acceptance. #1154 comment update attempted under explicit OWNER instruction but GitHub returned403 (token permission); prepared text in issue-1154-decision.md. No retry/bypass. Legal review, hosted/physical smoke and all publication gates remain OPEN.
