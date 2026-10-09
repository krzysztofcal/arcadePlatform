# Review and validation — #1042

Author review covers simplicity, idempotency, ledger invariants, breaking impact and agents.md/skills.md compliance. Independent review via requesting-code-review found observer same-user rejoin badge retention, corrected by broadcasting authoritative participation-filtered gift aggregates after accepted joins; the real WS test covers observer recovery. Resume recovery now follows replay frames. DB exact joined_at (microseconds) remains private and authoritative. Recovery work does not occupy the gameplay command queue.

Existing postTransaction receives the same caller tx. BURN has exactly USER(-catalog price) and SYSTEM/GENESIS(+catalog price), no recipient/ESCROW/TREASURY/HOUSE/bot-pool entry. Unique hashed purchase key and buyer/table advisory lock serialize replay/cooldown. Receipt and BURN roll back together. NOWAIT row locks avoid conflicting with gameplay projection lock order. No second payment system, dependency, browser module, inline script, console logging or unrelated cleanup.

Intentional additive breaking effects: backend-only receipt schema, CH sink, gift_send/table_gift/table_gift_state vocabulary. Compatible Production schema is required before Production-deploying merge; owner GO is separate and no Production mutation was performed.

Local evidence: focused PGlite purchase/migration + handler 12/12; canonical Node ledger suite passes; existing browser/WS client runtime 148/148; final WS server suite 140/140; npm test passes (DB-gated suites explicitly skip without credentials). Syntax, check:all, ci:guards, CSP inline guard and exhaustive migration guard pass (108 Stage source files, 7 Production replacements). No UI/CSS/JSP test expansion.

The vitest-only tests/chips-ledger.test.mjs cannot run with installed repo dependencies. Accounting coverage extends existing tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt constraints/RLS/indexes execute in the focused suite using existing PGlite, avoiding an external mutation/test database. These narrow plan/code reconciliations are recorded in plan.md.

Required runtime evidence (to record after publication): Stage migration apply, exact-SHA WS Preview Deploy, RELEASE_SHA == DEPLOY_REF, mandatory authenticated Deploy Preview -> WS Preview smoke. Authenticated Stage credentials are not present in this environment; manual smoke remains required and the draft must not be described as merge-ready.

## Published runtime evidence (2026-10-04 UTC)

- Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1047 (not merge-ready).
- Initial runtime-affecting SHA (superseded by review correction below): `eb4144882028f44233609ade15b1323b553e9564`.
- Stage Apply: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37240353552 — success. Log: 107 applied / 1 pending, then applied `20261004220956_poker_gift_purchases.sql` with CREATE TABLE / ALTER TABLE / REVOKE / GRANT / two CREATE INDEX statements. Schema-only source; no receipts/ledger/CH changes. Applied source is immutable.
- Exact-SHA WS Preview Deploy: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37240373077 — success. Workflow selected from main; input ref equals the runtime SHA. Checks compare `releaseSha`/`deployRef` to that SHA in extracted artifact, installed-before-restart and installed-after-restart metadata; local/public health gates pass. Additional public `/healthz` returns `ok`.
- First dispatch had an incorrect SHA and was cancelled (run 37240357195); it provides no deployment evidence.
- Frontend: https://deploy-preview-1047--playkcswh.netlify.app/poker/table-v2.html. `/js/build-info.js` confirms full runtime commitHash, isPreview=true and pokerWsPreviewUrl=`wss://ws-preview.kcswh.pl/ws`.
- Runtime-SHA CI: Tests (core, Playwright, WS persistence integration, chips retention integration), WS PR Checks, WS Server Deploy validation, CI, migration guard, Infra VPS, catalog and Netlify preview checks succeeded. WS Server Deploy PR validation is not deployment; only the manual preview run above proves WS deployment.
- Required authenticated Stage Gift Shop smoke: **PENDING**, no login credentials in this environment. Existing CI Playwright is not a substitute for the issue's gift smoke. Cover cheap/premium gifts to human/self/bot, exact CH/BURN, insufficient funds, duplicate/retry, 3-second cooldown, ordinary rendering/reconnect/resync, leave/rejoin, mobile/reduced-motion and normal poker actions/settlement. No Production smoke.
- Production-equivalent schema is prepared and identity-gated; **not applied by this task**, current Production presence not verified. Separate owner GO required before Production DB mutation; compatible schema must be verified before Production-deploying merge.

