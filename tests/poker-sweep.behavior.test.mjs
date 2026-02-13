import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const userId = "user-2";
const seatNo = 3;

let lockIdx = -1;
let updIdx = -1;

const makeHandler = (postCalls, queries, klogEvents, options = {}) => {
  const {
    deleteHoleCardsError,
    expiredSeats = [{ table_id: tableId, user_id: userId, seat_no: seatNo, stack: 100, last_seen_at: new Date(0) }],
    closeCashoutTables = [],
    closeCashoutSeats = [],
    singletonClosedTables = [],
    closedTables = [tableId],
    postSettlementCalls = [],
  } = options;
  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    beginSql: async (fn) => {
      return fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) {
            return expiredSeats;
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            lockIdx = queries.length - 1;
            return [
              {
                seat_no: seatNo,
                status: "ACTIVE",
                stack: 100,
                last_seen_at: new Date(Date.now() - 60 * 60 * 1000),
              },
            ];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) {
            return closeCashoutTables.map((id) => ({ id }));
          }
          if (text.includes("select seat_no, status, stack, user_id")) {
            return closeCashoutSeats;
          }
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0")) {
            updIdx = queries.length - 1;
          }
          if (text.includes("with singleton_tables as")) {
            return singletonClosedTables.map((id) => ({ id }));
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) {
            return [];
          }
          if (text.includes("update public.poker_tables t")) {
            return closedTables.map((id) => ({ id }));
          }
          if (text.includes("delete from public.poker_hole_cards")) {
            if (deleteHoleCardsError) throw deleteHoleCardsError;
          }
          return [];
        },
      });
    },
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-sweep" } };
    },
    postHandSettlementToLedger: async (payload) => {
      postSettlementCalls.push(payload);
      const payouts = payload?.handSettlement?.payouts || {};
      for (const [uid, amt] of Object.entries(payouts)) {
        if (Number(amt) > 0) {
          await payload.postTransaction({
            userId: uid,
            txType: "HAND_SETTLEMENT",
            idempotencyKey: `poker:settlement:${payload.tableId}:${payload.handSettlement.handId}:${uid}`,
            entries: [
              { accountType: "ESCROW", systemKey: `POKER_TABLE:${payload.tableId}`, amount: -Number(amt) },
              { accountType: "USER", amount: Number(amt) },
            ],
          });
        }
      }
      return { count: 1, total: 0 };
    },
    klog: (event, payload) => {
      klogEvents.push({ event, payload });
    },
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
  });
  return handler;
};

const run = async () => {
  lockIdx = -1;
  updIdx = -1;
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents);
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 1);
  const call = postCalls[0];
  assert.equal(call.txType, "TABLE_CASH_OUT");
  assert.equal(call.idempotencyKey, `poker:timeout_cashout:${tableId}:${userId}:${seatNo}:v1`);
  assert.deepEqual(call.entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -100 },
    { accountType: "USER", amount: 100 },
  ]);
  assert.ok(
    queries.some(
      (q) =>
        q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0") &&
        q.params?.[0] === tableId &&
        q.params?.[1] === userId
    ),
    "sweep should inactivate seat and zero stack for the timed-out user"
  );
  assert.ok(lockIdx >= 0, "sweep should lock seat before updating");
  assert.ok(updIdx > lockIdx, "sweep should update seat after lock");
  assert.ok(
    queries.some(
      (q) =>
        q.query.toLowerCase().includes("delete from public.poker_hole_cards") &&
        q.params?.[0]?.includes?.(tableId)
    ),
    "sweep should delete hole cards for closed tables"
  );
};

const runMissingHoleCardsTable = async () => {
  lockIdx = -1;
  updIdx = -1;
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const missingError = new Error("relation \"public.poker_hole_cards\" does not exist");
  missingError.code = "42P01";
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, { deleteHoleCardsError: missingError });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
};

const runCloseCashoutInvalidStack = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, {
    expiredSeats: [],
    closeCashoutTables: [tableId],
    closeCashoutSeats: [{ seat_no: seatNo, status: "INACTIVE", stack: "nope", user_id: userId }],
    closedTables: [],
  });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 0);
  assert.ok(
    queries.some((q) => q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0")),
    "sweep should still clear seats when stack is missing/invalid"
  );
  assert.ok(
    klogEvents.some((entry) => entry.event === "poker_close_cashout_skip" && entry.payload?.stackSource === "none"),
    "sweep should log skipped close cashout with stack source"
  );
};

const runCloseCashoutSkipsActiveSeat = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, {
    expiredSeats: [],
    closeCashoutTables: [tableId],
    closeCashoutSeats: [{ seat_no: seatNo, status: "ACTIVE", stack: 55, user_id: userId }],
    closedTables: [],
  });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 0);
  assert.ok(
    !queries.some((q) => q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0")),
    "sweep should not clear stacks for active close-cashout seats"
  );
  assert.ok(
    klogEvents.some((entry) => entry.event === "poker_close_cashout_skip_active_seat"),
    "sweep should log active seat skips"
  );
};

const runCloseCashoutUsesSeatNo = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, {
    expiredSeats: [],
    closeCashoutTables: [tableId],
    closeCashoutSeats: [{ seat_no: seatNo, status: "INACTIVE", stack: 55, user_id: userId }],
    closedTables: [],
  });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].idempotencyKey, `poker:close_cashout:${tableId}:${userId}:${seatNo}:v1`);
  assert.ok(
    queries.some(
      (q) =>
        q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0") &&
        q.query.toLowerCase().includes("seat_no") &&
        q.params?.[0] === tableId &&
        q.params?.[1] === seatNo
    ),
    "sweep should update close cashout seats by table_id + seat_no"
  );
};


