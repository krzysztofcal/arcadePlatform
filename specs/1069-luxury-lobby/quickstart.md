# Visual review — Variant A v3

Existing Draft PR #1078 only. Owner visual approval and final implementation remain pending.

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
