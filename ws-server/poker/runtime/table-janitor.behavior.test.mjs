import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTableHealth, runTableJanitor, selectOpenTableJanitorBatch } from "./table-janitor.mjs";

const NOW_MS = Date.parse("2026-04-23T13:12:00.000Z");

function iso(msOffset = 0) {
  return new Date(NOW_MS + msOffset).toISOString();
}

test("evaluateTableHealth keeps healthy active human tables as noop", () => {
  const result = evaluateTableHealth({
    tableId: "t_healthy",
    nowMs: NOW_MS,
    persistedTable: {
      status: "OPEN",
      created_at: iso(-300_000),
      last_activity_at: iso(-5_000)
    },
    persistedSeats: [
      { user_id: "u1", status: "ACTIVE", is_bot: false, last_seen_at: iso(-5_000) }
    ],
    persistedState: {
      phase: "HAND_DONE"
    },
    runtime: {
      loaded: true,
      tableStatus: "OPEN",
      hasConnectedHumanPresence: true,
      connectedUserIds: ["u1"]
    }
  });

  assert.equal(result.healthy, true);
  assert.equal(result.classification, "healthy");
  assert.equal(result.action, "noop");
  assert.equal(result.reasonCode, "healthy_active_human_present");
});

test("evaluateTableHealth classifies stale human seats from last_seen_at", () => {
  const result = evaluateTableHealth({
    tableId: "t_stale_human",
    nowMs: NOW_MS,
    activeSeatFreshMs: 120_000,
    seatedReconnectGraceMs: 90_000,
    persistedTable: {
      status: "OPEN",
      created_at: iso(-600_000),
      last_activity_at: iso(-240_000)
    },
    persistedSeats: [
      { user_id: "u1", status: "ACTIVE", is_bot: false, last_seen_at: iso(-240_000) }
    ],
    persistedState: {
      phase: "HAND_DONE"
    },
    runtime: {
      loaded: true,
      tableStatus: "OPEN",
      hasConnectedHumanPresence: false,
      connectedUserIds: []
    }
  });

  assert.equal(result.healthy, false);
  assert.equal(result.classification, "stale_human_seat");
  assert.equal(result.action, "stale_seat_cleanup");
  assert.equal(result.userId, "u1");
  assert.equal(result.reasonCode, "stale_human_last_seen_expired");
});

test("evaluateTableHealth classifies abandoned live hands", () => {
  const result = evaluateTableHealth({
    tableId: "t_abandoned_live_hand",
    nowMs: NOW_MS,
    liveHandStaleMs: 15_000,
    persistedTable: {
      status: "OPEN",
      created_at: iso(-600_000),
      last_activity_at: iso(-90_000)
    },
    persistedSeats: [],
    persistedState: {
      phase: "PREFLOP",
      turnUserId: "u1",
      turnDeadlineAt: NOW_MS - 30_000
    },
    runtime: {
      loaded: false,
      hasConnectedHumanPresence: false,
      connectedUserIds: []
    }
  });

  assert.equal(result.healthy, false);
  assert.equal(result.classification, "abandoned_live_hand");
  assert.equal(result.action, "inactive_cleanup");
  assert.equal(result.reasonCode, "live_hand_turn_deadline_expired");
});

test("evaluateTableHealth classifies open inert tables", () => {
  const result = evaluateTableHealth({
    tableId: "t_open_inert",
    nowMs: NOW_MS,
    tableCloseGraceMs: 60_000,
    persistedTable: {
      status: "OPEN",
      created_at: iso(-300_000),
      last_activity_at: iso(-180_000)
    },
    persistedSeats: [],
    persistedState: {
      phase: "HAND_DONE"
    },
    runtime: {
      loaded: true,
      tableStatus: "OPEN",
      hasConnectedHumanPresence: false,
      connectedUserIds: []
    }
  });

  assert.equal(result.healthy, false);
  assert.equal(result.classification, "open_inert_table");
  assert.equal(result.action, "zombie_cleanup");
  assert.equal(result.reasonCode, "open_table_without_active_humans");
});

test("evaluateTableHealth preserves fresh live hands during reconnect grace", () => {
  const result = evaluateTableHealth({
    tableId: "t_reconnect_grace",
    nowMs: NOW_MS,
    liveHandStaleMs: 15_000,
    persistedTable: {
      status: "OPEN",
      created_at: iso(-600_000),
      last_activity_at: iso(-5_000)
    },
    persistedSeats: [
      { user_id: "u1", status: "ACTIVE", is_bot: false, last_seen_at: iso(-5_000) }
    ],
    persistedState: {
      phase: "PREFLOP",
      turnUserId: "u1",
      turnDeadlineAt: NOW_MS + 10_000
    },
    runtime: {
      loaded: false,
      hasConnectedHumanPresence: false,
      connectedUserIds: []
    }
  });

  assert.equal(result.healthy, true);
  assert.equal(result.action, "noop");
  assert.equal(result.reasonCode, "healthy_live_hand_active");
});

