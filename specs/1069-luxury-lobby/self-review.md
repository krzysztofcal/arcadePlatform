# Self-review — premium mobile arcade review v2

2026-10-10. Existing Draft PR #1078, no new PR. Owner review https://github.com/krzysztofcal/arcadePlatform/pull/1078#issuecomment-6098655623 explicitly left the previous design unapproved. Latest issues #1069/#800/#1079/#1070/#1072 analyzed; main baseline reconfirmed `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4`.

## Findings addressed
1. Visual direction: replaced restrained serif/editorial luxury with saturated blue/purple/magenta bokeh, five new original glossy 3D illustrations, brighter per-mode frames, bold arcade headings and beveled green/gold CTAs. Four future modes remain Coming Soon.
2. Daily Bonus missing: added fifth lower shortcut and separate native landscape/portrait concept panels, four Day 1–4 cards, explicitly labeled sample completed/current/upcoming states, disabled Claim and Not configured availability. No amounts/countdown/reward APIs/CH emission. No jackpot/sale/extra currency.
3. Six existing themes FREE: removed earlier access assumption throughout SpecKit/gallery/PR text. Auto/Random is proposed default with optional manual choice. The preview only demonstrates a labeled fixed Neon Vegas sample and transient selection; no production preference/randomization implementation.
4. Misleading generic thumbnails: every non-Classic preview now references its actual room/dealer/rail/felt/face/back/frame assets. Classic reuses existing scene/native defaults. Atomic preview preload/request-generation protection prevents mixed assets after fast switching. No second renderer/catalog introduced into production.
5. CSS media formatting: opening/closing media braces are separate physical lines, each enclosed selector/declaration rule stays on one complete physical line. No collapsed multi-rule media lines or global CSS changes.
6. Portrait indicators initially overlapped the sticky toolbar. Reduced tall-phone tile height so 390×844 has complete lobby/indicators/toolbar on one screen; short phones may scroll vertically. Gifts initially overflowed reward-card labels due grid intrinsic image sizing; bounded absolute image sizing fixes that. Short landscape Daily panel uses a compact header/art layout to preserve readable states/action.
7. Existing isolated preview-only Netlify drawer suppression retained. It affects only these review routes, not site/deploy settings. Existing CSP `self` covers all scripts/assets, no inline JavaScript/handlers and no SHA changes. IIFE remains JSP-compatible; no application logs needed.
8. Snapshot references remain descriptions: screenshot files are absent from issue/this prompt, so no pixel-match or file-access claim. Original raster generation via built-in image_gen; prompts/provenance in ARTWORK.md.

## Source/authority findings
- Existing `bonus-campaigns` supports atomic/idempotent UTC daily PROMO_BONUS, not an implemented Day 1–4 streak. GET filters eligible/unclaimed items; absent items cannot become completed-day history or a countdown. Admin's 20 CH template is not active-campaign evidence. No live campaign existence queried or claimed. #1079 needs separate economic/history/status design and owner GO.
- #1070/#1072 may cover future distinct paid/VIP assets; none of the six shipped free themes may be paywalled. #800 Auto choice proposal is deterministic per identity/table, stable through hand/snapshot/reload/reconnect; owner still must approve the detailed policy before implementation.
- Actual lobby remains poker/index.html + poker/poker.js:initLobby; real account navigation remains /account.html. All existing runtime/table/tier/guest/auth paths stay untouched.

## SpecKit traceability
| Requirements | Tasks / evidence |
| --- | --- |
| FR-001–003, FR-014 / arcade native preview/art | T024, T025, T029, T031 |
| FR-004–005 / real paths and toolbar | Existing blocked T009–T013/T015; T025/T027 now |
| FR-006 / Coming Soon | T006/T024/T025; four same scopes |
| FR-007, FR-015 / free actual-asset Cosmetics | T026/T030; future blocked T017–T021 |
| FR-008–009 / no live/runtime/economy changes | Scope diff, future blocked T014, T028 |
| FR-010–012 / access/style/security/concrete artifacts | T025/T029/T030/T031, existing guards |
| FR-013 / truthful Day 1–4 concept | T027–T029; separate #1079 |

Spec/plan/tasks/research/data-model/contracts/quickstart and checklist aligned. Previous selection restrictions removed; tests remain fundamental-only with temporary browser inspection rather than a committed UI suite. No git commands in plan; no unresolved placeholder requirement. No before/after hooks (.specify/extensions.yml absent). Existing plan/tasks setup executed for the same feature directory.

## Verification evidence
Local v2 inspection passed at 1280×800, 390×844, 844×390, 568×320, 360×640 and 320×568: five tiles/shortcuts, six decoded actual theme samples, four day examples, no horizontal overflow, touch/keyboard/focus return, disabled claim, no storage writes, platform API calls or JavaScript errors. Both hash-panel deep links and orientation resize passed. Same-document hash changes initially missed the second panel; hashchange handling now fixes this. Screenshots refreshed for all six viewports, including scrolled Daily footer. Syntax (225 files), CSP inline (55 documents), CI guards (29 XP hooks) and diff whitespace checks passed. Earlier v1 evidence is superseded and is not approval of this revision. HTTPS publication verification follows below.

## Remaining gates
Owner actual-phone visual/touch approval for both orientations and Daily Bonus/Cosmetics remains pending. T008 is unchecked. Final lobby T009–T015 and #800 preference tasks T017–T021 remain unchecked; Daily claims/history/economics belong to separate #1079. Draft remains not merge-ready. No Production/backend/DB/WS/economy change or merge.
