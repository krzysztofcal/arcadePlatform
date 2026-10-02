import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  utcHourBucketStart,
  demandRefillIdempotencyKey,
  attemptDemandRefill,
} from "../../shared/poker-domain/demand-refill.mjs";

describe("utcHourBucketStart", () => {
  it("returns ISO string truncated to the hour", () => {
    const result = utcHourBucketStart(new Date("2026-10-01T15:42:33.123Z"));
    assert.equal(result, "2026-10-01T15:00:00.000Z");
  });

  it("handles exact hour boundary", () => {
    const result = utcHourBucketStart(new Date("2026-10-01T00:00:00.000Z"));
    assert.equal(result, "2026-10-01T00:00:00.000Z");
  });

  it("handles end of day", () => {
    const result = utcHourBucketStart(new Date("2026-10-01T23:59:59.999Z"));
    assert.equal(result, "2026-10-01T23:00:00.000Z");
  });

  it("throws on invalid date", () => {
    assert.throws(() => utcHourBucketStart(new Date("invalid")), /invalid_refill_clock/);
  });
});

describe("demandRefillIdempotencyKey", () => {
  it("produces deterministic key for valid inputs", () => {
    const key = demandRefillIdempotencyKey({
      bankrollSystemKey: "POKER_BOT_BANKROLL_100",
      policyRevision: 3,
      bucket: "2026-10-01T15:00:00.000Z",
      fundingDemandId: "bot-seed-buyin:table-abc",
    });
    assert.equal(key, "demand-refill:POKER_BOT_BANKROLL_100:3:2026-10-01T15:00:00.000Z:bot-seed-buyin:table-abc");
  });

  it("rejects missing pool key", () => {
    assert.throws(() => demandRefillIdempotencyKey({
      bankrollSystemKey: "",
      policyRevision: 1,
      bucket: "2026-10-01T15:00:00.000Z",
      fundingDemandId: "test",
    }), /invalid_demand_refill_identity/);
  });

  it("rejects missing fundingDemandId", () => {
    assert.throws(() => demandRefillIdempotencyKey({
      bankrollSystemKey: "POKER_BOT_BANKROLL",
      policyRevision: 1,
      bucket: "2026-10-01T15:00:00.000Z",
      fundingDemandId: "",
    }), /invalid_demand_refill_identity/);
  });

  it("rejects invalid bucket format", () => {
    assert.throws(() => demandRefillIdempotencyKey({
      bankrollSystemKey: "POKER_BOT_BANKROLL",
      policyRevision: 1,
      bucket: "2026-10-01T15:30:00.000Z",
      fundingDemandId: "test",
    }), /invalid_demand_refill_identity/);
  });

  it("distinct demands produce distinct keys", () => {
    const key1 = demandRefillIdempotencyKey({
      bankrollSystemKey: "POKER_BOT_BANKROLL",
      policyRevision: 1,
      bucket: "2026-10-01T15:00:00.000Z",
      fundingDemandId: "demand-A",
    });
    const key2 = demandRefillIdempotencyKey({
      bankrollSystemKey: "POKER_BOT_BANKROLL",
      policyRevision: 1,
      bucket: "2026-10-01T15:00:00.000Z",
      fundingDemandId: "demand-B",
    });
    assert.notEqual(key1, key2);
  });
});

