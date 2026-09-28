# Implementation Plan: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend #796)

**Branch**: `796-poker-bot-bad-beat-reactions` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/796-poker-bot-bad-beat-reactions/spec.md`

---

## Summary

Implement the remaining backend scope of issue #796 by extending the WebSocket server's settlement reaction classifier (`ws-server/poker/handlers/reaction.mjs` and `ws-server/server.mjs`). The classifier will automatically emit `bad_beat` for heads-up river reversals where a bot lost all-in, and `not_this_time` for other all-in showdown losses. Both reactions are broadcast without `targetSeatNo`. Heads-up showdown is determined authoritatively by exactly 2 evaluated player hands in `showdown.handsByUserId` (with a single winner), properly accounting for players who left or sat out before showdown.

All-in evidence is determined strictly from authoritative poker state requiring exact equality (`handStartStacksByUserId` and `contributionsByUserId` with `contribution === handStartStack && handStartStack > 0`), absence from `showdown.winners`, and zero payout (`Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0`). Uncalled bet returns or any positive payouts strictly disqualify the bot from lost all-in classification. Any accounting discrepancy (including `contribution > handStartStack`) or missing accounting maps fails closed on the all-in branch only, allowing the classifier to cleanly continue down the existing generic settlement waterfall without altering generic reaction behavior. Helper `buildDetachedReactionContext` remains internal to `server.mjs` and is not exported. Server behavioral tests confirm neither accounting map is exposed to clients.

---

## Technical Context

**Language/Version**: Node.js (ES Modules, modern LTS)
**Primary Dependencies**: None (native Node.js, existing internal poker domain helpers)
**Storage**: None (ephemeral in-memory reaction evaluation; no database migrations or persistence)
**Testing**: Native Node.js test runner (`node --test`)
**Target Platform**: Linux server (Ubuntu systemd `ws-server-preview.service` / `ws-server.service`)
**Project Type**: Real-time WebSocket game server
**Performance Goals**: Sub-millisecond synchronous classification per settled hand
**Constraints**: Zero layout shift, zero gameplay delays, zero accounting mutations, fail-closed safety
**Scale/Scope**: ~30–50 LOC diff across 2 runtime files (`ws-server/server.mjs`, `ws-server/poker/handlers/reaction.mjs`) and 2 test files

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I: Simplicity and Existing Mechanisms
- **Check**: Does the solution reuse existing mechanisms without adding unnecessary abstractions?
- **Result**: **PASS**. Reuses existing `classifySettlementReaction`, `samplePasses`, internal `buildDetachedReactionContext`, `deriveRiverChangedWinnerUserIds`, and existing reaction keys (`bad_beat`, `not_this_time`). No new scheduler, timer map, test-only exports, or classes.

### Principle II: Authoritative Runtime Boundaries
- **Check**: Does the WebSocket server maintain authoritative ownership?
- **Result**: **PASS**. Real-time settlement classification runs entirely within `ws-server`. No reliance on client reports, Netlify functions, or database queries.

### Principle III: Fail-Closed Safety and Environment Separation
- **Check**: Do edge cases fail closed without risking funds or state integrity?
- **Result**: **PASS**. If accounting maps (`handStartStacksByUserId`, `contributionsByUserId`) are missing, non-integer, negative, or show `contribution !== handStartStack`, the all-in branch is cleanly skipped and the classifier proceeds to generic settlement branches without crashing or returning null. If a bot receives an uncalled bet return (`payout > 0`), it is disqualified from lost all-in. The PR will remain Draft and unmerged.

### Principle IV: Platform Compatibility, Logging, and Style
- **Check**: Is logging clean and code style compliant?
- **Result**: **PASS**. Zero `console.log` added; existing `klog` used where applicable. Zero new client scripts or CSP changes required.

### Principle V: Fundamental Tests and Concrete Plans
- **Check**: Are tests strictly deterministic and fundamental, avoiding broad UI/CSS suites?
- **Result**: **PASS**. Only extends existing backend behavioral suites (`ws-server/poker/handlers/reaction.behavior.test.mjs` and `ws-server/server.behavior.test.mjs`). No speculative UI rendering or CSS test suites added. Server integration test validates the complete authoritative pipeline without requiring test-only exports.

### WS Preview Deploy Gate
- **Check**: Does the plan mandate exact-SHA WS Preview Deploy before merge readiness?
- **Result**: **PASS**. Changes touch `ws-server/**`, requiring an explicit manual dispatch of the `WS Preview Deploy` workflow using `--ref main -f ref=<EXACT_SHA>` before final verification.

---

## Project Structure

### Documentation (this feature)

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
```

### Source Code Layout (affected files)

```text
ws-server/
├── server.mjs                           # Update buildDetachedReactionContext to preserve accounting maps (internal)
├── poker/
│   └── handlers/
│       ├── reaction.mjs                 # Extend classifySettlementReaction with lost all-in & bad beat branch
│       └── reaction.behavior.test.mjs   # Unit & behavior tests for all-in/bad-beat classification
└── server.behavior.test.mjs             # Integration test for end-to-end pipeline and dual accounting snapshot isolation
```

---

## Complexity Tracking

> No violations of the Arcade Platform Constitution detected. No additional frameworks, external dependencies, or persistence mechanisms introduced.
