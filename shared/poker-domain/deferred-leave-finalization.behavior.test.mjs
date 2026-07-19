import test from "node:test";
import assert from "node:assert/strict";
import { finalizeDeferredLeavesAfterSettlement } from "./leave.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const leaverId = "22222222-2222-4222-8222-222222222222";
const activeId = "33333333-3333-4333-8333-333333333333";

function createFixture({ withActiveHuman }) {
  let version = 7;
  let state = {
    tableId,
    phase: "HAND_DONE",
    handId: "",
    seats: [
      { userId: leaverId, seatNo: 1 },
      ...(withActiveHuman ? [{ userId: activeId, seatNo: 2 }] : []),
    ],
    stacks: {
      [leaverId]: 25,
      ...(withActiveHuman ? { [activeId]: 75 } : {}),
    },
    leftTableByUserId: { [leaverId]: true },
  };
  let seats = [
    { user_id: leaverId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 25 },
    ...(withActiveHuman ? [{ user_id: activeId, seat_no: 2, status: "ACTIVE", is_bot: false, stack: 75 }] : []),
  ];
  const cashouts = [];
  const tx = {
    unsafe: async (query, params) => {
      const sql = String(query).toLowerCase();
      if (sql.includes("select id, status from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
      if (sql.includes("select version, state from public.poker_state") && sql.includes("for update")) return [{ version, state }];
      if (sql.includes("select user_id, seat_no, status, is_bot, stack from public.poker_seats")) return seats;
      if (sql.includes("update public.poker_state set version = version + 1")) {
        assert.equal(params[1], version);
        state = JSON.parse(params[2]);
        version += 1;
        return [{ version }];
      }
      if (sql.includes("delete from public.poker_seats")) {
        const removed = new Set(params[1]);
        seats = seats.filter((seat) => !removed.has(seat.user_id));
        return [];
      }
      if (sql.includes("update public.poker_tables set last_activity_at")) return [];
      throw new Error(`unexpected_sql:${query}`);
    },
  };
  return {
    beginSql: async (fn) => fn(tx),
    postTransactionFn: async (input) => {
      cashouts.push(input);
      return { transaction: { id: "cashout-1" } };
    },
    cashouts,
    getState: () => state,
    getSeats: () => seats,
  };
}

test("finalizes a deferred human leave before rollover when another human remains", async () => {
  const fixture = createFixture({ withActiveHuman: true });
  const result = await finalizeDeferredLeavesAfterSettlement({
    beginSql: fixture.beginSql,
    tableId,
    postTransactionFn: fixture.postTransactionFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "deferred_leaves_finalized");
  assert.equal(result.closed, false);
  assert.equal(fixture.cashouts.length, 1);
  assert.equal(fixture.cashouts[0].entries[0].amount, -25);
  assert.deepEqual(fixture.getSeats().map((seat) => seat.user_id), [activeId]);
  assert.deepEqual(fixture.getState().seats.map((seat) => seat.userId), [activeId]);
  assert.equal(Object.hasOwn(fixture.getState().stacks, leaverId), false);
});

test("delegates the last deferred human to existing terminal close", async () => {
  const fixture = createFixture({ withActiveHuman: false });
  let terminalCalls = 0;
  const result = await finalizeDeferredLeavesAfterSettlement({
    beginSql: fixture.beginSql,
    tableId,
    postTransactionFn: fixture.postTransactionFn,
    executeTerminalClose: async ({ postTransaction, closeReason }) => {
      terminalCalls += 1;
      assert.equal(postTransaction, fixture.postTransactionFn);
      assert.equal(closeReason, "WS_DEFERRED_LEAVE_TABLE_CLOSE");
      return { ok: true, changed: true, closed: true, status: "deferred_leave_closed" };
    },
  });

  assert.equal(result.closed, true);
  assert.equal(terminalCalls, 1);
  assert.equal(fixture.cashouts.length, 0);
});
