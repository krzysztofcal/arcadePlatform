import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateUnlockBankroll,
  evaluatePokerProgression,
  readPokerBankroll,
  resolvePokerBuyInTiers,
  readPokerProgression
} from "./poker-progression.mjs";
import {
  calculateCanonicalPokerStakes,
  getBotFundingSystemKeyForBuyIn,
  HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY,
  isBotFundingAllowedForBuyIn
} from "./table-economy.mjs";

test("canonical poker stakes keep every tier at a 50 BB starting stack", () => {
  assert.deepEqual(calculateCanonicalPokerStakes(100), { sb: 1, bb: 2 });
  assert.deepEqual(calculateCanonicalPokerStakes(1_000), { sb: 10, bb: 20 });
  assert.deepEqual(calculateCanonicalPokerStakes(10_000_000), { sb: 100_000, bb: 200_000 });
  assert.equal(calculateCanonicalPokerStakes(100_000_000), null);
});

test("bot funding is allowlisted to 100 and 500 CH with separate sources", () => {
  assert.equal(isBotFundingAllowedForBuyIn(100), true);
  assert.equal(getBotFundingSystemKeyForBuyIn(100), "TREASURY");
  assert.equal(getBotFundingSystemKeyForBuyIn(100, { legacySystemKey: "HOUSE" }), "HOUSE");
  assert.equal(isBotFundingAllowedForBuyIn(500), true);
  assert.equal(getBotFundingSystemKeyForBuyIn(500, { legacySystemKey: "HOUSE" }), HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY);
  for (const buyIn of [200, 750, 1_000, 10_000_000]) {
    assert.equal(isBotFundingAllowedForBuyIn(buyIn), false);
    assert.equal(getBotFundingSystemKeyForBuyIn(buyIn), null);
  }
});

test("bot funding with explicit poolClass supports all 11 canonical tiers and rejects non-canonical", () => {
  // 100
  assert.equal(getBotFundingSystemKeyForBuyIn(100, { poolClass: "NORMAL" }), "POKER_BOT_BANKROLL_100");
  assert.equal(getBotFundingSystemKeyForBuyIn(100, { poolClass: "SLOW" }), "POKER_BOT_SLOW_BANKROLL_100");
  // 500 preserves canonical POKER_BOT_BANKROLL for NORMAL
  assert.equal(getBotFundingSystemKeyForBuyIn(500, { poolClass: "NORMAL" }), HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY);
  assert.equal(getBotFundingSystemKeyForBuyIn(500, { poolClass: "SLOW" }), "POKER_BOT_SLOW_BANKROLL_500");
  // 1k
  assert.equal(getBotFundingSystemKeyForBuyIn(1000, { poolClass: "NORMAL" }), "POKER_BOT_BANKROLL_1000");
  assert.equal(getBotFundingSystemKeyForBuyIn(1000, { poolClass: "SLOW" }), "POKER_BOT_SLOW_BANKROLL_1000");
  // 50k
  assert.equal(getBotFundingSystemKeyForBuyIn(50000, { poolClass: "NORMAL" }), "POKER_BOT_BANKROLL_50000");
  assert.equal(getBotFundingSystemKeyForBuyIn(50000, { poolClass: "SLOW" }), "POKER_BOT_SLOW_BANKROLL_50000");
  // 10M
  assert.equal(getBotFundingSystemKeyForBuyIn(10000000, { poolClass: "NORMAL" }), "POKER_BOT_BANKROLL_10000000");
  assert.equal(getBotFundingSystemKeyForBuyIn(10000000, { poolClass: "SLOW" }), "POKER_BOT_SLOW_BANKROLL_10000000");

  // Non-canonical buyIns rejected
  for (const invalidBuyIn of [0, -100, 200, 750, 2000, 99999, 100000000]) {
    assert.equal(getBotFundingSystemKeyForBuyIn(invalidBuyIn, { poolClass: "NORMAL" }), null);
    assert.equal(getBotFundingSystemKeyForBuyIn(invalidBuyIn, { poolClass: "SLOW" }), null);
  }

  // Invalid poolClass rejected
  assert.equal(getBotFundingSystemKeyForBuyIn(500, { poolClass: "UNKNOWN" }), null);
  assert.equal(getBotFundingSystemKeyForBuyIn(500, { poolClass: "" }), null);
});

