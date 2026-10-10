# Review and validation guide — arcade v2

Use already-declared dependencies and a static HTTP server; no account credentials or live API calls needed. Run `python3 -m http.server 4173` from repository root.

Open `/poker/designs/luxury-lobby/` on local server or https://deploy-preview-1078--playkcswh.netlify.app. Review routes:
- `landscape.html` and `portrait.html`: five cinematic mode cards.
- `landscape.html#daily-bonus` and `portrait.html#daily-bonus`: native reward concepts.
- `landscape.html#cosmetics` and `portrait.html#cosmetics`: six free theme previews.

Existing checks: `npm run syntax`, `npm run check:csp-inline`, `npm run ci:guards`. No new maintained UI/CSS/JSP/glue test suite.

## Bounded review scenarios
1. Landscape 1280×800/844×390/568×320; portrait 390×844/360×640/320×568. Five modes reachable by swipe/indicators/keyboard, dominant portrait card/next peek, no unintended page-wide overflow. Short screens may scroll vertically.
2. Four Coming Soon detail buttons: honest scope, no play/purchase/rewards; Escape and focus return. Online/Online Tables/Profile destinations unchanged.
3. Daily Bonus: bottom shortcut, Day 1–4 labeled examples, disabled Claim, no amounts/countdown/claim mutation. Four-across landscape, two-by-two portrait; small phones scroll dialog to footer and close controls.
4. Cosmetics: all six Free, Auto/Random visibly default, manual previews and Auto reset; selected state truthful and temporary. Check each actual rail/felt/room/dealer, card styling/frame for non-Classic; Classic native defaults restored. No paid/VIP/access placeholders or random reroll.
5. Keyboard arrows/Home/End on focused carousel; indicators/toolbar ≥44px hit targets. Dialog Tab containment, Escape/focus return, reduced motion, orientation resize, large text/200% zoom and safe areas.
6. Network/storage: no prototype account/CH/XP/reward/function/WS calls or storage writes. Netlify may inject its own preview/CDP drawer requests and permissions-policy messages; those are hosting tooling, not platform requests.
7. Exact final HEAD Netlify preview: both routes/active art/CSS/scripts respond 200; correct CSP; real touches/clicks work with drawer scoped out. Verify deployed CSS/art hashes match local final files and artifact screenshots capture final revision.

## Later implementation, not executed
After explicit visual approval: existing guest/auth/current actions/progression/bonus/signout/account switch/reconnect. Separate #800 free Auto/manual choice persistence, invalid mode/ID/storage/art failure and stable participation/reload scenarios. Separate #1079 economic/status approval before any real claim/history/timing. No backend/DB/WS/Production action is authorized here.
