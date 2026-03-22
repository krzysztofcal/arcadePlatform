import test from "node:test";
import assert from "node:assert/strict";
import { isStateStorageValid } from "../snapshot-runtime/poker-state-utils.mjs";
import { createAuthoritativeJoinExecutor } from "./authoritative-join-adapter.mjs";

const validateStateForStorage = (state) =>
  isStateStorageValid(state, { requireNoDeck: true, requireHandSeed: false, requireCommunityDealt: false });

function makeSuccessSnapshot({ userId = "u1", seatNo = 2, stack = 100, seededBots = [], stateVersion = 1 } = {}) {
  return {
    stateVersion,
    seats: [{ userId, seatNo, status: "ACTIVE" }, ...seededBots.map((bot) => ({ userId: bot.userId, seatNo: bot.seatNo, status: "ACTIVE", isBot: true }))],
    stacks: Object.fromEntries([[userId, stack], ...seededBots.map((bot) => [bot.userId, bot.stack])])
  };
}

const lockedStateHelpers = async () => ({
  loadStateForUpdate: async () => ({ ok: true, version: 0, state: {} }),
  updateStateLocked: async () => ({ ok: true, newVersion: 1 }),
  validateStateForStorage
});

test("authoritative join adapter returns unavailable when join core is missing", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({})
  });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" });
  assert.deepEqual(result, { ok: false, code: "temporarily_unavailable" });
});

test("authoritative join adapter maps unknown thrown errors", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => {
        throw new Error("boom");
      }
    })
  });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" });
  assert.deepEqual(result, { ok: false, code: "authoritative_join_failed" });
});

test("authoritative join adapter returns unavailable when locked-state validator helper is missing", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    loadLockedStateHelpersFn: async () => ({
      loadStateForUpdate: async () => ({ ok: true, version: 0, state: {} }),
      updateStateLocked: async () => ({ ok: true, newVersion: 1 })
    }),
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({ ok: true, seatNo: 2, rejoin: false, stack: 100 })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r-missing-validator" });
  assert.deepEqual(result, { ok: false, code: "temporarily_unavailable" });
});

test("authoritative join adapter forwards only shared-core supported args", async () => {
  let captured = null;
  const execute = createAuthoritativeJoinExecutor({
    env: { WS_DEFAULT_BUYIN: "25" },
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async (args) => {
        captured = args;
        return { ok: true, seatNo: 2, rejoin: false, stack: 100, snapshot: makeSuccessSnapshot() };
      }
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" });
  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 2);
  assert.equal(result.rejoin, false);
  assert.equal(result.stack, 100);
  assert.deepEqual(Object.keys(captured || {}).sort(), ["beginSql", "klog", "loadStateForUpdate", "postTransactionFn", "requestId", "tableId", "updateStateLocked", "userId", "validateStateForStorage"]);
  assert.equal(captured.validateStateForStorage, validateStateForStorage);
  assert.equal(Object.hasOwn(captured, "buyIn"), false);
  assert.equal(Object.hasOwn(captured, "autoSeat"), false);
  assert.equal(Object.hasOwn(captured, "preferredSeatNo"), false);
  assert.equal(Object.hasOwn(captured, "seatNo"), false);
  assert.equal(Object.hasOwn(captured, "env"), false);
});



test("authoritative join adapter accepts complete authoritative snapshot without live members projection", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({
        ok: true,
        seatNo: 1,
        rejoin: false,
        stack: 200,
        seededBots: [
          { userId: "bot_2", seatNo: 2, stack: 200 },
          { userId: "bot_3", seatNo: 3, stack: 200 }
        ],
        snapshot: {
          ...makeSuccessSnapshot({
            userId: "u1",
            seatNo: 1,
            stack: 200,
            seededBots: [
              { userId: "bot_2", seatNo: 2, stack: 200 },
              { userId: "bot_3", seatNo: 3, stack: 200 }
            ]
          }),
          members: []
        }
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r-complete" });
  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 1);
  assert.equal(result.stack, 200);
});

test("authoritative join adapter preserves explicit rejoin semantics", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({ ok: true, seatNo: 3, rejoin: true, stack: 120, snapshot: makeSuccessSnapshot({ seatNo: 3, stack: 120 }) })
    })
  });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r2" });
  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 3);
  assert.equal(result.rejoin, true);
  assert.equal(result.stack, 120);
});


