import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateUnlockBankroll,
  evaluatePokerProgression,
  readPokerBankroll,
  resolvePokerBuyInTiers,
  resolvePokerMaxPlayableBuyIn,
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
  assert.deepEqual(evaluatePokerProgression({ balance: 550, tiers }).availableBuyIns, [500, 100]);
  assert.deepEqual(evaluatePokerProgression({ balance: 550, tiers }).tiers.find((tier) => tier.buyIn === 500)?.stakes, { sb: 5, bb: 10 });
  assert.equal(calculateUnlockBankroll(100), 100);
  assert.equal(calculateUnlockBankroll(500), 550);
});

test("the 100 CH tier unlocks at exactly 100 CH while higher tiers keep their buffer", () => {
  const tiers = [100, 500, 1_000];
  const belowMinimum = evaluatePokerProgression({ balance: 99, tiers });
  const atMinimum = evaluatePokerProgression({ balance: 100, tiers });
  assert.deepEqual(belowMinimum.availableBuyIns, []);
  assert.deepEqual(atMinimum.availableBuyIns, [100]);
  assert.equal(atMinimum.tiers.find((tier) => tier.buyIn === 100)?.unlockBankroll, 100);
  assert.equal(atMinimum.tiers.find((tier) => tier.buyIn === 500)?.unlockBankroll, 550);
  assert.equal(atMinimum.tiers.find((tier) => tier.buyIn === 1_000)?.unlockBankroll, 1_100);
});

test("progression accepts a sorted deduplicated configured catalog and rejects invalid configuration", () => {
  assert.deepEqual(resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[500, 100, 500]" }), [100, 500]);
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[100, 1.5]" }),
    (error) => error?.code === "poker_buy_in_tiers_config_invalid"
  );
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[100, 125]" }),
    (error) => error?.code === "poker_buy_in_tiers_config_invalid"
  );
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[]" }),
    (error) => error?.code === "poker_buy_in_tiers_config_invalid"
  );
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[500, 1000]" }),
    (error) => error?.code === "poker_buy_in_tiers_config_invalid"
  );
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[100, 2147483648]" }),
    (error) => error?.code === "poker_buy_in_tiers_config_invalid"
  );
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[100, 100000000]" }),
    (error) => error?.code === "poker_buy_in_tiers_config_invalid"
  );
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

test("playable frontier caps availability while preserving the full bankroll roadmap", async () => {
  const tiers = [100, 500, 1000, 5000];
  for (const [maxPlayableBuyIn, expected] of [[500, [500, 100]], [1000, [1000, 500]], [5000, [5000, 1000]]]) {
    const result = evaluatePokerProgression({ balance: 1_000_000, tiers, maxPlayableBuyIn });
    assert.deepEqual(result.availableBuyIns, expected);
    assert.equal(result.maxPlayableBuyIn, maxPlayableBuyIn);
    assert.equal(result.highestUnlockedBuyIn, 5000);
    assert.equal(result.tiers.length, 4);
    assert.equal(result.tiers.every((tier) => tier.unlocked && tier.progressPercent === 100 && tier.remaining === 0), true);
  }
  assert.deepEqual(evaluatePokerProgression({ balance: 549, tiers, maxPlayableBuyIn: 500 }).availableBuyIns, [100]);
  assert.equal(resolvePokerMaxPlayableBuyIn({}, tiers), 500);
  let reads = 0;
  const result = await readPokerProgression({ unsafe: async () => { reads++; return [{ balance: 1_000_000 }]; } }, {
    userId: "wealthy", env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify(tiers), POKER_MAX_PLAYABLE_BUY_IN: "1000" }
  });
  assert.deepEqual(result.availableBuyIns, [1000, 500]);
  assert.equal(reads, 1);
});

test("invalid playable frontier fails closed as a tier configuration error", () => {
  const tiers = [100, 500, 1000];
  for (const value of ["", "750", "0", "-1", "1.5", "nope", "9007199254740992", null]) {
    assert.throws(() => resolvePokerMaxPlayableBuyIn({ POKER_MAX_PLAYABLE_BUY_IN: value }, tiers),
      (error) => error.code === "poker_buy_in_tiers_config_invalid");
  }
  assert.throws(() => resolvePokerMaxPlayableBuyIn({}, [100]), (error) => error.code === "poker_buy_in_tiers_config_invalid");
  assert.throws(() => evaluatePokerProgression({ balance: 1_000_000, tiers, maxPlayableBuyIn: 750 }),
    (error) => error.code === "poker_buy_in_tiers_config_invalid");
});
