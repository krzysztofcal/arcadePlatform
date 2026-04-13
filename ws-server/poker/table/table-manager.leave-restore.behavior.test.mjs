import test from "node:test";
import assert from "node:assert/strict";
import { createTableManager } from "./table-manager.mjs";

test("buildAuthoritativeLeaveRestore keeps left seat in poker state but removes member ownership", () => {
  const manager = createTableManager();
  const restored = manager.buildAuthoritativeLeaveRestore({
    tableId: "t1",
    userId: "u1",
    stateVersion: 7,
    pokerState: {
      tableId: "t1",
      seats: [
        { userId: "u1", seatNo: 1 },
        { userId: "bot-1", seatNo: 2, isBot: true },
      ],
      stacks: {
        u1: 48,
        "bot-1": 52,
      },
      leftTableByUserId: {
        u1: true,
      },
    },
  });

  assert.equal(restored.ok, true);
  assert.deepEqual(restored.restoredTable.coreState.members, [{ userId: "bot-1", seat: 2 }]);
  assert.deepEqual(restored.restoredTable.coreState.seats, { "bot-1": 2 });
  assert.deepEqual(restored.restoredTable.coreState.pokerState.seats.map((seat) => seat.userId), ["u1", "bot-1"]);
});
