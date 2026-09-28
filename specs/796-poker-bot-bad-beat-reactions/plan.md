# Implementation Plan: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend + Poker V2 Catalog #796)

**Branch**: `796-poker-bot-bad-beat-reactions` | **Date**: 2026-09-27 (Revised 2026-09-28) | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/796-poker-bot-bad-beat-reactions/spec.md` based on live GitHub issue #796.

---

## Summary

Implement the remaining backend & Poker V2 scope of issue #796 by extending the WebSocket server's settlement reaction classifier (`ws-server/poker/handlers/reaction.mjs`, `ws-server/server.mjs`) and the client reaction catalog (`poker/poker-v2.js`).

1. The classifier automatically emits `bad_beat` for narrow heads-up river reversals where a bot lost all-in, and samples uniformly from a new dedicated 5-reaction bot-only pool (`all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, `all_in_censored`) for all other qualifying lost all-in showdowns.
2. The existing `not_this_time` reaction key remains exclusively reserved for the bot's fold reaction (`FOLD -> not_this_time`) and is NEVER emitted for lost all-in.
3. In `poker/poker-v2.js`, client `REACTION_CATALOG` is extended with the 5 new bot-only keys (`humanSelectable: false`), and each maps to the existing `shake` avatar motion in existing helper `resolveBotAvatarReactionMotion`. On the server (`ws-server/poker/handlers/reaction.mjs`), the keys are added to `REACTION_KEYS` (automatically populating `REACTION_KEY_SET`) without adding to `HUMAN_REACTION_KEYS`. No new CSS, animation types, or timers are introduced.
4. All-in evidence is determined strictly from uncoerced integer accounting fields (`handStartStacksByUserId` and `contributionsByUserId` with `contribution === handStartStack && handStartStack > 0`), absence from `showdown.winners`, and zero payout (`Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0`). Uncalled bet returns refunded from side pots strictly disqualify the bot from lost all-in classification.
5. Fail-closed fallthrough: any accounting discrepancy or missing maps skips the all-in branch only, allowing the classifier to cleanly continue down the existing generic settlement waterfall without altering generic reaction behavior.
6. The new branch executes up to two sequential draws using injected `random`: Draw 1 evaluates frequency gate `samplePasses(random, 1, reactionSettings)` (base probability = 1.0); Draw 2 (for ordinary all-in losses) samples uniformly across the 5 keys via `sampleAllInLossReactionKey(random)`. Both `bad_beat` and all-in loss reactions are untargeted table broadcasts (no `targetSeatNo`).
7. Helper `buildDetachedReactionContext` remains internal to `server.mjs` and is not exported. Server behavioral tests confirm neither accounting map is exposed to clients.

---

## Technical Context

**Language/Version**: Node.js (ES Modules for server, JSP-compatible plain JS for client)
**Primary Dependencies**: None (native Node.js, existing internal poker domain helpers)
**Storage**: None (ephemeral in-memory reaction evaluation; no database migrations or persistence)
**Testing**: Native Node.js test runner (`node --test`)
**Target Platform**: Linux server (Ubuntu systemd `ws-server-preview.service`) + browser client
**Performance Goals**: Sub-millisecond synchronous classification per settled hand
**Constraints**: Zero layout shift, zero gameplay delays, zero accounting mutations, fail-closed safety, JSP compatibility
**Scale/Scope**: ~50–70 LOC diff across 3 runtime files (`ws-server/server.mjs`, `ws-server/poker/handlers/reaction.mjs`, `poker/poker-v2.js`) and 3 test files

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I: Simplicity and Existing Mechanisms
- **Check**: Does the solution reuse existing mechanisms without adding unnecessary abstractions?
- **Result**: **PASS**. Reuses existing `classifySettlementReaction`, `samplePasses`, internal `buildDetachedReactionContext`, `deriveRiverChangedWinnerUserIds`, existing `shake` avatar motion, and existing `table_reaction` protocol. No new scheduler, timer map, test-only exports, or classes.

