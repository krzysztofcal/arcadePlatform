import test from "node:test";
import assert from "node:assert/strict";
import { createTableManager } from "./table-manager.mjs";
import { dealHoleCards, deriveDeck, toCardCodes } from "../shared/poker-primitives.mjs";

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

test("buildAuthoritativeLeaveRestore rehydrates deterministic runtime hand state from authoritative public data", () => {
  const manager = createTableManager();
  const handSeed = "seed_rehydrate_turn";
  const seatOrder = ["u1", "bot-1", "bot-2"];
  const dealt = dealHoleCards(deriveDeck(handSeed), seatOrder);
  const turnCommunity = toCardCodes(dealt.deck.slice(0, 4));
  const riverDeck = toCardCodes(dealt.deck.slice(4));

  manager.restoreTableFromPersisted("t3", {
    tableId: "t3",
    tableStatus: "OPEN",
    coreState: {
      roomId: "t3",
      maxSeats: 6,
      version: 8,
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
      publicStacks: { u1: 98, "bot-1": 101, "bot-2": 101 },
      pokerState: {
        tableId: "t3",
        roomId: "t3",
        handId: "hand_turn_rehydrate",
        handSeed,
        phase: "TURN",
        dealerSeatNo: 1,
        seats: [
          { userId: "u1", seatNo: 1, status: "ACTIVE" },
          { userId: "bot-1", seatNo: 2, status: "ACTIVE", isBot: true },
          { userId: "bot-2", seatNo: 3, status: "ACTIVE", isBot: true }
        ],
        handSeats: [
          { userId: "u1", seatNo: 1, status: "ACTIVE" },
          { userId: "bot-1", seatNo: 2, status: "ACTIVE", isBot: true },
          { userId: "bot-2", seatNo: 3, status: "ACTIVE", isBot: true }
        ],
        stacks: { u1: 98, "bot-1": 101, "bot-2": 101 },
        community: turnCommunity,
        communityDealt: 4,
        currentBet: 0,
        toCallByUserId: { u1: 0, "bot-1": 0, "bot-2": 0 },
        betThisRoundByUserId: { u1: 0, "bot-1": 0, "bot-2": 0 },
        actedThisRoundByUserId: { u1: true, "bot-1": true, "bot-2": false },
        lastBettingRoundActionByUserId: { u1: "check", "bot-1": "check", "bot-2": null },
        foldedByUserId: {},
        leftTableByUserId: {},
        sitOutByUserId: {},
        pendingAutoSitOutByUserId: {},
        contributionsByUserId: { u1: 2, "bot-1": 2, "bot-2": 2 },
        turnUserId: "bot-2"
      }
    },
    presenceByUserId: new Map()
  });

  const restored = manager.buildAuthoritativeLeaveRestore({
    tableId: "t3",
    userId: "u1",
    stateVersion: 9,
    pokerState: {
      tableId: "t3",
      roomId: "t3",
      handId: "hand_turn_rehydrate",
      handSeed,
      phase: "TURN",
      dealerSeatNo: 1,
      seats: [
        { userId: "u1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot-1", seatNo: 2, status: "ACTIVE", isBot: true },
        { userId: "bot-2", seatNo: 3, status: "ACTIVE", isBot: true }
      ],
      handSeats: [
        { userId: "u1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot-1", seatNo: 2, status: "ACTIVE", isBot: true },
        { userId: "bot-2", seatNo: 3, status: "ACTIVE", isBot: true }
      ],
      stacks: { "bot-1": 101, "bot-2": 101 },
      community: turnCommunity,
      communityDealt: 4,
      currentBet: 0,
      toCallByUserId: { u1: 0, "bot-1": 0, "bot-2": 0 },
      betThisRoundByUserId: { u1: 0, "bot-1": 0, "bot-2": 0 },
      actedThisRoundByUserId: { u1: true, "bot-1": true, "bot-2": false },
      lastBettingRoundActionByUserId: { u1: "fold", "bot-1": "check", "bot-2": null },
      foldedByUserId: { u1: true },
      leftTableByUserId: { u1: true },
      sitOutByUserId: {},
      pendingAutoSitOutByUserId: {},
      contributionsByUserId: { u1: 2, "bot-1": 2, "bot-2": 2 },
      turnUserId: "bot-2"
    }
  });

  assert.equal(restored.ok, true);
  manager.restoreTableFromPersisted("t3", restored.restoredTable);
  const restoredState = manager.persistedPokerState("t3");
  assert.deepEqual(restoredState.community, turnCommunity);
  assert.deepEqual(restoredState.deck, riverDeck);
  assert.deepEqual(restoredState.holeCardsByUserId["bot-1"], toCardCodes(dealt.holeCardsByUserId["bot-1"]));
  assert.deepEqual(restoredState.holeCardsByUserId["bot-2"], toCardCodes(dealt.holeCardsByUserId["bot-2"]));

  const applied = manager.applyAction({
    tableId: "t3",
    handId: "hand_turn_rehydrate",
    userId: "bot-2",
    requestId: "turn-check",
    action: "CHECK"
  });
  assert.equal(applied.accepted, true);
  assert.equal(manager.persistedPokerState("t3").phase, "RIVER");
  assert.equal(manager.persistedPokerState("t3").community.length, 5);
});