test("authoritative join adapter rejects malformed success payload", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({ ok: true, seatNo: 2, rejoin: false, stack: 0 })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r3", buyIn: 100 });
  assert.deepEqual(result, { ok: false, code: "authoritative_state_invalid" });
});

test("authoritative join adapter rejects partial human-only success snapshot", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({
        ok: true,
        seatNo: 1,
        rejoin: false,
        stack: 100,
        seededBots: [
          { userId: "bot_2", seatNo: 2, stack: 200 },
          { userId: "bot_3", seatNo: 3, stack: 200 }
        ],
        snapshot: {
          stateVersion: 0,
          seats: [{ userId: "u1", seatNo: 1, status: "ACTIVE" }],
          stacks: { u1: 100 }
        }
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r-partial" });
  assert.deepEqual(result, { ok: false, code: "authoritative_state_invalid" });
});

test("authoritative join adapter rejects successful fresh-join snapshot when stateVersion stays at 0", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({
        ok: true,
        seatNo: 1,
        rejoin: false,
        stack: 150,
        snapshot: makeSuccessSnapshot({ userId: "u1", seatNo: 1, stack: 150, stateVersion: 0 })
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r-version-zero" });
  assert.deepEqual(result, { ok: false, code: "authoritative_state_invalid" });
});

test("authoritative join adapter accepts successful fresh-join snapshot once stateVersion moves positive", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({
        ok: true,
        seatNo: 1,
        rejoin: false,
        stack: 150,
        seededBots: [
          { userId: "bot_2", seatNo: 2, stack: 200 },
          { userId: "bot_3", seatNo: 3, stack: 200 }
        ],
        snapshot: makeSuccessSnapshot({
          userId: "u1",
          seatNo: 1,
          stack: 150,
          stateVersion: 1,
          seededBots: [
            { userId: "bot_2", seatNo: 2, stack: 200 },
            { userId: "bot_3", seatNo: 3, stack: 200 }
          ]
        })
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r-version-one" });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.stateVersion, 1);
});


test("authoritative join adapter surfaces financial mutation failure codes", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => {
        const err = new Error("insufficient_funds");
        err.code = "insufficient_funds";
        throw err;
      }
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r4", buyIn: 100 });
  assert.deepEqual(result, { ok: false, code: "insufficient_funds" });
});

test("authoritative join adapter returns unavailable when postTransaction loader fails", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => {
      throw new Error("missing_post_transaction");
    },
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({ ok: true, seatNo: 2, rejoin: false, stack: 100 })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r5", buyIn: 100 });
  assert.deepEqual(result, { ok: false, code: "temporarily_unavailable" });
});


test("authoritative join adapter preserves poker_state_missing as protocol-safe known code", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => {
        const err = new Error("poker_state_missing");
        err.code = "poker_state_missing";
        throw err;
      }
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r6", buyIn: 100 });
  assert.deepEqual(result, { ok: false, code: "poker_state_missing" });
});


test("authoritative join adapter preserves seat_taken as protocol-safe known code", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => async () => ({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => {
        const err = new Error("seat_taken");
        err.code = "seat_taken";
        throw err;
      }
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r7", buyIn: 100 });
  assert.deepEqual(result, { ok: false, code: "seat_taken" });
});


test("authoritative join adapter uses file-store ledger fallback and preserves classified errors", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: { WS_PERSISTED_STATE_FILE: "/tmp/ws-persist.json" },
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => {
      throw new Error("missing_post_transaction");
    },
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => {
        const err = new Error("poker_state_missing");
        err.code = "poker_state_missing";
        throw err;
      }
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r8", buyIn: 100 });
  assert.deepEqual(result, { ok: false, code: "poker_state_missing" });
});

test("authoritative join adapter keeps runtime unavailable when not in file-store fallback mode", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: { SUPABASE_DB_URL: "postgres://example" },
    klog: () => {},
    loadLockedStateHelpersFn: lockedStateHelpers,
    loadPostTransactionFn: async () => {
      throw new Error("missing_post_transaction");
    },
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({ ok: true, seatNo: 2, rejoin: false, stack: 100 })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r9", buyIn: 100 });
  assert.deepEqual(result, { ok: false, code: "temporarily_unavailable" });
});
