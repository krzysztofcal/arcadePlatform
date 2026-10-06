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

## Perimeter/scale owner pass

- [x] P001 Re-read live rules/full issue/current PR diff and reconcile superseded constraints.
- [x] P002 Outward physical avatars, nearer dealer anchors, larger equal landscape avatars/composition; inward edge affordances.
- [x] P003 Full wrapped human/bot reactions and northern central safe-lane presentation.
- [x] P004 Existing fundamental checks and self-review; preserve all ownership fixes.
- [x] P005 Real latest-runtime Preview portrait/landscape/screenshots and live evidence.
- [ ] P006 Owner manual smoke and authenticated Stage CH verification; Draft/not merge-ready.

## Landscape casino owner direction

- [x] L001 Re-read live approved direction/reference/current landscape and write short composition plan.
- [x] L002 Original room/dealer assets, coherent six physical slots, large table and compact rail; preserve portrait.
- [x] L003 Top-right account node, restrained center/bottom public event copy; preserve gameplay/ownership/targeted Nice hand.
- [x] L004 Preview FX exclusively in Diagnostics using existing PR Preview BUILD_INFO gate; Production absent.
- [x] L005 Fundamental/required checks, self-review and real latest-runtime Preview screenshots/evidence.
- [ ] L006 Owner landscape smoke and authenticated Stage CH gate; retain Draft/not merge-ready.

## Landscape visual polish

- [x] V001 Re-read live rules/#1048/diff and compare horizontal landscape actions with current main.
- [x] V002 Restore horizontal controls with Hero-safe responsive sizing; original dimensional dealer/luxury room art, landscape-only.
- [x] V003 Existing focused tests 127/127 and required syntax/lifecycle/badge/CSP guards; self-review.
- [x] V004 Publish exact browser runtime SHA and real Preview screenshots/evidence; full CI tracked below/in PR checks.
- [ ] V005 Owner visual smoke and authenticated Stage CH gate; Draft/not merge-ready.

## Premium portrait / landscape readability

- [x] R001 Reconcile live rules/issue/diff and amend plan for newly authorized portrait scope.
- [x] R002 Physical landscape seat/dealer reconciliation and readable font sizes.
- [x] R003 Premium portrait table/room/same dealer, outward seats and northern opening; preserve lifecycle/controls.
- [x] R004 Existing focused/required checks, self-review, latest-runtime real Preview/screenshots and full CI.
- [ ] R005 Owner smoke and authenticated Stage CH gate; Draft/not merge-ready.

## Small positioning polish

- [x] S001 Reconcile rules/live issue/physical mapping and generic reaction-button padding.
- [x] S002 Requested physical seat/stack/dealer anchors and icon centering; retain scale/ownership/semantics.
- [x] S003 Existing focused/required checks, self-review, exact browser Preview/screenshots and full CI.
- [ ] S004 Owner smoke and authenticated Stage CH gate; Draft/not merge-ready.

## Chip association / best-hand readability

- [x] A001 Trace current physical stack/bet/best-hand presentation and update narrow plan.
- [x] A002 Landscape top chips below name; portrait lower-left/Hero ownership anchors; readable mini symbols/rank10.
- [x] A003 Existing focused/required checks, self-review, exact Preview screenshots/evidence and full CI.
- [ ] A004 Owner smoke and authenticated Stage CH gate; Draft/not merge-ready.


## Owner reaction word wrapping correction
- [ ] R001 Normal-word wrapping and bounded edge bubble: controlled RED → GREEN browser regression, focused/required checks and Preview evidence.
