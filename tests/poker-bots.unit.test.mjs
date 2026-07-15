import assert from "node:assert/strict";
import {
  chooseBotActionTrivial,
  computeTargetBotCount,
  getBotConfig,
  makeBotSystemKey,
  makeBotUserId,
} from "../netlify/functions/_shared/poker-bots.mjs";

{
  const cfg = getBotConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.minPerTable, 2);
  assert.equal(cfg.maxPerTable, 5);
  assert.equal(cfg.defaultProfile, "RANDOM");
  assert.equal(cfg.buyInChips, 100);
  assert.equal(cfg.bankrollSystemKey, "TREASURY");
  assert.equal(cfg.maxActionsPerPoll, 2);
}

{
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "1" }).enabled, true);
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "true" }).enabled, true);
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "0" }).enabled, false);
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "false" }).enabled, false);
  assert.equal(getBotConfig({ POKER_BOTS_MIN_PER_TABLE: "1" }).minPerTable, 1);
  assert.equal(getBotConfig({ POKER_BOTS_MAX_PER_TABLE: "99" }).maxPerTable, 9);
  assert.equal(getBotConfig({ POKER_BOT_BUYIN_BB: "250" }).buyInChips, 100);
  assert.equal(getBotConfig({ POKER_BOT_PROFILE_DEFAULT: " tight " }).defaultProfile, "TIGHT");
}

{
  const a = makeBotUserId("table-1", 2);
  const b = makeBotUserId("table-1", 2);
  const c = makeBotUserId("table-1", 3);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const parts = a.split("-");
  assert.equal(parts[2][0], "5");
  assert.match(parts[3][0], /^[89ab]$/i);
}

{
  assert.equal(makeBotSystemKey("t-99", 4), "POKER_BOT:t-99:4");
}

{
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 1, minBots: 2, maxBots: 5, random: () => 0 }), 2);
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 1, minBots: 2, maxBots: 5, random: () => 0.999 }), 5);
  assert.equal(computeTargetBotCount({ maxPlayers: 2, humanCount: 1, minBots: 2, maxBots: 5 }), 1);
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 5, minBots: 2, maxBots: 5 }), 1);
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 0, maxBots: 5 }), 0);
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 6, maxBots: 5 }), 0);
}

{
  const strongPreflop = {
    userId: "bot_1",
    botProfile: "NORMAL",
    random: () => 0.2,
    state: { phase: "PREFLOP", toCallByUserId: { bot_1: 0 } },
    privateState: { holeCardsByUserId: { bot_1: ["AS", "AD"] } }
  };
  assert.deepEqual(
    chooseBotActionTrivial([{ type: "BET", min: 15 }, "CHECK", "FOLD"], strongPreflop),
    { type: "BET", amount: 15 }
  );
  assert.deepEqual(
    chooseBotActionTrivial(["BET", "CHECK", "FOLD"], strongPreflop),
    { type: "CHECK" }
  );
  assert.deepEqual(
    chooseBotActionTrivial([{ type: "BET", amount: 0 }, "CHECK", "FOLD"], strongPreflop),
    { type: "CHECK" }
  );
  assert.deepEqual(
    chooseBotActionTrivial(["RAISE", "CALL", "FOLD"], { ...strongPreflop, state: { phase: "PREFLOP", toCallByUserId: { bot_1: 2 } } }),
    { type: "CALL" }
  );
  assert.deepEqual(
    chooseBotActionTrivial([{ type: "RAISE", min: 20 }, "CALL", "FOLD"], { ...strongPreflop, state: { phase: "PREFLOP", toCallByUserId: { bot_1: 2 } } }),
    { type: "RAISE", amount: 20 }
  );
  assert.deepEqual(
    chooseBotActionTrivial(
      [{ type: "RAISE", min: 22 }, "CALL", "FOLD"],
      {
        ...strongPreflop,
        state: {
          phase: "PREFLOP",
          toCallByUserId: { bot_1: 4 },
          lastBettingRoundActionByUserId: { bot_1: "RAISE" }
        }
      }
    ),
    { type: "CALL" }
  );

  const weakTightFacingCall = {
    userId: "bot_2",
    botProfile: "TIGHT",
    random: () => 0.9,
    state: { phase: "PREFLOP", toCallByUserId: { bot_2: 8 } },
    privateState: { holeCardsByUserId: { bot_2: ["2C", "7D"] } }
  };
  assert.deepEqual(chooseBotActionTrivial(["CALL", "FOLD"], weakTightFacingCall), { type: "FOLD" });

  const freeCheck = {
    userId: "bot_3",
    botProfile: "LOOSE",
    random: () => 0.9,
    state: { phase: "FLOP", community: ["2S", "9D", "KC"], toCallByUserId: { bot_3: 0 } },
    privateState: { holeCardsByUserId: { bot_3: ["3C", "8D"] } }
  };
  assert.deepEqual(chooseBotActionTrivial(["CHECK", "FOLD"], freeCheck), { type: "CHECK" });
  assert.equal(chooseBotActionTrivial([], strongPreflop), null);
}
