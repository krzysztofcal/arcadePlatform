# Tasks: rollout gates (#1310)

Nothing is authorized yet. Each task needs its own OWNER GO, except plan review.

- [ ] T001 [P0] Read-only Production inventory, covering every row marked "to verify" in plan §1 plus the current `ensure_user_profile` body. No identifiers in the report. Also confirm that Privacy a4 covers g2 and reports/blocks.
- [ ] T002 [US1] Stage acceptance:
  - get an OWNER GO for the Netlify branch or deploy-preview flag overrides on the acceptance PR;
  - the OWNER runs the US1 checks on the Deploy Preview and on the Stage APK;
  - record the sanitized evidence in #1310.
- [ ] T003 [P1] Draft PR with the production equivalents for B, C and D, the manifest entries and a fundamental contract fixture; Codex review; OWNER merge.
- [ ] T004 [P1] Draft PR with `enable-catalog-production.sql` (Production pins and confirmation, rollback file); Codex review; OWNER merge.
- [ ] T005 Moderation operating process documented by the OWNER (owner, cadence, response time, hold policy).
- [ ] T006 [P2–P6] Production steps in plan §4 order, each with its own GO and read-only receipts.
- [ ] T007 [P7–P8] New Candidate (T007 path) and feature-ON smoke; OWNER Publish; then `POKER_TABLE_PHOTO_ENABLED=1`.
