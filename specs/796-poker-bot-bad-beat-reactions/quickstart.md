# Quickstart: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend + Poker V2 Catalog #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`

**Created**: 2026-09-27 | **Revised**: 2026-09-28

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [contracts/settlement-reaction-contract.md](contracts/settlement-reaction-contract.md)

---

## 1. Automated Verification Commands

Run the deterministic test suites covering reaction behavior, server integration, and client catalog behavior:

```bash
# 1. Verify syntax across codebase
npm run syntax

# 2. Run repository guards (lifecycle, badges, XP hooks)
npm run check:all

# 3. Run reaction handler unit & behavioral tests
node --test ws-server/poker/handlers/reaction.behavior.test.mjs

# 4. Run server integration tests
node --test ws-server/server.behavior.test.mjs

# 5. Run live browser client behavior tests (catalog, humanSelectable, motion lookup)
node --test tests/poker-v2-live.behavior.test.mjs
```

---

## 2. WS Preview Deploy Procedure (MANDATORY GATE)

Because this feature modifies `ws-server/**`, repository policy (**AGENTS.md & Constitution Principle II**) dictates that **green CI does not constitute proof of runtime integration**.

Before manual runtime verification:

1. Obtain the exact latest runtime-affecting commit SHA on the PR branch (e.g. `$RUNTIME_SHA`).
2. Trigger the manual `WS Preview Deploy` workflow:
   ```bash
   gh workflow run "WS Preview Deploy" --ref main -f ref=$RUNTIME_SHA
   ```
3. Monitor and verify the run succeeded for that exact SHA:
   ```bash
   gh run list --workflow="WS Preview Deploy" -L 1
   ```
4. Verify server logs if needed:
   ```bash
   sudo journalctl -u ws-server-preview.service --no-pager -n 100
   ```

---

## 3. Deploy Preview Verification Checklist

Open the Netlify Deploy Preview URL connected to `ws-preview.kcswh.pl` and navigate to `poker/table-v2.html`.

Because WS Preview uses cryptographic PRNG dealing without state/deck injection backdoors, verification is divided into **Mandatory Manual Live Smoke** (for standard interactions, UI presentation, and admin controls) and **Mandatory Deterministic Automated Verification** (for rare card-dependent showdown outcomes).

---

### Part A: Mandatory Manual Deploy Preview Smoke (Live Integration & UI)

#### Scenario 1: Standard Table Health & Fold Reaction (Live Smoke — Mandatory)
1. Join an active table with bots on Netlify Deploy Preview connected to WS Preview.
2. Observe a hand where a bot folds facing a bet/raise.
3. **Verify**:
   - The folding bot can emit `not_this_time` ("😌 Not this time.") with avatar `shake`.
   - Normal table gameplay proceeds without errors or console warnings.

#### Scenario 4: Human Reaction Menu Isolation (Live Smoke — Mandatory)
1. As a seated player at the table, click the emoji reaction trigger (`#pokerV2ReactionBtn`) to open the reaction bar.
2. **Verify**:
   - None of the 5 new bot-only all-in loss reactions appear in the human reaction selector (`humanSelectable: false`).
   - Existing human reactions function normally (e.g. clicking `Cheers!` renders speech bubble and avatar motion).

#### Scenario 5: Admin Frequency & Disable Controls (Live Smoke — Mandatory)
1. In Admin → Ops (or via admin endpoint `/.netlify/functions/admin-ws-preview-bot-reaction`), toggle bot reactions to disabled (`enabled: false`).
2. Observe table gameplay while disabled.
3. **Verify**:
   - Zero bot reactions are broadcast during the disabled window.
   - Restoring `enabled: true` restores bot reaction emission.

---

### Part B: Mandatory Deterministic Automated Verification (Card-Dependent Outcomes)

Because poker card dealing is randomized and WS Preview intentionally lacks state/deck injection backdoors to keep the preview administrative surface minimal, Scenarios 2 and 3 are verified through mandatory deterministic automated test suites. Natural live observation during free play is recorded when encountered, but is not a blocking deployment gate.

#### Scenario 2: Ordinary All-In Showdown Loss (Pool of 5 Reactions) (Deterministic Suite — Mandatory)
- **Deterministic Verification**: `ws-server/poker/handlers/reaction.behavior.test.mjs`, `ws-server/server.behavior.test.mjs`, `tests/poker-v2-live.behavior.test.mjs`
- **Verify**:
  - A bot losing an all-in showdown (`contribution === handStartStack`, payout 0) on a non-reversal runout or multiway showdown emits one of the 5 new reactions:
    - 😞 "Oh no..." (`all_in_oh_no`)
    - 😣 "That hurts." (`all_in_that_hurts`)
    - 😠 "No way..." (`all_in_no_way`)
    - 😤 "Come on!" (`all_in_come_on`)
    - 🤬 "******!" (`all_in_censored`)
  - The reaction is NEVER `not_this_time`.
  - The bot avatar maps to `shake` motion in `resolveBotAvatarReactionMotion`.
  - The reaction is an untargeted table broadcast (omits `targetSeatNo`).
- **Optional Live Observation**: If naturally encountered during preview play, observe speech bubble with one of the 5 reaction labels and avatar `shake`.

#### Scenario 3: River Reversal Bad Beat (`bad_beat`) (Deterministic Suite — Mandatory)
- **Deterministic Verification**: `ws-server/poker/handlers/reaction.behavior.test.mjs`, `ws-server/server.behavior.test.mjs`
- **Verify**:
  - A heads-up all-in showdown (exactly 2 hands evaluated in `showdown.handsByUserId`) where a single winner overtakes the turn leader on the river card (`riverChangedWinnerUserIds`) causes the losing all-in bot to emit `bad_beat` (speech bubble: 😢 "Bad beat").
  - Multiway river reversals fall back to the 5-reaction all-in loss pool.
  - The reaction is an untargeted table broadcast (omits `targetSeatNo`).
- **Optional Live Observation**: If naturally encountered during preview play, observe speech bubble 😢 "Bad beat" and avatar `shake`.
