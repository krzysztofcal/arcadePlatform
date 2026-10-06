# Tasks — owner replacement after smoke FAIL

Earlier T003/T008 seat-grid implementation and 20/20 evidence are superseded by owner FAIL. Earlier accepted CH HUD P1/P2 work is retained; it does not establish layout acceptance.

- [x] R001 Re-read live #1048, agents.md, skills.md, main and #1049 diff; reconcile rejected direction.
- [x] R002 Replace SpecKit plan/spec/tasks before implementation; record old evidence rejection.
- [x] R003 Restore Poker V2 visual assets and implement one renderer with six static seat variants and portrait/landscape geometry.
- [x] R004 Scale one composition between top HUD and bottom controls; no page scroll; protect center and hero best hand.
- [x] R005 Preserve accepted CH HUD and stable three circular gift anchors + one quick-action anchor without behavior.
- [x] R006 Required/fundamental checks and self-review.
- [x] R007 Real Deploy Preview geometry/collision matrix and screenshots for owner review.
- [x] R008 Update live #1048 / existing draft #1049 evidence and handoff.
- [ ] R009 Manual owner smoke of replacement layout and actual authenticated Stage verification; not merge-ready.

## Latest owner correction tasks

- [x] C001 Restore single-row best hand and lower-right action rail; enlarge scene; shift hero left.
- [x] C002 Restore popup clickability; avatar-edge badges/cards/social affordance and avatar-center effect endpoints.
- [x] C003 Remove empty layout tests; retain fundamental privacy, gameplay and Other tables checks.
- [x] C004 Narrow real Deploy Preview sanity/screenshots, self-review and draft handoff; owner acceptance pending.

## P1 participation correction

- [x] P001 Reuse public per-round hand membership and minimally extend existing fundamental snapshot semantics assertions.
- [x] P002 Required checks, self-review and narrow portrait/landscape Preview sanity; keep owner smoke pending.

## Second manual owner smoke

- [x] S001 Read live second owner feedback, repo rules and PR diff; refine existing HUD presentation without redesign.
- [x] S002 Unify occupied avatars, remove ACTIVE/count labels, OPEN content, aligned controls, narrow suit-colored best hand and owner-centered transient UI; preserve motion anchors.
- [x] S003 Required/fundamental checks, self-review and narrow real Preview evidence/screenshots; owner visual acceptance and authenticated Stage remain pending.

## Third manual smoke

- [x] U001 Reconcile live third-pass feedback; trace snapshot/private-card frame paths before smallest browser fix.
- [x] U002 Restore hero special --own, fixed HUD reservation, portrait perimeter/nearby stacks and dealer/card-back/pot polish.
- [x] U003 Fundamental private-card persistence/lifecycle test and required checks; narrow Preview/self-review/screenshots; stop for owner smoke.

## Fresh-JOIN WAITING_NEXT_HAND correction

- [x] J001 Keep ordinary JOIN waiting out of sitout/rebuy UI; preserve actual OUT_OF_CHIPS/rebuy and waiting preaction guard.
- [x] J002 Required/focused checks, whole-PR self-review and narrow real Deploy Preview verification; owner smoke pending.

## Owner private-card flicker blocker

- [x] H001 Reconcile live branch/main and trace empty private projection; add failing exact regression to existing private-card lifecycle case.
- [x] H002 Preserve known active same-hand/same-occupant pair through explicit empty frames; authoritative lifecycle/membership still clears.
- [x] H003 Existing focused tests 121/121, syntax, check:all, ci:guards, CSP and diff whitespace pass; fix self-reviewed.
- [ ] H004 Latest browser runtime SHA served by real Deploy Preview; owner authenticated smoke of table 42c2db29-f7fc-4860-a550-52f59cabea2f remains pending.

H004 publication portion verified for runtime `53e24169ed6bad0cef20b4adb86440e8ee93971a`; owner smoke still pending. Existing WS disconnect-cleanup CI failure persists after one rerun and is documented in review.md; no WS changes added. Required local guards/focused checks remain PASS.

## Current owner FAIL: private presentation / compact chrome

- [x] F001 Reconcile live PR/issue/repo rules and trace auth, snapshot, render ownership; reproduce same-user pending model reset and missing-HUD hide RED before implementation.
- [x] F002 Preserve same-user known model, reconcile explicit authoritative occupant ownership, retain scene-owned card DOM; keep lifecycle revocations. Transition-only privacy-safe klog.
- [x] F003 Compact fixed-height chrome and Total/Poker CH badge; existing Settings Diagnostics and critical notices; minimal northern safe band.
- [x] F004 Fundamental regressions GREEN and required checks; self-review.
- [x] F005 Real latest-SHA Preview portrait/landscape screenshots and live evidence/handoff.
- [ ] F006 Owner manual smoke including Stage flicker transition correlation; authenticated Stage CH verification. Draft/not merge-ready.

## Owner chip flicker correction

- [x] C001 Confirm RED: omitted partial bets disappear; unchanged chip nodes are replaced.
- [x] C002 Persistent scene-owned chip DOM, field-presence/lifecycle semantics; selective amount/occupant updates.
- [x] C003 Fundamental tests 124/124 and required checks; fix self-review.
- [x] C004 Latest runtime real Preview: identical served JS, portrait/landscape nodes/images and pot retained, unchanged values, no scroll; evidence/screenshots saved.
- [ ] C005 Owner chip smoke and authenticated Stage CH verification; full CI status tracked in PR checks.

## Dealer/avatar/transient ownership pass

- [x] O001 Reconcile live rules/PR/issue; three fundamental regressions RED on 307b95b9.
- [x] O002 Scene-owned dealer, explicit/new-hand transitions; keyed avatar reuse and load-owned fallback.
- [x] O003 Common high player transient layer, semantic notification order, physical lower-left portrait stack correction; no landscape redesign.
- [x] O004 Existing focused checks/self-review and ownership audit; 127 focused cases PASS.
- [x] O005 Latest runtime real Preview/screenshots/evidence; full CI status tracked in live PR checks.
- [ ] O006 Owner smoke; authenticated Stage CH verification remains a later gate.
