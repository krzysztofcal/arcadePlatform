# Research — current main and live requirements

Baseline: `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4`, verified with live GitHub main on 2026-10-10. Read `agents.md`, `skills.md`, constitution v1.1.1 and live issue bodies/comments. Issues had no attachment-bearing comments. GitHub main protection is active; Draft PR only, no merge.

| Decision | Rationale | Alternatives considered |
| --- | --- | --- |
| Native illustrated card carousel | Latest #1069 clarification explicitly supersedes dashboard-first arrangement | Equal-width grid or text hero/stacked sections violate current brief |
| Isolated review pages, no final lobby edit | Owner asks to approve actual visuals first | Feature flag inside current initLobby adds unnecessary runtime risk at this stage |
| Existing action closures and ID nodes later | Current `initLobby()` binds IDs/delegated table events and handles auth/loading | New app shell/router duplicates working mechanisms |
| Original AI-generated five-card artwork | No screenshot artwork license; locally hosted polished art is required | Borrowed assets disallowed; generic vector placeholders would not meet visual quality |
| Existing six theme assets for gallery | #1076 already merged; catalog and loader in `poker-v2.js` are preview-local | A second runtime catalog/persistence implementation duplicates #800 |
| Classic-only permitted selection default | No authoritative free/paid selection policy supplied | Declaring all themes owned/free would invent rights; backend purchase additions out of scope |
| User-scoped versioned local preference for #800 | Existing social/auto-rebuy helpers establish identity isolation pattern; cosmetic-only | Profile/DB preference and server shared-theme authority add unauthorized schema/runtime scope |
| No automated UI unit suite | Constitution prohibits rendering/CSS/glue/JSP suites | New test framework/TDD adds prohibited scope; bounded existing browser review is adequate |

## Facts that change the design
- Actual lobby owner is `poker/poker.js:initLobby()`, not absent `portal/portal.js`. `js/portal.js` handles games grid. Shared navigation is `js/topbar.js` / `js/sidebar.js`.
- Profile is `/account.html`; welcome-bonus lobby CTA also opens account, conditional on `eligible && !alreadyClaimed`.
- Progression distinguishes unlocked versus presently available tiers; preserve both.
- Current theme loader is deploy-preview-only and nonpersistent; cannot claim #800 complete because theme art exists.
- #1069 owns five shells; #1077 Single Player is online, #1075 Seasons is weekly designated-table visuals, #797 tournaments have no implemented playable route.
- Latest issue approves removing Poker-only AdSense in later lobby implementation; this additive review leaves current lobby untouched.
- No external API research needed: all integration contracts are existing repository behavior. Use existing Netlify Git PR deployment, no new project or Production changes.