describe("attemptDemandRefill", () => {
  it("rejects without tx", async () => {
    await assert.rejects(
      () => attemptDemandRefill({ postTransactionFn: () => {} }),
      /demand_refill_tx_required/
    );
  });

  it("rejects without postTransactionFn", async () => {
    const fakeTx = { unsafe: async () => [] };
    await assert.rejects(
      () => attemptDemandRefill({ tx: fakeTx, buyIn: 100, poolClass: "NORMAL" }),
      /demand_refill_post_tx_required/
    );
  });

  it("returns invalid_class for bad pool class", async () => {
    const fakeTx = { unsafe: async () => [] };
    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 100,
      poolClass: "INVALID",
      fundingDemandId: "test",
      postTransactionFn: () => {},
    });
    assert.equal(result.status, "invalid_class");
  });

  it("returns invalid_buy_in for non-positive buy-in", async () => {
    const fakeTx = { unsafe: async () => [] };
    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 0,
      poolClass: "NORMAL",
      fundingDemandId: "test",
      postTransactionFn: () => {},
    });
    assert.equal(result.status, "invalid_buy_in");
  });

  it("returns tier_disabled when policy is not enabled", async () => {
    const fakeTx = {
      unsafe: async (query) => {
        if (query.includes("set local")) return [];
        if (query.includes("poker_bot_tier_policy")) return [{
          buy_in: 100, enabled: false,
          normal_refill_threshold_ch: 2000, normal_refill_amount_ch: 5000,
          slow_refill_threshold_ch: 1000, slow_refill_amount_ch: 2000,
          normal_hourly_refill_cap_ch: null, slow_hourly_refill_cap_ch: 2000,
          revision: 1,
        }];
        return [];
      },
    };
    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 100,
      poolClass: "NORMAL",
      fundingDemandId: "test",
      postTransactionFn: () => {},
    });
    assert.equal(result.status, "tier_disabled");
  });

  it("returns no_op when balance is above threshold", async () => {
    let queryIndex = 0;
    const fakeTx = {
      unsafe: async (query) => {
        if (query.includes("set local")) return [];
        if (query.includes("poker_bot_tier_policy")) return [{
          buy_in: 100, enabled: true,
          normal_refill_threshold_ch: 2000, normal_refill_amount_ch: 5000,
          slow_refill_threshold_ch: 1000, slow_refill_amount_ch: 2000,
          normal_hourly_refill_cap_ch: null, slow_hourly_refill_cap_ch: 2000,
          revision: 1,
        }];
        if (query.includes("clock_timestamp")) return [{ now: new Date("2026-10-01T15:30:00Z") }];
        if (query.includes("GENESIS") && query.includes("for update")) return [{ id: 1 }];
        if (query.includes("pg_advisory_xact_lock")) return [];
        if (query.includes("chips_transaction_idempotency")) return [];
        if (query.includes("chips_accounts")) return [{ id: 2, balance: 5000, status: "active" }];
        return [];
      },
    };
    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 100,
      poolClass: "NORMAL",
      fundingDemandId: "test-demand-1",
      postTransactionFn: () => {},
    });
    assert.equal(result.status, "no_op");
    assert.equal(result.poolKey, "POKER_BOT_BANKROLL_100");
  });

  it("returns cap_exhausted when hourly cap is reached", async () => {
    const fakeTx = {
      unsafe: async (query) => {
        if (query.includes("set local")) return [];
        if (query.includes("poker_bot_tier_policy")) return [{
          buy_in: 100, enabled: true,
          normal_refill_threshold_ch: 2000, normal_refill_amount_ch: 5000,
          slow_refill_threshold_ch: 1000, slow_refill_amount_ch: 2000,
          normal_hourly_refill_cap_ch: null, slow_hourly_refill_cap_ch: 2000,
          revision: 1,
        }];
        if (query.includes("clock_timestamp")) return [{ now: new Date("2026-10-01T15:30:00Z") }];
        if (query.includes("GENESIS") && query.includes("for update")) return [{ id: 1 }];
        if (query.includes("pg_advisory_xact_lock")) return [];
        if (query.includes("chips_transaction_idempotency")) return [];
        if (query.includes("chips_accounts")) return [{ id: 2, balance: 500, status: "active" }];
        if (query.includes("coalesce(sum")) return [{ total_refilled: 2000 }]; // already at cap
        return [];
      },
    };
    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 100,
      poolClass: "SLOW",
      fundingDemandId: "test-demand-cap",
      postTransactionFn: () => {},
    });
    assert.equal(result.status, "cap_exhausted");
    assert.equal(result.hourlyCap, 2000);
    assert.equal(result.alreadyRefilledThisHour, 2000);
  });

  it("returns refilled on successful MINT with unlimited cap", async () => {
    let postTransactionCalled = false;
    const fakeTx = {
      unsafe: async (query) => {
        if (query.includes("set local")) return [];
        if (query.includes("poker_bot_tier_policy")) return [{
          buy_in: 100, enabled: true,
          normal_refill_threshold_ch: 2000, normal_refill_amount_ch: 5000,
          slow_refill_threshold_ch: 1000, slow_refill_amount_ch: 2000,
          normal_hourly_refill_cap_ch: null, slow_hourly_refill_cap_ch: 2000,
          revision: 1,
        }];
        if (query.includes("clock_timestamp")) return [{ now: new Date("2026-10-01T15:30:00Z") }];
        if (query.includes("GENESIS") && query.includes("for update")) return [{ id: 1 }];
        if (query.includes("pg_advisory_xact_lock")) return [];
        if (query.includes("chips_transaction_idempotency")) return [];
        if (query.includes("chips_accounts")) return [{ id: 2, balance: 500, status: "active" }];
        return [];
      },
    };

    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 100,
      poolClass: "NORMAL",
      fundingDemandId: "test-demand-mint",
      postTransactionFn: async (opts) => {
        postTransactionCalled = true;
        assert.equal(opts.txType, "MINT");
        assert.equal(opts.trustedScheduledRefill, true);
        assert.equal(opts.metadata.purpose, "poker_pool_refill");
        assert.equal(opts.metadata.trigger, "demand");
        assert.equal(opts.metadata.bankrollSystemKey, "POKER_BOT_BANKROLL_100");
        assert.equal(opts.metadata.buyIn, 100);
        assert.equal(opts.metadata.poolClass, "NORMAL");
        assert.equal(opts.entries.length, 2);
        assert.equal(opts.entries[0].systemKey, "GENESIS");
        assert.equal(opts.entries[0].amount, -5000);
        assert.equal(opts.entries[1].systemKey, "POKER_BOT_BANKROLL_100");
        assert.equal(opts.entries[1].amount, 5000);
        return { transaction: { id: 99 } };
      },
    });

    assert.equal(result.status, "refilled");
    assert.equal(result.poolKey, "POKER_BOT_BANKROLL_100");
    assert.equal(result.amount, 5000);
    assert.equal(postTransactionCalled, true);
  });

  it("limits refill amount to remaining hourly allowance", async () => {
    let mintAmount = 0;
    const fakeTx = {
      unsafe: async (query) => {
        if (query.includes("set local")) return [];
        if (query.includes("poker_bot_tier_policy")) return [{
          buy_in: 100, enabled: true,
          normal_refill_threshold_ch: 2000, normal_refill_amount_ch: 5000,
          slow_refill_threshold_ch: 1000, slow_refill_amount_ch: 2000,
          normal_hourly_refill_cap_ch: null, slow_hourly_refill_cap_ch: 2000,
          revision: 1,
        }];
        if (query.includes("clock_timestamp")) return [{ now: new Date("2026-10-01T15:30:00Z") }];
        if (query.includes("GENESIS") && query.includes("for update")) return [{ id: 1 }];
        if (query.includes("pg_advisory_xact_lock")) return [];
        if (query.includes("chips_transaction_idempotency")) return [];
        if (query.includes("chips_accounts")) return [{ id: 2, balance: 500, status: "active" }];
        if (query.includes("coalesce(sum")) return [{ total_refilled: 1500 }]; // 500 remaining of 2000 cap
        return [];
      },
    };

    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 100,
      poolClass: "SLOW",
      fundingDemandId: "test-partial",
      postTransactionFn: async (opts) => {
        mintAmount = opts.entries[1].amount;
        return { transaction: { id: 100 } };
      },
    });

    assert.equal(result.status, "refilled");
    assert.equal(mintAmount, 500); // min(2000 chunk, 500 remaining)
    assert.equal(result.amount, 500);
  });

  it("replay returns without double-MINT", async () => {
    const fakeTx = {
      unsafe: async (query) => {
        if (query.includes("set local")) return [];
        if (query.includes("poker_bot_tier_policy")) return [{
          buy_in: 100, enabled: true,
          normal_refill_threshold_ch: 2000, normal_refill_amount_ch: 5000,
          slow_refill_threshold_ch: 1000, slow_refill_amount_ch: 2000,
          normal_hourly_refill_cap_ch: null, slow_hourly_refill_cap_ch: 2000,
          revision: 1,
        }];
        if (query.includes("clock_timestamp")) return [{ now: new Date("2026-10-01T15:30:00Z") }];
        if (query.includes("GENESIS") && query.includes("for update")) return [{ id: 1 }];
        if (query.includes("pg_advisory_xact_lock")) return [];
        if (query.includes("chips_transaction_idempotency")) return [{ id: 42 }]; // already exists
        return [];
      },
    };

    const result = await attemptDemandRefill({
      tx: fakeTx,
      buyIn: 100,
      poolClass: "NORMAL",
      fundingDemandId: "test-replay",
      postTransactionFn: async () => { throw new Error("should not be called"); },
    });

    assert.equal(result.status, "replay");
  });
});
