import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateUnlockBankroll,
  evaluatePokerProgression,
  readPokerBankroll,
  resolvePokerBuyInTiers
} from "./poker-progression.mjs";

test("progression resolves the default catalog and unlocks only the highest tier plus one fallback", () => {
  const tiers = resolvePokerBuyInTiers({});
  assert.equal(tiers[0], 100);
  assert.equal(tiers.at(-1), 10_000_000);
  assert.deepEqual(evaluatePokerProgression({ balance: 550, tiers }).availableBuyIns, [500, 100]);
  assert.equal(calculateUnlockBankroll(500), 550);
});

test("progression accepts a sorted deduplicated configured catalog and rejects invalid configuration", () => {
  assert.deepEqual(resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[500, 100, 500]" }), [100, 500]);
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[100, 1.5]" }),
    (error) => error?.code === "poker_buy_in_tiers_config_invalid"
  );
  assert.throws(
    () => resolvePokerBuyInTiers({ POKER_BUY_IN_TIERS_JSON: "[]" }),
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