### Principle II: Authoritative Runtime Boundaries
- **Check**: Does the WebSocket server maintain authoritative ownership?
- **Result**: **PASS**. Real-time settlement classification runs entirely within `ws-server`. The client's role is strictly presentation via `REACTION_CATALOG` and `resolveBotAvatarReactionMotion`.

### Principle III: Fail-Closed Safety and Environment Separation
- **Check**: Do edge cases fail closed without risking funds or state integrity?
- **Result**: **PASS**. If accounting maps are missing, non-integer, negative, or show `contribution !== handStartStack`, the all-in branch is cleanly skipped and the classifier proceeds to generic settlement branches without crashing or returning null. If a bot receives an uncalled bet return (`payout > 0`), it is disqualified from lost all-in. The PR will remain Draft and unmerged.

### Principle IV: Platform Compatibility, Logging, and Style
- **Check**: Is logging clean and code style compliant?
- **Result**: **PASS**. Zero `console.log` added; existing `klog` used where applicable. Browser JS in `poker/poker-v2.js` remains JSP-compatible without module imports. Zero CSP changes required.

### Principle V: Fundamental Tests and Concrete Plans
- **Check**: Are tests strictly deterministic and fundamental, avoiding broad UI/CSS suites?
- **Result**: **PASS**. Only extends existing backend behavioral suites (`ws-server/poker/handlers/reaction.behavior.test.mjs`, `ws-server/server.behavior.test.mjs`) and existing live client test (`tests/poker-v2-live.behavior.test.mjs`). No speculative UI rendering or CSS test suites added.

### WS Preview Deploy Gate
- **Check**: Does the plan mandate exact-SHA WS Preview Deploy before merge readiness?
- **Result**: **PASS**. Changes touch `ws-server/**`, requiring an explicit manual dispatch of the `WS Preview Deploy` workflow using `--ref main -f ref=<EXACT_SHA>` before final verification.

---

## Project Structure

### Documentation & Protocol (this feature)

```text
specs/796-poker-bot-bad-beat-reactions/
├── spec.md              # Feature specification ($speckit-specify output)
├── checklists/
│   └── requirements.md  # Specification quality checklist
├── plan.md              # This implementation plan ($speckit-plan output)
├── research.md          # Background research and codebase reconciliation
├── data-model.md        # Entities, context schemas, and classification matrix
├── quickstart.md        # Automated commands, deploy gate, and smoke scenarios
├── contracts/
│   └── settlement-reaction-contract.md # API and protocol contracts
└── tasks.md             # Actionable task list ($speckit-tasks output)

docs/
└── ws-poker-protocol.md # Minimal protocol update documenting the 5 new bot-only reaction keys
```

### Source Code Layout (affected files)

```text
poker/
└── poker-v2.js                          # Extend REACTION_CATALOG with 5 bot-only keys and map to 'shake' in resolveBotAvatarReactionMotion
ws-server/
├── server.mjs                           # Update buildDetachedReactionContext to preserve accounting maps (internal)
├── poker/
│   └── handlers/
│       ├── reaction.mjs                 # Extend REACTION_KEYS (auto-populating REACTION_KEY_SET); bad-beat & all-in pool
│       └── reaction.behavior.test.mjs   # Unit & behavior tests for all-in pool & bad-beat classification
└── server.behavior.test.mjs             # Integration test for end-to-end pipeline and dual accounting snapshot isolation
tests/
└── poker-v2-live.behavior.test.mjs      # Test client catalog extension, humanSelectable: false, and motion mapping
```

---

## Breaking Impact & Compatibility

- **Semantic Vocabulary Expansion**: The semantic reactionKey vocabulary expands by five bot-only keys (`all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, `all_in_censored`). `docs/ws-poker-protocol.md` is updated accordingly.
- **Protocol Stability**: Zero WebSocket message-type / payload-shape changes (`table_reaction` payload shape `{ seatNo, reactionKey }` remains completely identical).
- **Human UI Isolation**: All 5 new keys have `humanSelectable: false` and are excluded from `HUMAN_REACTION_KEYS`. Human reaction options and table controls are unaffected.