const runSingletonCloseFeedsSameRunCloseCashout = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, {
    expiredSeats: [],
    singletonClosedTables: [tableId],
    closeCashoutTables: [tableId],
    closeCashoutSeats: [{ seat_no: seatNo, status: "INACTIVE", stack: 55, user_id: userId }],
    closedTables: [],
  });

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  const singletonUpdate = queries.find(
    (q) => q.query.toLowerCase().includes("with singleton_tables as") && q.query.toLowerCase().includes("having count(*) = 1")
  );
  assert.ok(singletonUpdate, "sweep should run singleton-close update");
  assert.deepEqual(singletonUpdate.params, [21600, 25], "singleton-close should use TABLE_SINGLETON_CLOSE_SEC and batch limit");
  const singletonSeatInactivation = queries.find(
    (q) => q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive' where table_id = any")
  );
  assert.ok(singletonSeatInactivation, "sweep should inactivate ACTIVE seats for singleton-closed tables");
  assert.deepEqual(singletonSeatInactivation.params, [[tableId]], "singleton seat inactivation should target singleton-closed table ids");
  const closeCashoutSelect = queries.find(
    (q) =>
      q.query.toLowerCase().includes("select t.id") &&
      q.query.toLowerCase().includes("not exists") &&
      q.query.toLowerCase().includes("stack > 0")
  );
  assert.ok(closeCashoutSelect, "sweep should select no-active-seat tables for close-cashout after singleton close");
  assert.equal(postCalls.length, 1, "singleton-closed table should be cashout-processed in same sweep run");
  assert.equal(postCalls[0].idempotencyKey, `poker:close_cashout:${tableId}:${userId}:${seatNo}:v1`);
  assert.ok(
    queries.some(
      (q) => q.query.toLowerCase().includes("delete from public.poker_hole_cards") && q.params?.[0]?.includes?.(tableId)
    ),
    "sweep should delete hole cards for singleton-closed tables"
  );
};


const runSettlementSkipsLegacyCashout = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const postSettlementCalls = [];
  const settledState = {
    phase: "SETTLED",
    handSettlement: {
      handId: "h-settled",
      settledAt: "2026-01-01T00:00:00.000Z",
      payouts: { [userId]: 77 },
    },
    stacks: { [userId]: 77 },
  };
  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            return [{ table_id: tableId, user_id: userId, seat_no: seatNo, stack: 123, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            return [{ seat_no: seatNo, status: "ACTIVE", stack: 123, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_state where table_id") && text.includes("for update")) {
            return [{ state: JSON.stringify(settledState) }];
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-sweep" } };
    },
    postHandSettlementToLedger: async (payload) => {
      postSettlementCalls.push(payload);
      return { count: 1, total: 77 };
    },
    klog: (event, payload) => {
      klogEvents.push({ event, payload });
    },
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
  });

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(postSettlementCalls.length, 2, "sweep should attempt settlement posting on retries");
  assert.equal(
    postCalls.filter((c) => c.txType === "TABLE_CASH_OUT").length,
    0,
    "sweep should skip legacy TABLE_CASH_OUT path when settlement exists"
  );
};


const runInvalidSettlementFallsBackLegacyCashout = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            return [{ table_id: tableId, user_id: userId, seat_no: seatNo, stack: 99, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            return [{ seat_no: seatNo, status: "ACTIVE", stack: 99, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_state where table_id") && text.includes("for update")) {
            return [{ version: 7, state: JSON.stringify({ handSettlement: { handId: "bad-no-payouts" }, stacks: { [userId]: 88 } }) }];
          }
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0")) return [];
          if (text.includes("update public.poker_state set state")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-fallback" } };
    },
    postHandSettlementToLedger: async () => {
      throw new Error("should_not_be_called_for_invalid_settlement");
    },
    klog: () => {},
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
  });

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].txType, "TABLE_CASH_OUT");
  assert.equal(postCalls[0].metadata?.stackSource, "state");
};

const runSettlementPostFailureKeepsSeatActiveForRetry = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            return [{ table_id: tableId, user_id: userId, seat_no: seatNo, stack: 100, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            return [{ seat_no: seatNo, status: "ACTIVE", stack: 100, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_state where table_id") && text.includes("for update")) {
            return [{ version: 7, state: JSON.stringify({ handSettlement: { handId: "h-boom", payouts: { [userId]: 50 } }, stacks: { [userId]: 100 } }) }];
          }
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-no-legacy" } };
    },
    postHandSettlementToLedger: async () => {
      throw new Error("boom");
    },
    klog: (event, payload) => {
      klogEvents.push({ event, payload });
    },
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
  });

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.ok(
    !queries.some((q) => q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0")),
    "sweep should keep seat active when settlement post fails so retry can happen"
  );
  assert.equal(
    postCalls.filter((c) => c.txType === "TABLE_CASH_OUT").length,
    0,
    "sweep should still skip legacy cashout when usable settlement exists"
  );
  assert.ok(
    klogEvents.some((entry) => entry.event === "poker_settlement_ledger_post_failed" && entry.payload?.handId === "h-boom" && entry.payload?.source === "timeout_cashout"),
    "sweep should log settlement posting failure with timeout source"
  );
};


Promise.resolve()
  .then(run)
  .then(runMissingHoleCardsTable)
  .then(runCloseCashoutInvalidStack)
  .then(runCloseCashoutSkipsActiveSeat)
  .then(runCloseCashoutUsesSeatNo)
  .then(runSingletonCloseFeedsSameRunCloseCashout)
  .then(runSettlementSkipsLegacyCashout)
  .then(runInvalidSettlementFallsBackLegacyCashout)
  .then(runSettlementPostFailureKeepsSeatActiveForRetry)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
