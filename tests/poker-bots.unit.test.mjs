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
  assert.equal(cfg.maxPerTable, 2);
  assert.equal(cfg.defaultProfile, "TRIVIAL");
  assert.equal(cfg.buyInBB, 100);
  assert.equal(cfg.bankrollSystemKey, "TREASURY");
  assert.equal(cfg.maxActionsPerPoll, 2);
}

{
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "1" }).enabled, true);
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "true" }).enabled, true);
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "0" }).enabled, false);
  assert.equal(getBotConfig({ POKER_BOTS_ENABLED: "false" }).enabled, false);
  assert.equal(getBotConfig({ POKER_BOTS_MAX_PER_TABLE: "99" }).maxPerTable, 9);
  assert.equal(getBotConfig({ POKER_BOT_BUYIN_BB: "0" }).buyInBB, 1);
  assert.equal(getBotConfig({ POKER_BOT_PROFILE_DEFAULT: " tight " }).defaultProfile, "TIGHT");
}

{
  const a = makeBotUserId("table-1", 2);
  const b = makeBotUserId("table-1", 2);
  const c = makeBotUserId("table-1", 3);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
}

{
  assert.equal(makeBotSystemKey("t-99", 4), "POKER_BOT:t-99:4");
}

{
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 1, maxBots: 2 }), 2);
  assert.equal(computeTargetBotCount({ maxPlayers: 2, humanCount: 1, maxBots: 2 }), 0);
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 5, maxBots: 2 }), 0);
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 0, maxBots: 2 }), 0);
  assert.equal(computeTargetBotCount({ maxPlayers: 6, humanCount: 6, maxBots: 2 }), 0);
}

{
  assert.deepEqual(chooseBotActionTrivial(["CHECK", "CALL"]), { type: "CHECK" });
  assert.deepEqual(chooseBotActionTrivial(["CALL", "FOLD"]), { type: "CALL" });
  assert.deepEqual(chooseBotActionTrivial(["FOLD"]), { type: "FOLD" });
  assert.deepEqual(
    chooseBotActionTrivial([{ type: "BET", min: 15 }, { type: "RAISE", min: 22 }]),
    { type: "BET", amount: 15 },
  );
  assert.equal(chooseBotActionTrivial([]), null);
}
