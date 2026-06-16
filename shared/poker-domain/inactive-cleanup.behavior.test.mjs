import test from "node:test";
import assert from "node:assert/strict";
import { executeInactiveCleanup } from "./inactive-cleanup.mjs";

function createCleanupHarness({
  seatRows,
  state,
  tableStatus = "OPEN",
  createdAt = "2026-03-01T00:00:00.000Z",
  lastActivityAt = null,
  updatedAt = null,
  nowMs = Date.parse("2026-03-01T00:02:00.000Z")
}) {
  const seatState = seatRows.map((row) => ({ ...row }));
  const tableState = {
    stateRow: { state: { ...state } },
    tableStatus,
    createdAt,
    lastActivityAt,
    updatedAt
  };
  const cashouts = [];
  const originalDateNow = Date.now;

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
      if (sql.includes("select user_id, seat_no, status, is_bot, stack from public.poker_seats")) {
        return seatState.map((row) => ({ ...row }));
      }
      if (sql.includes("update public.poker_state set state = $2 where table_id = $1")) {
        tableState.stateRow = { state: JSON.parse(params[1]) };
        return [];
      }
      if (sql.includes("select status, created_at") && sql.includes("from public.poker_tables")) {
        return [{
          status: tableState.tableStatus,
          created_at: tableState.createdAt,
          last_activity_at: tableState.lastActivityAt,
          updated_at: tableState.updatedAt
        }];
      }
      if (sql.includes("update public.poker_tables set status = 'CLOSED'")) {
        tableState.tableStatus = "CLOSED";
        return [];
      }
      if (sql.includes("delete from public.poker_hole_cards")) {
        return [];
      }
      if (sql.includes("update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1;")) {
        for (let i = 0; i < seatState.length; i += 1) {
          seatState[i] = { ...seatState[i], status: "INACTIVE", stack: 0 };
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
    run: async () => {
      Date.now = () => nowMs;
      try {
        return await executeInactiveCleanup({
          beginSql: async (fn) => fn(tx),
          tableId: "table_1",
          userId: "human_1",
          requestId: "req-1",
          postTransaction: async (entry) => {
            cashouts.push(entry);
            return { ok: true };
          }
        });
      } finally {
        Date.now = originalDateNow;
      }
    },
    runSystemSweep: async () => {
      Date.now = () => nowMs;
      try {
        return await executeInactiveCleanup({
          beginSql: async (fn) => fn(tx),
          tableId: "table_1",
          userId: null,
          requestId: "req-system-sweep",
          postTransaction: async (entry) => {
            cashouts.push(entry);
            return { ok: true };
          }
        });
      } finally {
        Date.now = originalDateNow;
      }
    }
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

test("inactive cleanup preserves replacement bot turn holder when seat rows still reference prior bot id", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 250 },
      { user_id: "bot_old_2", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 1 },
      { user_id: "bot_keep_3", seat_no: 3, status: "ACTIVE", is_bot: true, stack: 170 }
    ],
    state: {
      phase: "TURN",
      turnUserId: "bot_auto_2_38",
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot_auto_2_38", seatNo: 2, status: "ACTIVE" },
        { userId: "bot_keep_3", seatNo: 3, status: "ACTIVE" }
      ],
      stacks: { human_1: 250, bot_auto_2_38: 100, bot_keep_3: 170 }
    },
    lastActivityAt: "2026-03-01T00:01:55.000Z"
  });

  const result = await harness.run();

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.deferred, true);
  assert.equal(result.status, "cleaned_live_hand_preserved");
  assert.equal(harness.cashouts.length, 0);
  assert.equal(harness.seatState.find((row) => row.user_id === "human_1")?.status, "ACTIVE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, "bot_auto_2_38");
  assert.deepEqual(harness.tableState.stateRow.state.stacks, {
    human_1: 250,
    bot_auto_2_38: 100,
    bot_keep_3: 170
  });
});

test("inactive cleanup preserves fresh live hand without mutating disconnected active human", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 250 },
      { user_id: "human_2", seat_no: 2, status: "ACTIVE", is_bot: false, stack: 300 },
      { user_id: "bot_1", seat_no: 3, status: "ACTIVE", is_bot: true, stack: 170 }
    ],
    state: {
      phase: "RIVER",
      handId: "h-live-preserve",
      turnUserId: "human_2",
      turnDeadlineAt: Date.parse("2026-03-01T00:02:10.000Z"),
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "human_2", seatNo: 2, status: "ACTIVE" },
        { userId: "bot_1", seatNo: 3, status: "ACTIVE" }
      ],
      stacks: { human_1: 250, human_2: 300, bot_1: 170 }
    },
    lastActivityAt: "2026-03-01T00:01:55.000Z"
  });

  const result = await harness.run();

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.deferred, true);
  assert.equal(result.status, "cleaned_live_hand_preserved");
  assert.equal(harness.cashouts.length, 0);
  assert.equal(harness.seatState.find((row) => row.user_id === "human_1")?.status, "ACTIVE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, "human_2");
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { human_1: 250, human_2: 300, bot_1: 170 });
});

