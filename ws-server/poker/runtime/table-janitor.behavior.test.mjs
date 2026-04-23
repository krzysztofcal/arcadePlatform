import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTableHealth, runTableJanitor } from "./table-janitor.mjs";

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
