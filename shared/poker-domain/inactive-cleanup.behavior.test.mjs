import test from "node:test";
import assert from "node:assert/strict";
import { executeInactiveCleanup } from "./inactive-cleanup.mjs";

function createCleanupHarness({ seatRows, state, tableStatus = "OPEN" }) {
  const seatState = seatRows.map((row) => ({ ...row }));
  const tableState = {
    stateRow: { state: { ...state } },
    tableStatus
  };
  const cashouts = [];

  const tx = {
    unsafe: async (sql, params = []) => {
      if (sql.includes("where table_id = $1 and user_id = $2 limit 1 for update")) {
        const [, userId] = params;
        const seat = seatState.find((row) => row.user_id === userId) || null;
        return seat ? [{ ...seat }] : [];
      }
      if (sql.includes("select state from public.poker_state")) {
        return [{ state: { ...tableState.stateRow.state } }];
      }
      if (sql.includes("update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and user_id = $2")) {
        const [, userId] = params;
        for (let i = 0; i < seatState.length; i += 1) {
          if (seatState[i].user_id === userId) {
            seatState[i] = { ...seatState[i], status: "INACTIVE", stack: 0 };
          }
        }
        return [];
      }
      if (sql.includes("select user_id, status, is_bot, stack from public.poker_seats")) {
        return seatState.map((row) => ({ ...row }));
      }
      if (sql.includes("update public.poker_state set state = $2 where table_id = $1")) {
        tableState.stateRow = { state: JSON.parse(params[1]) };
        return [];
      }
      if (sql.includes("select status from public.poker_tables")) {
        return [{ status: tableState.tableStatus }];
      }
      if (sql.includes("update public.poker_tables set status = 'CLOSED'")) {
        tableState.tableStatus = "CLOSED";
        return [];
      }
      if (sql.includes("delete from public.poker_hole_cards")) {
        return [];
      }
      if (sql.includes("update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and is_bot = false")) {
        for (let i = 0; i < seatState.length; i += 1) {
          if (seatState[i].is_bot !== true) {
            seatState[i] = { ...seatState[i], status: "INACTIVE", stack: 0 };
          }
        }
        return [];
      }
      throw new Error(`Unhandled SQL in test harness: ${sql}`);
    }
  };

  return {
    seatState,
    tableState,
    cashouts,
    run: () => executeInactiveCleanup({
      beginSql: async (fn) => fn(tx),
      tableId: "table_1",
      userId: "human_1",
      requestId: "req-1",
      postTransaction: async (entry) => {
        cashouts.push(entry);
        return { ok: true };
      }
    })
  };
}

test("inactive cleanup preserves valid bot turn holder", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "human_1", status: "ACTIVE", is_bot: false, stack: 500 },
      { user_id: "human_2", status: "ACTIVE", is_bot: false, stack: 600 },
      { user_id: "bot_1", status: "ACTIVE", is_bot: true, stack: 400 }
    ],
    state: {
      turnUserId: "bot_1",
      stacks: { human_1: 500, human_2: 600, bot_1: 400 }
    }
  });

  const result = await harness.run();

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(harness.seatState.find((row) => row.user_id === "human_1")?.status, "INACTIVE");
  assert.equal(harness.seatState.find((row) => row.user_id === "human_2")?.status, "ACTIVE");
  assert.equal(harness.seatState.find((row) => row.user_id === "bot_1")?.status, "ACTIVE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, "bot_1");
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { human_2: 600, bot_1: 400 });
});

test("inactive cleanup clears removed disconnected turn holder", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "human_1", status: "ACTIVE", is_bot: false, stack: 500 }
    ],
    state: {
      turnUserId: "human_1",
      stacks: { human_1: 500 }
    }
  });

  const result = await harness.run();

  assert.equal(result.ok, true);
  assert.equal(harness.tableState.stateRow.state.turnUserId, null);
  assert.deepEqual(harness.tableState.stateRow.state.stacks, {});
});