test("inactive cleanup preserves fresh bots-only live hand for disconnected human when activity is recent", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 250 },
      { user_id: "bot_1", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 170 }
    ],
    state: {
      phase: "PREFLOP",
      handId: "h-fresh-bots-only-disconnect",
      turnUserId: "bot_1",
      turnDeadlineAt: null,
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot_1", seatNo: 2, status: "ACTIVE" }
      ],
      stacks: { human_1: 250, bot_1: 170 }
    },
    lastActivityAt: "2026-03-01T00:01:55.000Z"
  });

  const result = await harness.run();

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.closed, false);
  assert.equal(result.deferred, true);
  assert.equal(result.status, "cleaned_live_hand_preserved");
  assert.equal(harness.cashouts.length, 0);
  assert.equal(harness.seatState.find((row) => row.user_id === "human_1")?.status, "ACTIVE");
  assert.equal(harness.tableState.tableStatus, "OPEN");
  assert.equal(harness.tableState.stateRow.state.turnUserId, "bot_1");
});

test("inactive cleanup closes stale live hand for disconnected human after activity timeout", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 250 },
      { user_id: "bot_1", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 170 }
    ],
    state: {
      phase: "PREFLOP",
      handId: "h-stale-disconnect",
      turnUserId: "human_1",
      turnDeadlineAt: null,
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot_1", seatNo: 2, status: "ACTIVE" }
      ],
      stacks: { human_1: 250, bot_1: 170 }
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    lastActivityAt: "2026-03-01T00:00:10.000Z",
    nowMs: Date.parse("2026-03-01T00:02:00.000Z")
  });

  const result = await harness.run();

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(result.status, "cleaned_closed");
  assert.equal(harness.tableState.tableStatus, "CLOSED");
  assert.equal(harness.seatState.every((row) => row.status === "INACTIVE"), true);
  assert.equal(harness.tableState.stateRow.state.phase, "HAND_DONE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, null);
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { bot_1: 170 });
});

test("inactive cleanup does not close stale live hand when another active human remains", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 250 },
      { user_id: "human_2", seat_no: 2, status: "ACTIVE", is_bot: false, stack: 300 },
      { user_id: "bot_1", seat_no: 3, status: "ACTIVE", is_bot: true, stack: 170 }
    ],
    state: {
      phase: "PREFLOP",
      handId: "h-stale-active-human-remains",
      turnUserId: "human_2",
      turnDeadlineAt: null,
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "human_2", seatNo: 2, status: "ACTIVE" },
        { userId: "bot_1", seatNo: 3, status: "ACTIVE" }
      ],
      stacks: { human_1: 250, human_2: 300, bot_1: 170 }
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    lastActivityAt: "2026-03-01T00:00:10.000Z",
    nowMs: Date.parse("2026-03-01T00:02:00.000Z")
  });

  const result = await harness.run();

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.closed, false);
  assert.equal(result.status, "cleaned");
  assert.equal(harness.tableState.tableStatus, "OPEN");
  assert.equal(harness.seatState.find((row) => row.user_id === "human_1")?.status, "INACTIVE");
  assert.equal(harness.seatState.find((row) => row.user_id === "human_2")?.status, "ACTIVE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, "human_2");
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { human_2: 300, bot_1: 170 });
});

test("inactive cleanup system sweep keeps bots-only live table open until hand completion", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "bot_1", status: "ACTIVE", is_bot: true, stack: 200 },
      { user_id: "human_inactive", status: "INACTIVE", is_bot: false, stack: 10 }
    ],
    state: {
      phase: "FLOP",
      handId: "h-1",
      stacks: { bot_1: 200, human_inactive: 10 },
      turnUserId: "bot_1",
      turnDeadlineAt: Date.parse("2026-03-01T00:02:10.000Z")
    },
    lastActivityAt: "2026-03-01T00:01:55.000Z"
  });

  const result = await harness.runSystemSweep();

  assert.equal(result.ok, true);
  assert.equal(result.closed, false);
  assert.equal(result.deferred, false);
  assert.equal(result.status, "live_hand_preserved");
  assert.equal(harness.tableState.tableStatus, "OPEN");
  assert.equal(harness.seatState.find((row) => row.user_id === "bot_1")?.status, "ACTIVE");
  assert.equal(harness.tableState.stateRow.state.phase, "FLOP");
  assert.equal(harness.tableState.stateRow.state.turnUserId, "bot_1");
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { bot_1: 200, human_inactive: 10 });
});

