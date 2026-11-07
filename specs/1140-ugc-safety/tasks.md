# #1140 UGC safety — tasks

## Phase B
- [x] B1-T1 Migration: private report and block tables, constraints, RLS, grants, cascade on account deletion.
  Accept: PGlite applies it; browser roles get permission denied; self block and inconsistent states refused.
- [x] B1-T2 Server module and endpoints `ugc-report`, `user-blocks`. Accept: signed-in only, dark by default,
  fixed reasons, server evidence, open-report dedupe, block cap 500, rate limits fail closed, deletion lifecycle
  refusal, internal errors not echoed.
- [x] B1-T3 Fundamental tests registered in the standard runner; migration manifest entry; migration check PASS.
- [ ] B1-T4 Owner: Stage apply of the migration (DB Stage Apply PR dispatch) when B2 is ready for a Preview check.
- [ ] B2-T1 `js/ugc-client.js` and profile page Report/Block/Unblock with reason dialog and confirmation.
- [ ] B2-T2 Account "Blocked players" list with Unblock.
- [ ] B2-T3 Table seat Report/Block; masked avatar and hidden reactions/gifts of blocked users on the blocker's client
  only; seats, turns, actions and chips unchanged.
- [ ] B2-T4 PL/EN strings, APK packaging of the script, fundamental client tests for the filter and the request
  shapes; physical WWW and Android check after Stage apply (owner).

## Phase C
- [x] C1-T1 Migration: audit and avatar hold tables, audited profile-restriction function; RLS, grants, cascade;
  manifest entry; migration check PASS. Accept: PGlite with and without #1155; browser roles get permission denied.
- [x] C1-T2 `_shared/ugc-moderation.mjs` and `admin-ugc-reports`: admin only, dark by default, oldest-first queue
  with pending counter, one decision per report (409 on the second), failed action rolls back, audit rows,
  internal errors not echoed.
- [x] C2-T1 "Reports" tab in `admin.html` with the pending counter read on open/refresh (no polling), status filter,
  confirmed actions, profile restore; fundamental UI tests.
- [x] C1-T3 Anonymous total of pending reports removed by account deletion (trigger, admin tab line) and 409
  `account_deleting`; PGlite tests with real deletion, rollback, decided/other deletions not counted; mutation-checked.
- [ ] C-T3 Owner: Stage apply of the migration (DB Stage Apply PR dispatch) and a Preview check with an admin account.
- Not built (owner decision 2026-11-07): e-mail, mail provider, digest, scheduled job, automatic alerts.

## Phase D
- [ ] D1 Consent record, one-time import through the existing avatar path, withdrawal fallback, moderator hide wins.
- [ ] D2 Onboarding checkbox (unticked, optional) and Account withdrawal.

## Gates (owner)
- [ ] Privacy/Terms and Data Safety text for reports, blocks, moderation and photo consent.
- [ ] Manual review procedure for the Reports tab (who, how often, response time) before public activation.
- [ ] Owner config: `UGC_SAFETY_ENABLED=1` for the deploy-preview context to test (after the Stage apply); outside previews only after phase C.