test("progression resolves the default catalog and unlocks only the highest tier plus one fallback", () => {
  const tiers = resolvePokerBuyInTiers({});
  assert.equal(tiers[0], 100);
  assert.equal(tiers.at(-1), 10_000_000);
  assert.deepEqual(evaluatePokerProgression({ balance: 550, tiers, enabledBuyIns: [100, 500] }).availableBuyIns, [500, 100]);
  assert.deepEqual(evaluatePokerProgression({ balance: 550, tiers, enabledBuyIns: [100, 500] }).tiers.find((tier) => tier.buyIn === 500)?.stakes, { sb: 5, bb: 10 });
  assert.equal(calculateUnlockBankroll(100), 100);
  assert.equal(calculateUnlockBankroll(500), 550);
});

test("the 100 CH tier unlocks at exactly 100 CH while higher tiers keep their buffer", () => {
  const tiers = [100, 500, 1_000];
  const belowMinimum = evaluatePokerProgression({ balance: 99, tiers, enabledBuyIns: [100, 500] });
  const atMinimum = evaluatePokerProgression({ balance: 100, tiers, enabledBuyIns: [100, 500] });
  assert.deepEqual(belowMinimum.availableBuyIns, []);
  assert.deepEqual(atMinimum.availableBuyIns, [100]);
  assert.equal(atMinimum.tiers.find((tier) => tier.buyIn === 100)?.unlockBankroll, 100);
  assert.equal(atMinimum.tiers.find((tier) => tier.buyIn === 500)?.unlockBankroll, 550);
  assert.equal(atMinimum.tiers.find((tier) => tier.buyIn === 1_000)?.unlockBankroll, 1_100);
});


test("authoritative bankroll reads can lock the account row for the join transaction", async () => {
  let query = "";
  const balance = await readPokerBankroll({
    unsafe: async (sql) => {
      query = String(sql);
      return [{ balance: 550 }];
    }
  }, { userId: "user-1", lock: true });
  assert.equal(balance, 550);
  assert.match(query, /for update/i);
});

test("enabled tiers keep the highest playable tier uncapped and skip disabled fallback", () => {
  const tiers = [100, 500, 1000, 5000];
  for (const [enabledBuyIns, expected] of [
    [[100, 500], [500, 100]], [[100, 500, 1000], [1000, 500]],
    [[100, 500, 1000, 5000], [5000, 1000]], [[100, 1000], [1000, 100]]
  ]) {
    for (const balance of [10_000, 1_000_000]) {
      const result = evaluatePokerProgression({ balance, tiers, enabledBuyIns });
      assert.deepEqual(result.availableBuyIns, expected);
      assert.equal(result.highestUnlockedBuyIn, 5000);
      assert.equal(result.tiers.length, 4);
      assert.equal(result.tiers.every((tier) => tier.unlocked && tier.progressPercent === 100 && tier.remaining === 0), true);
    }
  }
  assert.deepEqual(evaluatePokerProgression({ balance: 549, tiers, enabledBuyIns: [100, 500] }).availableBuyIns, [100]);
  assert.deepEqual(evaluatePokerProgression({ balance: 550, tiers, enabledBuyIns: [100, 500] }).availableBuyIns, [500, 100]);
  assert.deepEqual(evaluatePokerProgression({ balance: 1099, tiers, enabledBuyIns: [100, 500, 1000] }).availableBuyIns, [500, 100]);
  assert.deepEqual(evaluatePokerProgression({ balance: 1100, tiers, enabledBuyIns: [100, 500, 1000] }).availableBuyIns, [1000, 500]);
  assert.deepEqual(evaluatePokerProgression({ balance: 1_000_000, tiers }).availableBuyIns, []);
});


test("legacy subset ENV cannot block Enabled 1000 or truncate the canonical roadmap", async () => {
  for (const enabled of [false, true]) {
    const result = await readPokerProgression({ unsafe: async (sql, params) => {
      if (sql.includes("to_regclass")) return [{ available: true }];
      if (sql.includes("poker_bot_tier_policy")) return [100, 500, 1000].map((buy_in) => ({
        buy_in, enabled: buy_in !== 1000 || enabled, revision: 1,
        normal_refill_threshold_ch: 1, normal_refill_amount_ch: 10,
        slow_refill_threshold_ch: 1, slow_refill_amount_ch: 10
      }));
      if (sql.includes("system_key = any")) return params[0].map((system_key) => ({ system_key }));
      if (sql.includes("select balance")) return [{ balance: 1_000_000 }];
      throw new Error("unexpected query");
    } }, { userId: "wealthy", env: { POKER_BUY_IN_TIERS_JSON: "[100,500]" } });
    assert.deepEqual(result.availableBuyIns, enabled ? [1000, 500] : [500, 100]);
    assert.deepEqual(result.enabledBuyIns, enabled ? [100, 500, 1000] : [100, 500]);
    assert.equal(result.tiers.length, 11);
  }
});
