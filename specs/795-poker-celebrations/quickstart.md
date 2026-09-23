# Validation and handoff

Run `node --test tests/poker-settlement-presentation.unit.test.mjs tests/poker-v2-live.behavior.test.mjs` and `node --check poker/poker-v2.js`.

On the PR deploy, open Poker V2 and join a real guest or signed-in table. Tap Preview FX, then Royal Flush, Monster Pot or Win Streak ×5. Repeat during play and check normal cards, turn, controls, payout, leave and rebuy visibility. A real settlement/turn must immediately dismiss demo hero; at most 400 ms faint ring remains. Use portrait/landscape Android and desktop.

Toggle Celebration animations OFF in existing Table settings during FX; it must vanish immediately. Refresh and check guest persistence. Sign in/out and check isolated settings. Enable OS reduced motion; no animation should start, including preview. Reconnect or return to a hidden tab: no result replay.

Check Production/branch/missing/inconsistent build metadata: no Preview FX controls or global preview entrypoint. Verify server results unchanged and one prioritized live effect per hand. For Monster Pot verify 5× authoritative buy-in against a single player's contested awards, excluding returns. Live streak intentionally deferred.

Record actual browser, deterministic and live-runtime results here before handoff; do not infer live smoke from CI. Final artistic acceptance and physical Android smoke belong to owner.
