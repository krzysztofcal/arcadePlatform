# Tasks: UGC and avatar follow-up after release B (#1140)

**Input**: `spec.md`, `plan.md` in this folder. **Gate**: OWNER approval of D1–D5 before T002.
Format: `[ID] [P?] [Story] Description`. `[P]` = can run in parallel (different files, no dependency).

## Phase 1: Gate
- [x] T001 OWNER approves D1–D5 (spec). Approved 2026-11-26, recorded in `spec.md`.

## Phase 2: US2, distinct block dialog (P1)
- [ ] T002 [P] [US2] `js/ugc-client.js::openDialog` `danger` option (class `ugc-dialog--danger`, Cancel focused); the block call in `renderActions` uses `ugcBlockTitle`/`ugcBlockConfirmButton`; `js/i18n.js` PL/EN keys; `css/ugc.css` one-line danger rule.
- [ ] T003 [US2] `tests/ugc-client.behavior.test.mjs`: Report sends only `POST ugc-report`, and the block needs an explicit confirm (cancel sends nothing).

## Phase 3: US1, leaderboard masking (P1)
- [ ] T004 [P] [US1] `leaderboard.html` loads `js/ugc-client.js` (order as in `profile.html`). `js/leaderboard-page.js` starts `loadBlocks(false)` in parallel with the read and waits for it at most 3 s, guarded by the `load` generation. It masks blocked handles in `avatarNode` and reapplies on `ArcadeUgc.onChange`.

## Phase 4: US4, no expiry after load (P2, foundation for US3)
- [ ] T005 [US4] `js/profile-client.js::applyPhoto/applyAvatar`: per-node request counter, also checked by the shared `fallback` (onerror and timer); clear the expiry timer on load; drop the deadline check on load; `data-avatar-shown-path` set only when a photo is displayed and removed on every reset; skip the reset for the shown path.

## Phase 5: US3, own-photo cache (P1)
- [ ] T006 [US3] `js/user-ui-state.js`: separate `photo:v1` key with `readPhoto`/`writePhoto`/`clearPhoto`, kept outside `MAX_AGE`/`publish`/`acceptExternal`/broadcast. `readPhoto` distinguishes unavailable storage from "no record". Full validation: path `pending/<uuid>`, whole-payload Base64 decode, WebP header, ≤ 48 KiB decoded, 7 days. `clearUser` removes the user's record; `setAnonymous` removes every photo key.
- [ ] T007 [US3] `js/profile-client.js` (per-tab state only): `photoPath`; `ownConfirmed` with an in-memory `rev`; shared `ownPhotoLoads` keyed by user, generation, `rev` and path (settled entries deleted; `clear()` empties it and `ownConfirmed`); internal `ownProfileConfirmed`, called only from `getMe` (no write since the read started) and from `updateMe`'s notify branch, which keeps a matching record and clears on a type or path change; `applyOwnPhoto` (cached path → no request; fetch only the path last confirmed in this tab; success and failure both re-check owner, generation, node request, confirmed path and `rev` before any DOM change or write); transitional renders and the URL-less `uploaded` marker keep a shown photo or running load for the same owner and generation (evaluated before the request counter is incremented); the shortcut is guarded for own nodes; plain `applyPhoto` without storage, also setting the owner and generation markers for own nodes.
- [ ] T008 [US3] `js/auth/supabaseClient.js`: hydrated render with avatar (catalog, or own photo when cached); `applyProfileAvatar` passes `ownUserId`; no confirmation calls (handled in ProfileClient). The `profile-me` count and the legal fallback are unchanged, and account deletion's local sign-out clears the photo.
- [ ] T009 [US3] `js/account-page.js`: owner summary and public-profile avatar calls pass `ownUserId`; the `!profile` branch resets both nodes.
- [ ] T010 [US3] Update the SRI pins of `js/profile-client.js` on all non-legal pages that pin it; legal pages keep their pins.
- [ ] T011 [US3/US4] Tests listed in `plan.md` ("Fundamental tests"): `tests/user-ui-state.behavior.test.mjs` photo-record rules, plus the profile-client behaviour cases. This includes the A→B→A, late-failure, `setAnonymous` sweep, PATCH and account-deletion sign-out cases. The existing `profile-me` read-count tests stay unchanged.

## Phase 6: Verification and PR
- [ ] T012 Run the test files listed in `plan.md`, one at a time; check `git diff` for removed or rewritten assertions.
- [ ] T013 Open the Draft PR. Deploy Preview: coordinator screenshots (leaderboard with a blocked row, block dialog, top bar on two pages, a photo still visible after 2 min) and the SC-002 Network check.
- [ ] T014 OWNER smoke on the Deploy Preview (US1–US4). Report "implementation ready, awaiting manual runtime verification" until it is confirmed.
- [ ] T015 Separate OWNER GO for Production (WWW release SOP on `origin/main`).

## Dependencies
- T001 comes before everything.
- T002 comes before T003. T004 is independent of T002 and T003.
- T005 and T006 come before T007. T007 comes before T008, T009, T010 and T011. T008 and T009 touch different files and can run in parallel once T007 is done.
- T012 depends on all implementation tasks. T013 → T014 → T015.
