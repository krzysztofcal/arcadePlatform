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
- [ ] C1 Moderation actions migration and admin endpoint behind existing admin authorization, audited.
- [ ] C2 Admin queue UI in `admin.html`; digest e-mail after the scheduler/mail decision.

## Phase D
- [ ] D1 Consent record, one-time import through the existing avatar path, withdrawal fallback, moderator hide wins.
- [ ] D2 Onboarding checkbox (unticked, optional) and Account withdrawal.

## Gates (owner)
- [ ] Privacy/Terms and Data Safety text for reports, blocks, moderation and photo consent.
- [ ] Owner config: `UGC_SAFETY_ENABLED=1` for the deploy-preview context to test (after the Stage apply); outside previews only after phase C.
