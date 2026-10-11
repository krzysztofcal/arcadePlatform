# Visual review — Variant A v3

Existing design PR #1078 only. Owner accepted V3 landscape, portrait and Daily Bonus on 2026-10-10. Prepare this PR for owner merge; runtime implementation starts only in a separate #1069 PR after merge.

- Landscape: https://deploy-preview-1078--playkcswh.netlify.app/poker/designs/luxury-lobby/landscape.html
- Portrait: https://deploy-preview-1078--playkcswh.netlify.app/poker/designs/luxury-lobby/portrait.html
- Daily Bonus: append #daily-bonus to either URL.

1. Inspect all five original glossy illustrations and four Coming Soon states. Online links the existing lobby.
2. Check four lower shortcuts in order: Online Tables, Progression, Daily Bonus, Profile. No appearance-setting destination, selector, links or scripts remain.
3. Check Play Now before scrolling at 320×568; toolbar must not cover any part. Short pages may scroll vertically. Verify remaining layouts at 360×640, 390×844, 568×320, 844×390 and 1280×800.
4. Open Daily Bonus via shortcut and direct link. Four labeled EXAMPLE STATE cards, disabled Claim, no amounts/countdown. Scroll to footer if necessary; close by touch and Escape with focus return.
5. Verify swipe/indicators/arrows/Home/End, minimum 44px controls, no horizontal page overflow, orientation resize and reduced motion. Large text/200% zoom and physical safe-area inspection remain owner/manual scenarios.
6. Confirm no application wallet/auth/XP/function/WS calls or storage writes. Hosting's own Netlify preview-tool requests are separate.
7. Exact HEAD preview check: deployed CSS/JS/six active art hashes match local assets, both HTML routes 200 with CSP. Netlify-injected HTML is browser-verified rather than byte-identical.

Later, separate approvals: #1069 real guest/auth/quick-seat/Create/Join/Refresh/tier/progression/bonus/back/reconnect integration; #800 shared table-ID resolver with fixed mapping, no player settings; #1079 real economy/history/claims. No backend/DB/WS/Production change authorized.

## Real lobby smoke after #1078 merge
Open the implementation PR Deploy Preview `/poker/` on a phone. Dismiss/decline the consent banner. Check 320–390px portrait and rotated landscape: swipe all five cards, test arrows/dots, Coming Soon details/Escape, Daily Bonus unavailable, Profile and sidebar.

Guest: Play as Guest navigates directly to Poker V2 with `guest=1&autoJoin=1`; the existing runtime deals when ready. Reload/reconnect preserves guest identity/seat.

Authenticated Stage test account: compare actual topbar name/avatar/XP/CH and Progression. With two `availableBuyIns`, highest is initially selected; tap lower exact CH then Play Now once. Confirm exact table buy-in/canonical blinds after auto-join, with no forced start or duplicate debit. A live/financed seat changes action to Resume Game even if bankroll no longer unlocks a tier; verify same table/seat without extra funding. Online Tables preserves Create/Join/Refresh and Back to modes.

Failure checks: no available tier/failed progression disables new play; stale policy/bankroll returns authoritative error and refreshes options. Four active/four pending caps, NORMAL/SLOW/RESTRICTED and funding gates remain server enforced. Disconnect/reconnect should resync without new client start_hand. Do not enable campaigns, alter economy, migrate DB, deploy WS or touch Production.

### Follow-up review smoke
On Preview inspect 844×390/568×320 Guest Online title/status/temporary-chip disclosure, scroll to both actions and click normally; dismiss Netlify Drawer if its external Preview overlay covers controls. Daily Bonus shows four clearly marked sample cards and a disabled Claim, no account history or real amount/timer. On a dedicated authenticated Stage account test Welcome Bonus A→B while status is loading, rapid A→B→A and logout: old eligibility must never show and the latest account must refresh after the old request completes. This authenticated live step and physical-device acceptance remain pending; deterministic mocks do not satisfy them.