test("selectOpenTableJanitorBatch rotates batches so older healthy tables do not starve newer unhealthy ones", () => {
  const healthyOldOne = evaluateTableHealth({
    tableId: "t_healthy_old_1",
    nowMs: NOW_MS,
    persistedTable: { status: "OPEN", created_at: iso(-600_000), last_activity_at: iso(-5_000) },
    persistedSeats: [{ user_id: "u1", status: "ACTIVE", is_bot: false, last_seen_at: iso(-5_000) }],
    persistedState: { phase: "HAND_DONE" },
    runtime: { loaded: true, tableStatus: "OPEN", hasConnectedHumanPresence: true, connectedUserIds: ["u1"] }
  });
  const healthyOldTwo = evaluateTableHealth({
    tableId: "t_healthy_old_2",
    nowMs: NOW_MS,
    persistedTable: { status: "OPEN", created_at: iso(-590_000), last_activity_at: iso(-5_000) },
    persistedSeats: [{ user_id: "u2", status: "ACTIVE", is_bot: false, last_seen_at: iso(-5_000) }],
    persistedState: { phase: "HAND_DONE" },
    runtime: { loaded: true, tableStatus: "OPEN", hasConnectedHumanPresence: true, connectedUserIds: ["u2"] }
  });
  const newerInert = evaluateTableHealth({
    tableId: "t_inert_newer",
    nowMs: NOW_MS,
    persistedTable: { status: "OPEN", created_at: iso(-300_000), last_activity_at: iso(-180_000) },
    persistedSeats: [],
    persistedState: { phase: "HAND_DONE" },
    runtime: { loaded: true, tableStatus: "OPEN", hasConnectedHumanPresence: false, connectedUserIds: [] }
  });

  assert.equal(healthyOldOne.healthy, true);
  assert.equal(healthyOldTwo.healthy, true);
  assert.equal(newerInert.classification, "open_inert_table");

  const orderedTables = [
    { id: "t_healthy_old_1", updated_at: iso(-300_000) },
    { id: "t_healthy_old_2", updated_at: iso(-200_000) },
    { id: "t_inert_newer", updated_at: iso(-100_000) }
  ];

  const firstSweep = selectOpenTableJanitorBatch({
    tables: orderedTables,
    limit: 2
  });
  assert.deepEqual(firstSweep.tableIds, ["t_healthy_old_1", "t_healthy_old_2"]);

  const secondSweep = selectOpenTableJanitorBatch({
    tables: orderedTables,
    limit: 2,
    cursor: firstSweep.cursor
  });
  assert.equal(secondSweep.tableIds.includes("t_inert_newer"), true);

  const covered = new Set([...firstSweep.tableIds, ...secondSweep.tableIds]);
  assert.deepEqual([...covered].sort(), ["t_healthy_old_1", "t_healthy_old_2", "t_inert_newer"]);
});

test("runTableJanitor keeps runtime/db mismatch traceable while routing cleanup", async () => {
  const classification = evaluateTableHealth({
    tableId: "t_runtime_mismatch",
    nowMs: NOW_MS,
    persistedTable: {
      status: "OPEN",
      created_at: iso(-600_000),
      last_activity_at: iso(-180_000)
    },
    persistedSeats: [],
    persistedState: {
      phase: "HAND_DONE"
    },
    runtime: {
      loaded: false,
      hasConnectedHumanPresence: false,
      connectedUserIds: []
    }
  });

  assert.equal(classification.classification, "open_inert_table");
  assert.deepEqual(classification.concerns, ["runtime_missing_for_open_table"]);

  const calls = [];
  const logs = [];
  const result = await runTableJanitor({
    classification,
    trigger: "open_table_reconciler",
    requestId: "r-mismatch",
    primitives: {
      zombie_cleanup: async (input) => {
        calls.push(input);
        return { ok: true, changed: true, status: "cleaned_closed" };
      }
    },
    klog: (kind, data) => logs.push({ kind, data })
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "cleaned_closed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tableId, "t_runtime_mismatch");
  assert.equal(logs[0].kind, "ws_table_janitor_classified");
  assert.equal(logs[0].data.reasonCode, "open_table_without_active_humans");
});
