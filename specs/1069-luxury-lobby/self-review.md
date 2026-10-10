# Self-review — design and SpecKit

2026-10-10. Current main baseline `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4`. Status: visual design review; final implementation blocked by owner approval.

## Findings and decisions
1. Latest #1069 update supersedes dashboard-first structure. Both review layouts use the same five original cinematic cards and native carousel/peek. Four future modes explicitly Coming Soon; no unsupported play links.
2. The described screenshot is absent from live issue comments/attachments and user prompt. Design follows its written composition; no claimed pixel match or borrowed game art.
3. Real code differs from skills.md mapping: no `portal/portal.js`; actual shared topbar/sidebar and `poker.js:initLobby()` identified. Account navigation and welcome bonus use `/account.html`. Plan corrected accordingly.
4. Existing #792 theme chooser is preview-only, nonpersistent. Six-theme gallery here previews art; it does not implement #800 or invent permission/paid ownership. Proposed default Classic-only permission keeps unknown policy fail-closed. Separate #800 PR shares one extracted catalog/apply path.
5. Native short landscape needs reduced copy/width; native portrait needs smaller vertical art height on tall phones. Refined without shrinking primary touch targets. Short phones may scroll vertically instead of hiding controls.
6. Browser screenshot capture initially ran before lazy artwork finished loading. Review capture now waits for all visible/generated assets; runtime lazy loading remains enabled.
7. Carousel end clamping on wide screens could leave the final indicator inaccurate. Corrected updatePosition() to recognize the scroll end as the final entry.
8. Indicator dots initially had 28px hit height. Corrected to 44px to match accessibility requirement.
9. Preview values stay unset (Guest preview, level/XP —, — CH). Authentic live identity/balance is reserved for existing topbar integration after approval; no mocked ranks/currencies.
10. Preview has no inline JS, browser modules, storage, account/WS bootstrapping, ad SDK or application logs. Existing CSP `self` is sufficient; no SHA allowlist changes needed. Future inline changes remain SHA-gated.

11. Exact HTTPS review exposed the Netlify Drawer iframe intercepting bottom-toolbar clicks on short landscape phones. Confirmed its fixed 48px frame in DOM; scoped the review-only stylesheet to hide its injected wrapper on these two pages. No site settings/global page changes.

## SpecKit consistency analysis
Ran existing plan/tasks setup and `check-prerequisites.sh --json --require-spec --require-tasks --include-tasks`. All required artifacts resolved. No extension hooks exist. Review of spec/plan/tasks against constitution found no unresolved CRITICAL/HIGH conflicts.

| Requirement | Covered tasks | Review |
| --- | --- | --- |
| FR-001, FR-002 / two approved compositions | T005–T008, T023 | Native review URLs; owner approval pending |
| FR-003 / original optimized artwork | T004, T007 | Five assets, provenance and prompts documented |
| FR-004, FR-005 / real navigation and player data | T009–T013, T015 | Current action/ID contracts; future implementation explicitly blocked |
| FR-006 / future mode boundaries | T006, T011 | #1077/#1075/#797 separate gameplay scope |
| FR-007 / common Cosmetics design | T016–T021 | Six art previews now, one shared runtime path later |
| FR-008 / Poker-only ads | T014 | Existing lobby unchanged here; future approved removal bounded |
| FR-009 / environment/authority exclusions | T001, T003, T023 | No backend/DB/WS/Production change |
| FR-010 / accessibility/orientations | T005–T007, T012, T015 | Touch/keyboard/dialog/reduced-motion and manual device scenarios |
| FR-011, FR-012 / constitution and concrete review | T003, T022, T023 | CSP/JSP/CSS/klog and fundamental-tests-only |

No requirement is left without tasks. SC-001–SC-005 cover review evidence; SC-006 belongs to blocked future implementation. No proposed gameplay/CSS unit suites. No git commands in plan. Tasks are sequentially numbered, story-labeled, with exact paths and explicit dependency gate. Proposed Cosmetics helper extraction has a stated simplicity rationale, not a new framework.

## Verification evidence
- Baseline CSP: 52 documents passed. Baseline syntax initially lacked installed declared acorn dependency; local `npm ci --ignore-scripts` installed existing lockfile dependencies with no manifest/config change.
- Review checks: `npm run syntax` passed (222 files), `npm run check:csp-inline` passed (55 served documents), `npm run ci:guards` passed lifecycle/badge/29-file XP hook guards.
- Browser and exact Netlify verification results are recorded below after publication. No new test suite is committed; review uses installed Playwright as an ephemeral bounded inspection tool.

## Remaining gates
Owner real-device portrait/landscape/touch/visual acceptance is pending. Final lobby T009–T015 and Cosmetics T017–T021 are not performed. This Draft PR is not merge-ready and does not close #1069/#800. Future permission classification of non-Classic theme selection requires explicit agreement; no entitlement is invented. No WS deploy is required for this isolated art-only prototype. No Stage/Production/backend/database/WS effect.

## Bounded browser evidence
Chromium review at 1280×800 landscape, 844×390 landscape phone, 390×844 portrait, 360×640 and 320×568 portrait: five decoded mode artworks, partial next-card peek, zero page-wide horizontal overflow, six decoded theme art samples, Coming Soon dialog Escape and focus return, Cosmetics focus return, zero JS errors and zero account/API/WS requests. Snapshots are in `poker/designs/luxury-lobby/screenshots/`. These are browser viewport simulations, not physical-phone acceptance. Wide final-card indicator and 44px indicator hit targets rechecked after refinement.

Five artwork bytes: 781368 total; first art 133896 bytes. Within SC-004 budget.

## Published Draft PR and HTTPS evidence
- Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1078 (remains Draft).
- Landscape: https://deploy-preview-1078--playkcswh.netlify.app/poker/designs/luxury-lobby/landscape.html
- Portrait: https://deploy-preview-1078--playkcswh.netlify.app/poker/designs/luxury-lobby/portrait.html
- Verified deployed runtime/design revision: `71d65a3ef3bd34ec8f658637ea8139db9f7149d6`. Netlify Deploy Preview and required actionlint passed for that revision. Later review-evidence-only commits do not change these design assets.
- Real HTTPS Chromium inspection at 844×390 and 390×844: HTTP 200, CSP present, five artwork decodes, indicator/Sit & Go Coming Soon details/Escape/Cosmetics/Neon Vegas art selection all usable; zero application JS errors and zero platform account/API/WS requests. Netlify itself injects its CDP script and makes its own preview-drawer request; two camera/microphone permissions-policy console messages originate from that iframe, not the application. The drawer is hidden only on review pages; site security/deploy settings remain unchanged.
- Final scope diff contains only `poker/designs/luxury-lobby/**` and `specs/1069-luxury-lobby/**`. Original lobby/topbar/backend/DB/WS/configuration/dependencies unchanged; local feature selector remains ignored/uncommitted. GitHub auto-runs broader existing CI; ws-harness/playwright were still running when this evidence was recorded, no failure observed. No manual runtime deployment or production operation performed.

Owner acceptance is the remaining current milestone gate (T008). T007/T022/T023 are complete. T009–T015 and T017–T021 remain unchecked and blocked.