test("inactive cleanup system sweep keeps fresh bots-only live table open when deadline is missing", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "bot_1", status: "ACTIVE", is_bot: true, stack: 200 },
      { user_id: "human_inactive", status: "INACTIVE", is_bot: false, stack: 10 }
    ],
    state: {
      phase: "FLOP",
      handId: "h-missing-deadline",
      stacks: { bot_1: 200, human_inactive: 10 },
      turnUserId: "bot_1",
      turnDeadlineAt: null
    },
    lastActivityAt: "2026-03-01T00:01:55.000Z"
  });

  const result = await harness.runSystemSweep();

  assert.equal(result.ok, true);
  assert.equal(result.closed, false);
  assert.equal(result.deferred, false);
  assert.equal(result.status, "live_hand_preserved");
  assert.equal(harness.tableState.tableStatus, "OPEN");
  assert.equal(harness.tableState.stateRow.state.phase, "FLOP");
  assert.equal(harness.tableState.stateRow.state.turnUserId, "bot_1");
});

test("inactive cleanup system sweep closes stale bots-only live table after activity timeout", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "bot_1", status: "ACTIVE", is_bot: true, stack: 200 },
      { user_id: "human_inactive", status: "INACTIVE", is_bot: false, stack: 10 }
    ],
    state: {
      phase: "RIVER",
      handId: "h-stale-live",
      stacks: { bot_1: 200, human_inactive: 10 },
      turnUserId: "bot_1"
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    lastActivityAt: "2026-03-01T00:00:10.000Z",
    nowMs: Date.parse("2026-03-01T00:02:00.000Z")
  });

  const result = await harness.runSystemSweep();

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(harness.tableState.tableStatus, "CLOSED");
  assert.equal(harness.seatState.every((row) => row.status === "INACTIVE"), true);
  assert.equal(harness.tableState.stateRow.state.phase, "HAND_DONE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, null);
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { bot_1: 200 });
  assert.equal(harness.cashouts[0]?.createdBy, null);
});

test("inactive cleanup system sweep closes bots-only live table with expired turn despite recent activity", async () => {
  const nowMs = Date.parse("2026-03-01T00:02:00.000Z");
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "bot_1", status: "ACTIVE", is_bot: true, stack: 200 },
      { user_id: "human_inactive", status: "INACTIVE", is_bot: false, stack: 10 }
    ],
    state: {
      phase: "RIVER",
      handId: "h-expired-turn",
      stacks: { bot_1: 200, human_inactive: 10 },
      turnUserId: "bot_1",
      turnDeadlineAt: nowMs - 20_000
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    lastActivityAt: "2026-03-01T00:01:55.000Z",
    nowMs
  });

  const result = await harness.runSystemSweep();

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(harness.tableState.tableStatus, "CLOSED");
  assert.equal(harness.seatState.every((row) => row.status === "INACTIVE"), true);
  assert.equal(harness.tableState.stateRow.state.phase, "HAND_DONE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, null);
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { bot_1: 200 });
});

test("inactive cleanup system sweep closes bots-only action phase with missing turn holder", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "bot_1", status: "ACTIVE", is_bot: true, stack: 200 },
      { user_id: "human_inactive", status: "INACTIVE", is_bot: false, stack: 10 }
    ],
    state: {
      phase: "TURN",
      handId: "h-missing-turn",
      stacks: { bot_1: 200, human_inactive: 10 },
      turnUserId: null,
      turnDeadlineAt: null
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    lastActivityAt: "2026-03-01T00:01:59.000Z"
  });

  const result = await harness.runSystemSweep();

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(harness.tableState.tableStatus, "CLOSED");
  assert.equal(harness.seatState.every((row) => row.status === "INACTIVE"), true);
  assert.equal(harness.tableState.stateRow.state.phase, "HAND_DONE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, null);
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { bot_1: 200 });
});

test("inactive cleanup system sweep closes bots-only settled table", async () => {
  const harness = createCleanupHarness({
    seatRows: [
      { user_id: "bot_1", status: "ACTIVE", is_bot: true, stack: 200 },
      { user_id: "human_inactive", status: "INACTIVE", is_bot: false, stack: 10 }
    ],
    state: {
      phase: "SETTLED",
      handId: "h-2",
      stacks: { bot_1: 200, human_inactive: 10 },
      turnUserId: null
    }
  });

  const result = await harness.runSystemSweep();

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(harness.tableState.tableStatus, "CLOSED");
  assert.equal(harness.seatState.every((row) => row.status === "INACTIVE"), true);
  assert.equal(harness.tableState.stateRow.state.phase, "HAND_DONE");
  assert.equal(harness.tableState.stateRow.state.turnUserId, null);
  assert.deepEqual(harness.tableState.stateRow.state.stacks, { bot_1: 200 });
  assert.equal(harness.cashouts[0]?.createdBy, null);
});

test("inactive cleanup keeps fresh table open during close grace period", async () => {
  const harness = createCleanupHarness({
    seatRows: [],
    state: { phase: "LOBBY", stacks: {} },
    createdAt: "2026-03-01T00:01:30.000Z",
    nowMs: Date.parse("2026-03-01T00:02:00.000Z")
  });

  const result = await harness.runSystemSweep();

  assert.equal(result.ok, false);
  assert.equal(result.code, "grace_period");
  assert.equal(result.retryable, true);
  assert.equal(harness.tableState.tableStatus, "OPEN");
});
