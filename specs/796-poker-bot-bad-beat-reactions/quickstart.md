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

## 3. Manual Deploy Preview Smoke Test Checklist

Open the Netlify Deploy Preview URL connected to `ws-preview.kcswh.pl` and navigate to `poker/table-v2.html`.

### Scenario 1: Standard Table Health & Fold Reaction
1. Join an active table with bots.
2. Observe a hand where a bot folds.
3. **Verify**:
   - The folding bot can emit `not_this_time` ("Nie tym razem!") with avatar `shake`.
   - Normal table gameplay proceeds without errors or console warnings.

### Scenario 2: Ordinary All-In Showdown Loss (Pool of 5 Reactions)
1. Play a hand where a bot is all-in (preflop, flop, or turn).
2. Another player wins at showdown on a non-reversal runout or multiway showdown.
3. **Verify**:
   - The losing all-in bot displays a speech bubble with one of the 5 new reactions:
     - 😞 "Oh no..."
     - 😣 "That hurts."
     - 😠 "No way..."
     - 😤 "Come on!"
     - 🤬 "******!"
   - The reaction is NEVER `not_this_time`.
   - The bot avatar executes the `shake` motion.
   - The reaction is an untargeted table broadcast without a target pointer.

### Scenario 3: River Reversal Bad Beat (`bad_beat`)
1. Observe a heads-up all-in confrontation where the turn leader is overtaken on the river.
2. **Verify**:
   - The losing all-in bot emits `bad_beat` (speech bubble: 😢 "Bad beat").
   - The bot avatar executes the `shake` motion.
   - The reaction is an untargeted table broadcast without a target pointer.

### Scenario 4: Human Reaction Menu Isolation
1. As a human player at the table, click the emoji reaction trigger to open the reaction bar.
2. **Verify**:
   - None of the 5 new bot-only all-in loss reactions appear in the human reaction selector.
   - Existing human reactions function normally.

### Scenario 5: Admin Frequency & Disable Controls
1. In Admin → Ops, toggle bot reactions to disabled.
2. Play through all-in confrontations.
3. **Verify**:
   - Zero bot reactions are broadcast.