Subsequent commits only record this evidence in SpecKit. A diff against the runtime SHA must contain only specs/**; no runtime/deployable/configuration change is permitted without redeploy and smoke.

Status: implementation ready, awaiting manual runtime verification. T013 remains incomplete until the mandatory authenticated smoke is confirmed; T014 Production handoff is prepared, owner-gated; final completion gate T015 remains pending those required outcomes. Do not merge.

## PR #1047 review correction (2026-10-05 UTC)

P1: author diff review confirms the only runtime change is guarding table_gift with outcome.replayed !== true; accepted response and current table_gift_state remain common to new/replayed purchases. Ledger, receipt atomicity, gameplay and schema are unchanged. No delivery framework/outbox or breaking envelope change. Existing fundamental socket test fails before the fix (2 events vs 1), then passes: one event on first purchase, accepted replay/current state with no second event. Its financial adapter is mocked with one BURN/receipt counter; focused PGlite purchase tests separately prove real SQL receipt cardinality and transactional BURN replay behavior.

Follow-up validation: focused gift purchase/migration/handler 12/12; selected real WS gift test 1/1; canonical Node ledger suite passes. Syntax, check:all, ci:guards, CSP, migration guard and diff whitespace pass. No full local suites or new dependencies. P2: live #1042 updated through GitHub connector: status implementation ready, awaiting manual runtime verification; T001–T012 checked, T013 authenticated Stage smoke pending, T014 Production owner GO/schema apply pending, T015 final handoff pending. Previous WS deploy is superseded by this runtime correction; new exact-SHA evidence follows.

Latest runtime-affecting SHA: `03c7ab5b80698b82e8f3a46e9bf442615318c24f`. Exact-SHA [WS Preview Deploy](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37269427509) succeeded, dispatched from main with that full ref. Logs confirm the selected SHA and metadata comparison gates (extracted, installed before/after restart), successful preview env preflight, restart and local/public health gates. Additional public /healthz returns ok. This supersedes the initial deployment. Authenticated Stage smoke is still pending; Production owner GO/schema apply and final handoff remain pending. Follow-up evidence commit changes only SpecKit; no redeploy required for it under agents.md.

## T012A–C manual smoke amendment (2026-10-05 UTC)

Implemented only browser presentation in table-v2.html, poker-v2.js, poker-v2.css and i18n.js: six custom gift buttons, current-seat recipient buttons using existing renderSeatAvatar/getDisplayName, one selected value per picker in the existing Gift Shop DOM, aria-pressed/native keyboard focus, selected/disabled/pending states. Reconcile existing buttons to preserve focus; remove stale seats from a copied children list (avoids skipping adjacent removals). Gift/recipient changes clear giftRetry; uncertain transport retains the request identity until selection changes. Payload still giftKey/targetSeatNo through the existing client/socket. Guest/signed-out control is visible, aria-disabled, visually locked, localized explanation and activation guard; no opening/gift_send. Preview showed signed-out boot splash never cleared; existing markBootReady now runs after signed-out identity resolves so the control/sign-in copy can be seen. No authenticated availability/auth/backend changes.

Self-review: no player cache, new dependency/framework, inline script, logging, ledger/receipt/migration/gameplay/protocol/configuration changes. Existing giftsBySeat, badge rendering/layout, table_gift/table_gift_state, replay suppression and recovery are untouched. No overflow/z-index/offset workaround for persistent gifts. T012D remains BLOCKED on #1048; T013 final authenticated Stage smoke follows T012D; T014 Production owner GO/schema apply and T015 final handoff remain pending.

Required local syntax, check:all, ci:guards, CSP inline guard, exhaustive migration guard and diff whitespace pass. Existing selected WS gift regression passes 1/1. No new or full UI/CSS/JSP suites.

Browser Deploy Preview build-info confirmed `2bfd8ae9d44a9d99bd3ddade0549744998861d14`. Chromium desktop 1440×1000 and mobile 390×844: real signed-out page shows locked control, click/Enter/Space never open; real guest sessions received authOk/commandResult/table_state/stateSnapshot and joined their tables, showed locked control and sent zero gift_send. Six-item picker and self/human/bot list checked on Deploy Preview with a temporary in-memory presentation probe (controlled signed-in state and mocked sendGift, no actual authentication/purchase): exclusive selection, Enter/Space, retained focus after sync, pending disabled choices/send, retry reset, adjacent stale-seat removal, PL/EN labels, panel within viewport. Screenshots inspected: /tmp/1047-{desktop,mobile}-{guest,real-guest,picker,picker-pl}.png. Probe/results live outside the repository; no UI test suite added. Actual authenticated CH/BURN/cooldown/insufficient-funds purchase smoke is NOT proven here (Stage credentials unavailable); remains pending.

Diff against deployed WS SHA `03c7ab5b80698b82e8f3a46e9bf442615318c24f` has no ws-server/**, shared WS dependencies, protocol or runtime/deployment configuration changes. Existing exact-SHA WS deployment remains the relevant WS evidence; no redundant WS Preview dispatch. Browser-only amendment consumes the new Netlify Deploy Preview. PR stays draft/not merge-ready; no Production mutation or merge.

## T012B occupant identity P1 (2026-10-05 UTC)

Only runtime file poker/poker-v2.js::syncGiftShop changed. Buttons store data-seat-no and data-user-id; reconciliation matches both. Replaced/removed target clears selection and giftRetry and removes the old button; new occupant gets a new button/avatar. Unchanged occupant button is retained (focus stable), but avatar is a fresh span on each render to honor unchanged renderSeatAvatar assumptions and profile updates. Retry clearing is target-scoped: unrelated seat replacement cannot discard an uncertain requestId and risk a second charge. No new recipient model, WS payload, backend/auth/catalog/ledger/receipt/protocol/configuration/badge layout change.

Controlled Chromium Deploy Preview check on `b3c141fbfa63da3a76f60f66e865007c90a75958` (build-info confirmed): old preview failed with selection still S2; corrected preview passes Alice on S2 → select Alice → uncertain mocked sendGift → Bob replaces S2 directly → selection empty, retry null, Bob data-user-id, old button detached, new button/avatar, no old image class/data, expected default avatar variant, no old image, aria-pressed false/send disabled. Explicitly selecting Bob re-enables send; normal sync retains Bob button. Replacement on unrelated S3 preserves Alice's retry request identity/selection. This is a temporary in-memory presentation probe with mocked transport, not actual authenticated purchase evidence or a repository UI/CSS/JSP test. Probe/result/screenshot: /tmp/1047-occupant-preview.mjs, /tmp/1047-occupant-green.json, /tmp/1047-occupant-preview.png.

Author self-review: minimal bounded reconciliation, no global avatar helper changes, no unrelated cleanup/dependencies/inline scripts/logging. Required syntax, check:all, ci:guards, CSP guard, migration guard and whitespace pass. No WS Preview Deploy: diff against deployed WS SHA has no ws-server/**, shared WS dependencies, protocol/runtime config change. T012D blocked on #1048; final authenticated Stage smoke T013, Production owner GO/schema T014 and final handoff T015 pending. Draft/not merge-ready; no merge or Production mutation.

## T012E E1 no-self amendment (2026-10-05 UTC)

Verified live #1042/#1048 and main SHA 4f798bdd56dba0e11b34e8982895650920ec6944. main/#1047 have no stable per-seat quick-action slot or gift HUD; #1048 is open, no HUD implementation PR found. E2 and T012D remain BLOCKED on #1048. No temporary overlay, dormant Quick Gift UI or speculative helper refactor.

Only new-purchase domain behavior changes: after resolving ACTIVE sender/recipient, matching user_id fails with existing gift_target_unavailable before postTransaction. Browser giftEligibleSeats filters current-user seats through existing isCurrentUserSeat, while retaining other humans/bots and occupant reconciliation. Receipt-first lookup, advisory locking/cooldown, canonical ledger/receipt transaction and request IDs are unchanged. Historically paid receipts remain idempotently accepted on exact replay (no new BURN/receipt/table_gift); no receipt cleanup/reversal.

Fundamental self test failed before fix by reaching postTransaction; now focused PGlite purchase/migration + handler suites pass 12/12. Self test proves ACTIVE buyer seat rejected, zero postTransaction calls/BURN/receipt and unchanged balance. Success cases for other human/bot continue to exercise BURN shape, replay, cooldown and rollback. Existing real-server WS replay test now targets another human on S2 (1/1); canonical Node ledger suite passes. Syntax, check:all, ci:guards, CSP, migration guard and whitespace pass. No UI/CSS/JSP test, dependency, logger, inline script, migration, gameplay or HUD changes.

Author diff review: two narrow runtime conditions only (domain self guard, browser own-seat filter), small public error contract unchanged; no accounting framework or second flow. Shared domain is a WS runtime dependency, so previous WS deployment is superseded and new exact-SHA deploy/metadata/health evidence must follow. T012E partial: E1 complete, E2 blocked; T013 final authenticated smoke follows T012D + T012E, T014 Production owner GO/schema and T015 final handoff pending. Remains draft/not merge-ready; no merge/Production mutation.

Latest WS/runtime evidence for E1: `f69ab9eabea21d8ec941abefc8f37ea7b5505738`; [exact-SHA WS Preview Deploy](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37295246079) success, workflow main/full SHA ref. Logs show RELEASE_SHA == DEPLOY_REF == that SHA in package and remote step, extracted and installed-before/after-restart metadata equality checks, preview env preflight/restart and local/public health gates pass; additional public /healthz returns ok. This supersedes prior WS runtime evidence. Browser build-info matches the SHA; existing temporary controlled preview probe confirmed own S1 excluded, other human Alice S2 and bot S3 retained, target replacement clears selection/retry/fresh button-avatar and unrelated seat replacement preserves retry. No actual authenticated purchase smoke asserted. Later evidence commit changes only SpecKit. T012E E1 complete, E2/T012D blocked on #1048; T013/T014/T015 remain pending.


## 2026-10-08 — Current-main integration / Draft #1047

Baseline: PR head `1adfcaa36b40e253989c657e864dc89d107cb5d6`; fetched main `d49c33fa19ea52e5715c046bc082af65d15889c5`. Trial non-committing integration found exactly two content-conflict hunks:

1. `poker/poker-v2.js`, original merged lines 4682–4687: Gift Shop reset of `renderedGiftBadges` competed with main cleanup of seat name/transient layers. Retain both main layer cleanups; remove obsolete badge-node cache and render into main's three `hud.gifts` slots. No whole-file side selection.
2. `poker/poker-v2.css`, original merged lines 336–627: both branches appended styles after celebration reduced-motion rules. Preserve all main one-viewport/scene/HUD/card-animation CSS in original order; retain scoped shop/flight/notice rules, remove obsolete clipped avatar badge selector, add narrow HUD-slot/Quick Gift presentation. A subsequence comparison confirmed every main CSS line is retained in order.

HTML, WS server and log policy auto-merged without text conflicts. Reviewed diff against main: HTML adds only Gift Shop/notice; no main layers removed. WS gift additions retain main payload/backlog security, watchdog/session cleanup, reconnect/janitor/lifecycle and state-only replay guard. Client/i18n/adapter/protocol and canonical purchase remain unchanged in semantics. Applied Stage SQL is byte-identical to prior PR head; inventory validates 108 migrations and 7 Production replacements, exhaustive 54 baseline/54 missing with category counts 18/3/33. Removed unrelated Unicode escaping churn in manifest; no SQL/schema edit or Production action.

Integration: `renderGiftBadges()` uses existing three stable slots outside avatars, aggregates duplicates/overflow and includes gifts received on own seat. Self-exclusion remains only on target picker/backend purchase. `syncQuickGifts()` consumes main quick-action anchor without removing existing targeted-reaction nodes. One `sendSelectedGift()` retains canonical catalog/WS send/request identity/error handling/CH refresh. Quick picker opens toward interior/above lower seats; failures use existing visible notice. Recipient replacement clears its selection/picker/retry. Guest/auth gates unchanged.

Fresh verification: `npm test` exit 0 (144 runner groups, external DB-gated cases skipped where credentials absent); gift purchase/handler/receipt suite 12/12. Final WS server + existing browser/client suite 310/310. Additional leave-race/reconnect/disconnect-cleanup/janitor suites passed (50 tests). Required syntax, check:all, ci:guards, CSP inline guard (52 documents), migration guard and whitespace checks passed. Existing ledger suites cover exact USER→GENESIS BURN/no recipient credit and escrow conservation. No new test framework or broad UI/CSS/JSP tests.

Verification caveats: first WS invocation without INFO timed out because main defaults to ERROR but tests detect INFO startup message; reran with WS_POKER_LOG_LEVEL=INFO as CI. Combined first INFO run had one lifecycle `seat_user_closed` assertion failure; isolated regression passed 1/1 and complete final server/browser/client rerun passed 310/310. No lifecycle/runtime code altered to silence it.

Temporary local Chromium controlled-presentation probe at 1440×1000, 390×844 and 844×390 passed: no page scroll, picker in viewport, six choices, one shared requestId after uncertain Quick Gift retry, replacement closes picker/clears retry and badges, own received badges recover and survive render, zero page errors. Screenshots/probe in /tmp/1047-integrated-*.png and /tmp/1047-integration-probe-final.log. Mocked send only: this is NOT authenticated Stage purchase/CH smoke. Independent reviewer found hidden error feedback/picker clipping; both corrected; re-review found no critical/important issues. Author reviewed final main diff for minimal scope and retained lifecycle/layout.

Breaking impact: no new gift protocol/accounting/schema change in reconciliation; existing V1 command/frames remain additive. Deployment still requires compatible receipt schema. Quick Gift is a new entry point required by existing T012E; no gameplay/escrow/recipient-credit changes. Newer main transport security is retained as main behavior.

Live #1048 is CLOSED (2026-10-07) and #1049 MERGED: historical dependency blocker is resolved, HUD acceptance is not re-inferred from conflict resolution. Integrated Gift Shop authenticated Stage/visual smoke remains pending. Production owner GO and compatible empty Production receipt schema remain pending. No merge; Draft/not merge-ready.

Verified exact runtime SHA: `8898a8673e1774a1667de27142bf5cbebaf9a950`. [WS Preview Deploy](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37845007258) SUCCESS, workflow selected from main, application selected by full SHA. RELEASE_SHA == DEPLOY_REF; extracted/installed-before-restart/installed-after-restart metadata equality gates and local/public health passed. Additional public /healthz returned `ok`. Browser `/js/build-info.js` confirms same SHA. Remote Deploy Preview controlled probe repeated successfully at all three viewports; still mocked transport, not authenticated Stage financial smoke.

Runtime-SHA CI all completed successfully: [Tests (core, WS persistence, chips retention and Playwright)](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37845013644), [WS PR Checks](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37845013803), [CI](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37845013659), [DB migration guard](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37845013735), [WS Server Deploy validation only](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37845013636), Infra VPS, catalog and CodeQL. [Stage apply](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37845013655) success: `108 applied, 0 pending`, no new schema application. No active/failed PR check remained when recorded. Main re-fetched and unchanged at d49c33fa.

This evidence-only follow-up changes only SpecKit documentation. Diff against deployed runtime SHA must remain limited to `specs/1042-poker-gift-shop-v1/{review,tasks}.md`; no runtime/deployable/configuration change, so no new WS Preview deployment required. CI status for the documentation head is linked from PR #1047. Previous pre-integration WS preview evidence is historical. Implementation ready, awaiting manual runtime verification; authenticated Stage smoke and Production schema GO remain pending.


## P1 — Retry identity finding corrected (2026-10-08)

Prior head: `1e0440cd3fbba7a0c655ad505ef9595c2a1db1b8`. The old retry stored only key/seatNo/requestId, allowing seat reuse to be mistaken for the same recipient outside DOM-based cleanup. `sendSelectedGift()` now stores recipient userId and requires seatNo/userId/key match to reuse requestId; changed occupant aborts the attempt before WS send. `syncGiftOwners()` clears stale retry independently of Quick Gift/recipient DOM and clears its selection. `syncGiftShop()` reconciles owners and eligible identity pair. Unchanged recipient/uncertain transport and unrelated occupants retain requestId. Independent read-only review: no critical/important findings.

Temporary controlled Chromium probe failed before the fix (retry.userId undefined), then passed after it: same Alice S2 retry uses identical requestId; changing S3 leaves retry intact; Alice→Bob S2 before picker synchronization aborts with zero extra send, clears retry/selection/picker; recipient departure clears retry/selection. Existing browser/client suite 170/170, gift purchase/handler/receipt 12/12 and canonical human ledger suite pass. Syntax/check:all/ci:guards/CSP and whitespace pass. No new repository UI tests; temporary probe is not authenticated Stage financial evidence.

Changed runtime file is only `poker/poker-v2.js`; additional files are existing SpecKit spec/plan/tasks/review. No WS protocol/shared-domain/accounting/schema/migration/config change, no new breaking change. No WS Preview dispatch required for this browser-local identity correction; deployed WS revision/evidence remains unchanged. Stage authenticated acceptance and Production schema owner GO still pending. PR stays Draft, no merge/Production action. Current-head CI and browser SHA evidence are linked in PR #1047.


## Persistent Gift HUD manual FAIL — confirmed root cause and correction

Read-only Stage evidence through Supabase on 2026-10-08: current receipt recipient_joined_at `2026-10-08 22:12:34.124+00` versus same-owner seat joined_at `2026-10-08 22:12:34.124309+00` (same_participation=false). Multiple S2/S3 purchases show the mismatch. Seats later became INACTIVE, so no authenticated current-participation smoke is inferred. Preview journald/release metadata checked; deployed prior WS revision was 8898a867. Installed postgres-js timestamp serializer is `(x instanceof Date ? x : new Date(x)).toISOString()`: SQL formatting alone did not prevent inferred timestamptz binding from truncating receipt parameters. Exact recovery join therefore omitted receipts; subsequent table_gift_state erased event-added HUD icons. No live DB writes made during diagnosis.

Fix receipt insertion by binding sender/recipient participation as text and casting inside SQL; canonical purchase/ledger/idempotency/cooldown logic unchanged. Recovery still uses exact recipient user/seat/joined_at. One statement adds at most three newest receipt events (created_at DESC/id DESC), duplicates included, and recipient userId; retains existing aggregate gifts for older clients. Browser slots use recent event order, persist through render/hand transitions, seed bounded dedupe on recovery and reject stale owner summaries. Fly animation remains independent.

Strict temporary Chromium/Firefox centre hit-test also confirmed Quick Gift overlay on third received slot. Offset only Quick Gift button by seat direction ±20px using existing quick anchor; leave slot anchors, avatar and table geometry untouched. No broad layout refactor or new UI test suite. Probe with current JS/CSS passes one gift, four distinct gifts→latest three, next hand, full page reload plus authoritative recovery, owner replacement plus stale-summary rejection, all slot centres unobstructed; screenshots /tmp/1047-hud-{chromium,firefox}.png. Controlled transport/state only, NOT authenticated Stage financial evidence.

Fundamental new regressions cover newest-three receipt order including duplicates/current owner and actual postgres Date serializer at modeled inferred parameter boundary. Timestamp test fails without casts and passes with casts (both participation identities); PGlite DB verifies exact identity/recovered event. This is a modeled driver binding test, not a claim of a real networked postgres-js roundtrip. Stage evidence independently demonstrates the actual production-library truncation path. Gift domain/handler suite 14/14; focused real-server WS replay/resync/rejoin test 1/1 verifies additive fields; full server/reconnect 160/160; existing browser/client 170/170; canonical ledger, syntax/check:all/ci:guards/CSP (52 documents)/migration inventory (108/7)/diff whitespace pass. Full npm runner and current-head CI status will be recorded in PR after completion.

Independent review found no critical/important issues, including precise participation, one-statement recovery, backward aggregate compatibility and narrow button offset. No migration/DB/config/dependency change. Additive table_gift_state fields, no command/frame-version/BURN/replay/cooldown/security changes. Visual behavior intentionally changes from aggregated catalog-order types to three newest purchases, duplicates occupy slots. Historical malformed receipts remain excluded: no approximate participation match or automatic receipt repair.

Exact-SHA WS Preview deployment is required for this shared runtime/protocol extension; deployment evidence will be linked in existing PR #1047. Authenticated Stage credentials are unavailable in this session; Supabase read-only project access is not a browser login. Previous Android authenticated persistent HUD smoke remains FAIL/unverified until confirmed on corrected preview. No Production changes/deployment/merge; leave Draft/not merge-ready and Production schema GO pending.


Corrected WS runtime deployed: `2c9976d4a01bd143898422208644840e7ec1efad`; [WS Preview Deploy 37853558761](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37853558761) SUCCESS, workflow definition main/application full SHA. RELEASE_SHA == DEPLOY_REF confirmed directly from installed /opt/arcade-ws-preview/ws-server/release-metadata.json; extracted/installed-before/after-restart equality and local/public health workflow gates passed, additional public /healthz=ok. Netlify build-info confirms same SHA. Full npm test final rerun exit 0 (144 groups; first parallel run terminated with 143 after group output and was not used as success evidence). Final checks/probes described above pass. Current CI result/remote browser probe linked in PR. This follow-up changes only SpecKit review/tasks, no deployable/configuration/runtime artifact, so no additional WS deployment needed. No authenticated Stage purchase performed; previous manual HUD FAIL still requires corrected-runtime owner smoke.


## 2026-10-09 accepted correction — avatar action / tabletop receipts

Supersedes historical three-types/duplicate-counter/overflow presentation and the 2026-10-08 avatar-ring placement. Show three latest purchases newest-first, duplicate purchases as separate emoji objects; older purchases remain receipts. Legacy aggregate `gifts` stays compatible. Quick Gift belongs to the avatar edge, statically derived from avatar geometry/physical slot, outside its clipped element. Received gifts belong to a separate fixed tabletop anchor near stack/bet, for every slot including hero. Reuse existing quickAction/gifts/three slots and scene scaling; no runtime collision engine, observers, new dependencies or purchase/protocol/schema changes. Verify actual browser rectangles/screenshots across portrait/landscape, all seats/dealers and gameplay states.

Timestamp precision: modeled postgres-js/PGlite regression remains useful but is not real driver→PostgreSQL evidence. Read-only Stage receipt/seat equality and exact active summary recovery after a new-runtime purchase are required; if absent mark PENDING, never approximate historical identity or repair old receipts. Authenticated financial smoke and Production owner GO remain merge gates.

Constitution check: presentation verified using temporary controlled preview probes, no committed UI/CSS suite or tooling/dependency/ignore changes. Stage checks SELECT-only. Existing tracked branch isolated from main; pre-existing untracked files preserved.

### Real Stage precision finding — 2026-10-09

SELECT-only Stage inspection found four purchases at 08:32:59–08:33:19 UTC after corrected runtime deployment. All four receipt recipient timestamps equal same-owner seat participation exactly: `2026-10-09 08:32:48.444881+00`. Installed WS release metadata remains `2c9976d4a01bd143898422208644840e7ec1efad`. This is real PostgreSQL receipt evidence, not the modeled PGlite driver boundary. Current matching seat is INACTIVE: the production `loadActiveGiftSummary` predicate must exclude it; exact ACTIVE recovery query returned no rows. **Precision persistence confirmed; current-participation loader/WS recovery remains PENDING** until a manual purchase is checked while seated ACTIVE. No history repair, approximate matching, DB writes or authenticated financial smoke performed.

Small read-only check after manual Stage purchase (use only Stage):

```sql
SELECT g.id, g.created_at, s.status,
       to_char(g.recipient_joined_at,'YYYY-MM-DD HH24:MI:SS.USOF') AS receipt_time,
       to_char(s.joined_at,'YYYY-MM-DD HH24:MI:SS.USOF') AS seat_time,
       g.recipient_joined_at = s.joined_at AS exact_match
FROM public.poker_gift_purchases g
LEFT JOIN public.poker_seats s ON s.table_id=g.table_id
 AND s.seat_no=g.recipient_seat_no AND s.user_id=g.recipient_user_id
WHERE g.created_at > now() - interval '15 minutes'
ORDER BY g.created_at DESC LIMIT 12;

WITH matched AS (
 SELECT s.table_id,s.seat_no,s.user_id,g.id,g.gift_key,
 row_number() OVER (PARTITION BY s.table_id,s.seat_no
                    ORDER BY g.created_at DESC,g.id DESC) AS position
 FROM public.poker_seats s JOIN public.poker_gift_purchases g
 ON g.table_id=s.table_id AND g.recipient_user_id=s.user_id
 AND g.recipient_seat_no=s.seat_no AND g.recipient_joined_at=s.joined_at
 WHERE s.status='ACTIVE'
)
SELECT table_id,seat_no,user_id,
 jsonb_agg(jsonb_build_object('eventId',id,'giftKey',gift_key) ORDER BY position)
 FILTER (WHERE position<=3) AS recent_gifts
FROM matched GROUP BY table_id,seat_no,user_id;
```

Compare the latest purchase ID with the actual table_gift_state recentGifts payload/visible slot during authenticated reconnect/refresh. SELECT result alone proves the loader predicates, not authenticated WS delivery.

### Geometry verification / initial correction review

Baseline PR head e34a63c9; fetched main d49c33fa already integrated. #1048 closed/#1049 merged (6c8ab3fa), use existing scene/HUD. First temporary rectangle probe rejected overlaps with pot/avatar/cards; normalized hero cards exposed best-hand overlap, corrected hero landscape anchor above stack. Independent review caught shared 👍/🎁 hit-box collision; preserve previous reaction quickAction anchor and position only Gift via placeSeatNode. Final temporary Chromium/Firefox local JS/CSS interception on Preview: 390×844,844×390,1440×1000;2–6 seats/every dealer;120 combinations, zero gift/obstacle rectangle overlaps. Obstacles include actual chip images/labels, names/avatar/seat numbers, dealer, private/public/best-hand cards, pot and room text. 1/2/3 hero gifts and repeated beer/beer/pizza, hand rollover/chip changes, avatar update, seat replacement, picker open/Escape/focus/product mock send, fixed button rectangles and coexistence hit-tests pass. Screenshots inspected at /tmp/1047-layout-{chromium,firefox}-{390,844,1440}.png. These controlled state probes do not prove authenticated transactions or actual Android hardware. Actual deployed frontend check follows push.

Existing gift domain/handler14/14, browser/client170/170, focused real server gift1/1, canonical ledger exit0. Syntax/check:all/ci:guards/CSP52/migration inventory108/7 pass. No new UI suites, dependency/config/schema/inline script or CSP changes. Source diff confined to frontend geometry/CSS and SpecKit. Authenticated corrected-layout Stage acceptance remains PENDING; previous manual persistent-HUD FAIL is not cleared by controlled probes. Production schema GO pending; Draft/no merge/Production deploy.

### Deployed frontend final evidence

Netlify BUILD_INFO confirmed `c974e920877554228e779d25ab6a32bed0920a58`; temporary probe fetched actual deployed JS and CSS (only a controlled fixture injected, API/state mocked). Chromium and Firefox at390×844,844×390,1440×1000:120 seat-count/dealer/viewport/browser combinations, each playing and end-showdown state,240 rectangle evaluations, zero overlaps. Both controls’ centres hit their own 🎁/👍 buttons.1/2/3 hero receipts,duplicates,newest ordering,hand/chip changes,fixed button bounds,avatar replacement,seat replacement,touch picker open/selection,Escape/focus and full refresh+controlled authoritative recovery pass. Screenshots inspected: /tmp/1047-layout-{chromium,firefox}-{390,844,1440}.png;1/2/3-gift captures use suffix -gifts{1,2,3}.png. This covers desktop browser engines and mobile-sized touch contexts, not physical Android or authenticated financial acceptance. No broad UI tests committed.

Final c974e920 CI: no pending or failed checks. Independent re-review: shared reaction anchor correction resolved; no further actionable defects. Existing required local fundamentals/checks remain PASS. Docs-only evidence follow-up does not alter deployed frontend/WS. No WS/shared/protocol/config changes in correction; installed WS2c9976d4 retained, no redundant WS deployment. Authentication/ACTIVE recovery/Production GO gates unchanged.


## Quick Gift P2 — touch target verification

Original target24×24 scene px. Real Chromium/Firefox before/after rectangles:

| Viewport | Scene target after | CSS target before | CSS target after |
|---|---|---|---|
|390×844 portrait|≈28.88×28.88|24.93×24.93|30×30|
|844×390 landscape sides|≈37.68×37.68|19.10–19.11 square|29.99–30 square|
|844×390 landscape top|≈37.68×32|19.10–19.11 square|29.99–30×25.48|
|1440×1000 desktop|24×24|32.86–32.87 square|unchanged|

Northern landscape height is limited to the existing scene/viewport top reserve, not another control moved/hidden. Emoji remains18 scene px; Range glyph bounds before/after differ≤0.017 CSS px (layout rounding), all anchor coordinates unchanged.49/49 sampled points per30px target,42/42 northern target and64/64 desktop points hit their own button, including expanded padding; 👍 rectangles have zero overlap. Added-area0.5-CSS-px sampling found zero new points inside circular avatars (original edge footprint unchanged). Sampling caught an initial custom-property inheritance scope error expanding right-seat hitboxes inward; corrected parent pad-left to resolve from inherited screen size directly, reran all measurements.

Temporary Chromium/Firefox local-code-on-Preview matrix:120 combinations of390×844/844×390/1440×1000,2–6 players,every dealer,each playing/showdown (240 evaluations). Zero received-gift collisions and zero Quick Gift overlaps with other visible button/link/input/role-button rectangles; thumbs-up coexistence,stable geometry across hands/avatar updates,resize/orientation,full controlled refresh/recovery,touch picker/product selection,Escape/focus pass. /tmp/1047-hit-before.json,/tmp/1047-hit-after.json,/tmp/1047-touch-matrix.log; screenshots /tmp/1047-touch-{chromium,firefox}-{390,844,1440}.png. No UI/CSS test framework or tests added to repository. Controlled probe is not physical Android or authenticated financial smoke.

Existing browser/client170/170; syntax221 files,check:all,ci:guards,CSP52 and diff whitespace pass. Independent review: no actionable findings; corrected CSS scope reported separately. Changes only frontend JS/CSS and existing SpecKit, no WS/shared/protocol/config/DB/inline scripts. No redundant WS deploy. Authenticated Stage smoke,ACTIVE recovery and Production schema GO remain pending; Draft. Actual deployed frontend measurement follows push.

Deployed frontend `71edd1654eeb1a410ff938502099763345df35ed` verified through BUILD_INFO and actual fetched JS/CSS: both engines reproduce the before/after table, all grid-hit samples ownbutton. Screenshots inspected /tmp/1047-touch-deployed-{chromium,firefox}-{390,844,1440}.png. Evidence-only follow-up changes tasks/review only; WS runtime unchanged, no redeploy. Current CI status recorded in PR; authenticated acceptance gates unchanged.


## 2026-10-09 manual FAIL — portrait S6 proximity / hero visual demo

Manual smoke FAIL: S6 gifts too far from avatar in portrait; hero gifts lack convenient on-device inspection. Seat numbers rotate relative to hero: resolve physical slot using rotateSeatIndex→seatPhysicalSlot, not S6 hardcoding. For six seats/heroS1,S6 is physical lower-right(slot2); manual hero/seat-count clarification requested. Change only the relevant portrait gifts anchor after mapping confirmation; preserve all Quick Gift anchors/hitboxes and landscape.

Extend existing gated bindCelebrationPreview with one unchecked,non-persisted checkbox “Show demo gifts on hero — DEMO / Visual only”. One local identity-bound state; renderGiftBadges selects beer/pizza/whisky only for actually occupied hero. Reuse three hud.gifts slots/geometric placement; mark visible hero name DEMO while active. Never mutate giftsBySeat/giftOwners/giftEventIds, create event IDs/receipts or call purchase/WS/backend. Turning off shows current real data. Clear on leave/table/user/seat changes and reconnect/recovery (participation boundary not exposed publicly); ordinary seat/hand renders retain demo. No changes to other players.

Constitution: existing fundamental checks and temporary browser probes only,no committed UI/CSS suite,backend/protocol/schema/dependency/inline-script changes or WS deployment. Draft/manual FAIL remains until authenticated acceptance; ACTIVE recovery and Production GO pending.

### Hero demo implementation / partial verification — 2026-10-09

Existing Preview FX now includes Show demo gifts on hero — DEMO / Visual only. One local identity-bound state selects beer/pizza/whisky through normal three slots; actual gift stores/event IDs remain unchanged. DEMO prefix is visible on hero name even after closing settings. Strict deploy-preview/isPreview gate, actual occupied hero required, default off/no persistence. Off restores real newest-first gifts, including duplicates; seat removal, identity/table changes, reconnect/resync and leave clear demonstration. No backend/economy/protocol calls or changes.

Temporary Chromium/Firefox probes against Deploy Preview with local candidate JS/CSS intercepted pass all three viewports (390×844,844×390,1440×1000): on/off, repeated renders, immutable real stores/event IDs, restore ☕ 🍺 🍺, recovery and hero removal cleanup. Netlify Drawer removed only inside probe because it intercepted diagnostics clicks. Screenshots /tmp/1047-hero-demo-{chromium,firefox}-{390,844,1440}.png. This is controlled visual evidence, not deployed-HEAD or authenticated financial smoke.

Portrait lower-right candidate [290,440] instead of [174,375] tested without source geometry mutation: avatar distance 150.7→86.9 scene units. Expanded geometry matrix (six physical slots,2–6 occupied seats,all dealer positions,playing/showdown,three viewports,both engines) reports zero gift/control/obstacle collision cases. Actual S6 mapping remains PENDING user hero seat/maxSeats from manual smoke; six-seat hero S1 maps S6 to physical slot2, but this cannot establish that manual scenario. No portrait anchor changed until mapping is known.

Existing browser/client 170/170 and Gift Shop domain/handler 14/14 PASS; syntax,check:all,ci:guards,CSP52 documents,diff whitespace PASS. Independent demo code review: no actionable defects. No Quick Gift/reaction geometry or hitbox modifications. No new inline script/dependency/runtime WS/migration; no WS deploy needed. Manual portrait FAIL remains open. Merge gates remain authenticated Stage smoke,ACTIVE recovery,Production schema GO.

## 2026-10-09 follow-up smoke — hero gifts / dealer / purchase diagnostics

Manual portrait/landscape layout remains FAIL. Correct portrait hero anchor slightly left/down, landscape hero above left best-hand cards and left of stack; shift landscape woman dealer left, retaining DOM-derived card-flight source. Helena mapping is pending screenshots absent from request; do not guess her seat/physical slot. Preserve Quick Gift/reaction hitboxes, demo lifecycle, receipt ordering/economy/protocol.

Purchase investigation: deriveCurrentSeat can fabricate ACTIVE from stale youSeat; Gift Shop must require an actual occupied current-user seat, rejecting LEFT/INACTIVE/EMPTY. Reconnect/WS guards are expected safety gates; log attempted blocked sends and rejected purchases with table/target/code/readiness/reconnect/seat status via klog. Keep retry/requestId rules unchanged; reuse existing reconnect translation for ws_closed/ws_unavailable. No runtime WS change/deploy. Stage journal access attempt denied, so ee710913 incident cause not established.

Constitution: existing fundamental tests/repo checks and temporary browser probes only. No new UI/CSS tests, dependencies, inline scripts, schema/backend/protocol changes. Required screenshots and authenticated acceptance remain pending, as do ACTIVE recovery/Production GO.

### Follow-up implementation / controlled evidence

Hero portrait physical slot3 gifts [230,475]→[198,520] (−32,+45 scene units); the smaller [215,485] collided with hero D and [209,518] was partly covered by action-bar background, both rejected. Final bound uses entire action-bar panel as obstacle, not only buttons. Landscape slot3 [342,199]→[276,278] (−66,+79), above left best-hand cards/left of stack. Landscape woman dealer CSS left675→640 (−35), y−60/size155×185 unchanged; portrait dealer unchanged. Card animation source already reads rendered dealer bounds at (width*.5,height*.84), so no animation code change; landscape source now [717.5,95.4], old [752.5,95.4].

Temporary Chromium/Firefox local-candidate-on-Preview matrix: 2–6 occupied seats,every dealer position,playing/showdown,390×844/844×390/1440×1000,one/two/three and duplicate gifts: zero collision cases with avatar/name/chips/labels/D/cards/best-hand/pot/room-status/action-bar/buttons. Quick Gift/reaction centers clickable and stable during renders/hand/avatar changes. Screenshots /tmp/1047-layout-correction-{chromium,firefox}-{390,844,1440}.png inspected. Separate demo probe checks on/off/real duplicate restoration/no store mutation/recovery/unseat and twelve actual spawned card nodes sharing DOM-derived source; stale absent hero, same-seat replacement,inactive hero,reconnect,WS-not-ready correctly blocked. Final deployed-head repetition still pending at push.

Gate uses strict currentUserId, never stale youSeat fallback. Diagnostics log blocked reason and rejected code/table/target/readiness/reconnect/actual seat status; ws_closed/ws_unavailable reuse existing reconnect copy. Retry/requestId/cooldown/CH unchanged. Incident ee710913 unproven: transient transport/resync/seat projection race plausible; gift_shop_unavailable specifically comes from adapter/schema/DB table-not-OPEN, not directly frontend reconnect guard. Exact rejection code/runtime log needed; Preview SSH access denied. No backend repair or speculative economic changes.

Existing client/browser170/170 + gift domain/handler14/14 PASS (combined184); syntax/check:all/ci:guards/CSP PASS. Independent review stale-seat finding fixed with strict identity, subsequent review no actionable issue. No inline script/dependency/WS/protocol/schema changes or WS deploy. Helena anchor remains unchanged pending missing smoke screenshots; manual FAIL and authenticated Stage/ACTIVE recovery/Production GO remain open.

## 2026-10-09 confirmed smoke mapping — Helena portrait

User confirms maxSeats6,heroS4,HelenaS3,S6empty. Zero-based Helena index2/hero index3 gives rotateSeatIndex=(2−3+3+6)%6=2; seatPhysicalSlot(2,6)=2 (lower-right). Supersedes earlier unconfirmed S6 interpretation/missing mapping. Change ONLY portrait.seats[2].gifts [174,375]→[290,440], fixed three-item offsets unchanged. Preserve all accepted hero/dealer/drawing-source/readiness/demo changes and Quick Gift/reaction anchors/hitboxes. Verify actual published Preview in Chromium/Firefox portrait390×844 with Helena three gifts,heroS4,S6empty,active action bar,all dealer positions/playing/showdown; landscape844×390 regression. Existing fundamental tests/checks only,no UI/CSS tests/dependencies/inline scripts/protocol/economic changes. ee710913 incident cause remains unconfirmed; next rejection code/klog required. No WS redeploy/Production/merge; Draft and authenticated Stage/ACTIVE recovery/Production GO gates unchanged.

### Helena final published verification — 2026-10-09

Frontend commit ee39a2866a22563c2c45a1815c8003e86b8bfbcf changes exactly one code line: portrait.seats[2].gifts=[290,440]; centers [290,440],[302,445],[314,450]. All other anchors/CSS/control hitboxes/rotation/economy/protocol unchanged. Live Preview JS byte-matches that commit.

Chromium+Firefox using fetched published JS/CSS and temporary controlled fixture maxSeats6/heroS4/HelenaS3/S6empty:72 cases across390×844,844×390,1440×1000,every dealerD,playing/showdown;0 gift collisions with names/avatars/private+public cards/chips+labels/D/pot/best-hand/room text/entire action bar/controls. Portrait Helena gifts are8.3px below name and30.1px above active action bar. Three duplicates/newest slots readable, hand renders retain them,🎁/👍 rectangles stable. Actual physical slot assertion lower-right; heroS4 and emptyS6 asserted. Screenshots inspected /tmp/1047-helena-deployed-{chromium,firefox}-{390,844,1440}.png. Landscape geometry untouched and probe PASS.

Existing client/browser170/170;syntax/check:all/ci:guards/CSP52 PASS;no permanent UI/CSS tests. Published controlled visual verification PASS does not establish authenticated Stage financial smoke/ACTIVE recovery. ee710913 exact cause remains unconfirmed;accepted readiness fix unchanged,next rejection code/klog required. PR staysDraft,authenticated Stage smoke/ACTIVE recovery/Production schemaGO pending. No WS redeploy/Production/merge.

## 2026-10-09 remaining smoke FAIL — Quick Gift Picker / landscape upper-right

Quick Gift menu (not main Gift Shop) must use dark16251f/gold725735/radius12,recipient header,six catalog cards2×3,separate emoji/name/CH price,minimum44×44CSSpx unscaled after scene fitting,one-tap shared sendSelectedGift. Preserve trigger hitboxes/reaction and focus/Escape/pending/disabled. Existing picker element may be locally hosted under body/fixed viewport to avoid transformed-scene clipping,with explicit cleanup on seat rerender and local placement bounded above active action bar; no global popover system/framework.

Landscape only slot1 gifts:desired whole group right of stack/name-below/right ofD/outside adjacent lower-right HUD. Measure actual DOM for all three staggered22px slots. If incompatible document exact obstruction,keep other anchors fixed and propose nearest safe variant for user acceptance,do not falsely reportPASS. No portrait/other landscape/dealer/rotation/economic/protocol changes.

Constitution:existing fundamental tests/repo/syntax/CSP and temporary probes only,no permanent UI/CSS tests/dependencies/inline scripts/endpoints/migrations. Smoke staysFAIL until owner acceptance;authenticatedStage/ACTIVErecovery/ProductionGO pending;noWSredeploy/Production/merge.

### Picker implementation / upper-right geometry conflict

Existing picker moved under document.body as fixed unscaled element (no new wrapper/framework),cleaned before seat rebuild. Same giftCatalog/shared sendSelectedGift,header current recipient,separate emoji/name/price spans,2×3 cards,dark16251f/gold725735/radius12/shadow. Local placement uses trigger/viewport/action-bar rects,chooses side above/below/right/left then clamps8px inside viewport and above action bar. Trigger positions/hitboxes unchanged. Native focus/Tab/gold focus/Escape-return/pending-disabled preserved;render cleanup prevents orphan panels. Main Gift Shop CSS/flow unchanged.

Controlled Chromium/Firefox Preview probe with candidate local assets:36 picker positions (six physical anchors×three viewports×two engines),panel280×296CSSpx,cards123×76CSSpx in all viewport scales (390×844,844×390,1440×1000),all six options usable;one-tap mock purchases validate key/target for every catalog entry. Natural six-seat view has five eligible opponent anchors;physical slot3 is always hero and correctly has no Quick Gift,so its popup placement was tested by temporary opponent-anchor remap only (not production self-gifting). Header/pending/disabled,keyboard focus/Escape,trigger hit-center while open,resize/orientation and repeated renders/no orphan panels,main shop six choices PASS. Existing browser/client170/170,syntax/check:all/ci:guards/CSP52/diff PASS;independent review no actionable defects. Published-head probe required after push.

Strict landscape upper-right relations are INFEASIBLE without moving other HUD. Measured scene bounds:upper-name bottom≈141,D right≈916,lower-right avatar left≈922/top≈157/right≈1018. Whole three-gift bounds46×32. To right ofD and below name,the first22px gift already crosses lower-avatar top157;horizontal strip D→avatar only6px. To right of lower avatar leaves22px before scene edge1040,less than group46px,and exits tabletop. Do not claimPASS or move neighboring elements.

Nearest safe candidate[883,173] centers[883,173],[895,178],[907,183];group bounds[872,918]×[162,194]. Right of stack (stack right≈857,gap15),below name(gap21),outside lower avatar(gap4),below/left ofD actual slots gap≈2 and adjacent lower stack gap≈2,lower private cards top≈217 gap23. Entire group is NOT right ofD (bounding group includes empty stair-space byD). Controlled all D positions/1–3 gifts/duplicates/hand+showdown probes found no actual-slot collisions. Candidate only temporary,not applied;user approval requested for explicit right-D exception. Source remains[757,120].

Manual smoke remainsFAIL pending owner acceptance;authenticated Stage/ACTIVE recovery/Production schemaGO pending. ee710913 cause unconfirmed,accepted klog/readiness fix retained. No portrait/other landscape/dealer/rotation/WS/economy/retry/CSP-inline/schema/dependency changes,noWSredeploy/Production/merge.

Published a15308103f200b4b57db9558e131289c53cc9efe JS/CSS probe PASS:all viewports/card sizes/all catalog one-tap mock sends/Polish recipient header/native gold Tab focus/ESC/pending/rerender/resize/main shop;candidate actual-slot collisions0 including all neighbors revealed at showdown. Follow-up narrowly restores focused option across renderSeats/resize only for unchanged recipient identity;pending can focus existing picker (tabIndex−1) for Escape. Local final probe confirms Escape closes after orientation rebuild;170/170 and syntax PASS. Source trigger geometry still unchanged.

CI a153 WS harness failed existing disconnect cleanup timing test (seat_user_closed vs expectednull),same case recorded in earlier touch follow-up;unchanged WS source. Isolated existing test PASS1/1. Do not claim current CI green;next frontend commit CI must be observed. ManualFAIL and anchor exception approval remain pending.
