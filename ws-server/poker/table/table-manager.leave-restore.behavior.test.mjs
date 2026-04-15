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

test("buildAuthoritativeLeaveRestore preserves remaining runtime private hand data", () => {
  const manager = createTableManager();
  manager.restoreTableFromPersisted("t2", {
    tableId: "t2",
    tableStatus: "OPEN",
    coreState: {
      roomId: "t2",
      maxSeats: 6,
      version: 6,
      members: [
        { userId: "u1", seat: 1 },
        { userId: "bot-1", seat: 2 },
        { userId: "bot-2", seat: 3 }
      ],
      seats: { u1: 1, "bot-1": 2, "bot-2": 3 },
      seatDetailsByUserId: {
        u1: { isBot: false, botProfile: null, leaveAfterHand: false },
        "bot-1": { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false },
        "bot-2": { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false }
      },
      publicStacks: { u1: 48, "bot-1": 52, "bot-2": 100 },
      pokerState: {
        tableId: "t2",
        handId: "hand_1",
        handSeed: "seed_1",
        deck: ["4C", "5D"],
        seats: [
          { userId: "u1", seatNo: 1 },
          { userId: "bot-1", seatNo: 2, isBot: true },
          { userId: "bot-2", seatNo: 3, isBot: true }
        ],
        holeCardsByUserId: {
          u1: ["AH", "AD"],
          "bot-1": ["KC", "KS"],
          "bot-2": ["2C", "2D"]
        }
      }
    },
    presenceByUserId: new Map()
  });

  const restored = manager.buildAuthoritativeLeaveRestore({
    tableId: "t2",
    userId: "u1",
    stateVersion: 7,
    pokerState: {
      tableId: "t2",
      handId: "hand_1",
      seats: [
        { userId: "u1", seatNo: 1 },
        { userId: "bot-1", seatNo: 2, isBot: true },
        { userId: "bot-2", seatNo: 3, isBot: true }
      ],
      stacks: {
        u1: 48,
        "bot-1": 52,
        "bot-2": 100
      },
      leftTableByUserId: {
        u1: true
      }
    }
  });

  assert.equal(restored.ok, true);
  assert.deepEqual(restored.restoredTable.coreState.pokerState.holeCardsByUserId, {
    "bot-1": ["KC", "KS"],
    "bot-2": ["2C", "2D"]
  });
  assert.deepEqual(restored.restoredTable.coreState.pokerState.deck, ["4C", "5D"]);
  assert.equal(restored.restoredTable.coreState.pokerState.handSeed, "seed_1");
});
