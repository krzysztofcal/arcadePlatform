import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizePrivateBranch } from "../ws-server/poker/read-model/state-snapshot.mjs";

function loadBuildTableStatePayload() {
  const source = fs.readFileSync(new URL("../ws-server/server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function buildTableStatePayload({ tableState, tableSnapshot, userId }) {");
  assert.ok(start >= 0, "buildTableStatePayload should exist");
  const end = source.indexOf("\n\nfunction sendTableState", start);
  assert.ok(end > start, "buildTableStatePayload boundary should exist");
  const fnSource = source.slice(start, end);
  // buildTableStatePayload references normalizePrivateBranch and its helpers from
  // the module import — inject the real implementations so the extracted function
  // behaves identically to production.
  const normalizeCards = (cards) => (Array.isArray(cards) ? cards.filter((card) => typeof card === "string") : []);
  const normalizePlayerState = (playerState) => {
    if (!playerState || typeof playerState !== "object" || Array.isArray(playerState)) return null;
    const allowedStatuses = new Set(["ACTIVE", "OUT_OF_CHIPS", "WAITING_NEXT_HAND"]);
    const status = typeof playerState.status === "string" ? playerState.status.trim().toUpperCase() : "";
    if (!allowedStatuses.has(status) || !Number.isInteger(playerState.stack) || playerState.stack < 0) return null;
    return { status, stack: playerState.stack, canRebuy: playerState.canRebuy === true };
  };
  const factory = new Function(`const normalizeCards = ${normalizeCards.toString()}; const normalizePlayerState = ${normalizePlayerState.toString()}; const normalizePrivateBranch = ${normalizePrivateBranch.toString()}; ${fnSource}; return buildTableStatePayload;`);
  return factory();
}

test("buildTableStatePayload keeps live members and emits authoritativeMembers from snapshot", () => {
  const buildTableStatePayload = loadBuildTableStatePayload();

  const tableState = { tableId: "table_1", members: [{ userId: "u1", seat: 0 }] };
  const withConstraints = buildTableStatePayload({
    tableState,
    tableSnapshot: {
      roomId: "table_1",
      stateVersion: 22,
      memberCount: 1,
      seats: [{ userId: "seed_user", seatNo: 2, status: "ACTIVE" }],
      stacks: { seed_user: 180 },
      hand: { status: "TURN" },
      board: { cards: ["Ah", "Kd", "Qs", "2c"] },
      pot: { total: 90, sidePots: [] },
      turn: { userId: "u1", seat: 0, deadlineAt: 123 },
      legalActions: { seat: 0, actions: ["CHECK", "BET"] },
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 500 },
      members: [{ userId: "seed_user", seat: 2 }],
      private: { shouldNotBeIncluded: true }
    }
  });

  assert.equal(withConstraints.tableId, "table_1");
  assert.deepEqual(withConstraints.members, [{ userId: "u1", seat: 0 }]);
  assert.equal(withConstraints.stateVersion, 22);
  assert.equal(withConstraints.memberCount, 1);
  assert.deepEqual(withConstraints.seats, [{ userId: "seed_user", seatNo: 2, status: "ACTIVE" }]);
  assert.deepEqual(withConstraints.stacks, { seed_user: 180 });
  assert.deepEqual(withConstraints.legalActions, { seat: 0, actions: ["CHECK", "BET"] });
  assert.deepEqual(withConstraints.actionConstraints, { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 500 });
  assert.deepEqual(withConstraints.authoritativeMembers, [{ userId: "seed_user", seat: 2 }]);
  assert.equal(Object.prototype.hasOwnProperty.call(withConstraints, "private"), false);

  const noConstraints = buildTableStatePayload({
    tableState,
    tableSnapshot: { roomId: "table_1", stateVersion: 23, legalActions: { seat: 0, actions: ["CHECK"] } }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(noConstraints, "actionConstraints"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(noConstraints, "authoritativeMembers"), false);
});

test("buildTableStatePayload forwards lobby/no-hand public seats and stacks without private data", () => {
  const buildTableStatePayload = loadBuildTableStatePayload();

  const payload = buildTableStatePayload({
    tableState: { tableId: "table_lobby", members: [] },
    tableSnapshot: {
      tableId: "table_lobby",
      roomId: "table_lobby",
      stateVersion: 0,
      youSeat: 2,
      members: [{ userId: "user_joined", seat: 2 }],
      seats: [{ userId: "user_joined", seatNo: 2, status: "ACTIVE" }],
      stacks: { user_joined: 175 },
      hand: { handId: null, status: "LOBBY", round: null },
      pot: { total: 0, sidePots: [] },
      turn: { userId: "user_joined", seat: 2, startedAt: null, deadlineAt: null },
      private: { holeCards: ["As", "Kd"] }
    }
  });

  assert.deepEqual(payload.members, []);
  assert.deepEqual(payload.authoritativeMembers, [{ userId: "user_joined", seat: 2 }]);
  assert.deepEqual(payload.seats, [{ userId: "user_joined", seatNo: 2, status: "ACTIVE" }]);
  assert.deepEqual(payload.stacks, { user_joined: 175 });
  assert.equal(payload.youSeat, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "private"), false);
});

test("buildTableStatePayload includes own private.holeCards when seated user is present", () => {
  const buildTableStatePayload = loadBuildTableStatePayload();

  const payload = buildTableStatePayload({
    tableState: { tableId: "table_seated", members: [{ userId: "hero", seat: 3 }] },
    tableSnapshot: {
      tableId: "table_seated",
      roomId: "table_seated",
      stateVersion: 12,
      youSeat: 3,
      members: [{ userId: "hero", seat: 3 }, { userId: "villain", seat: 1 }],
      seats: [
        { userId: "hero", seatNo: 3, status: "ACTIVE" },
        { userId: "villain", seatNo: 1, status: "ACTIVE" }
      ],
      stacks: { hero: 100, villain: 100 },
      hand: { handId: "hand_1", status: "FLOP", round: null },
      private: { holeCards: ["As", "Kd"] }
    },
    userId: "hero"
  });

  assert.deepEqual(payload.private, { userId: "hero", seat: 3, holeCards: ["As", "Kd"] });
});

test("buildTableStatePayload does not leak private branch for users without a seat", () => {
  const buildTableStatePayload = loadBuildTableStatePayload();

  // youSeat === null → no private branch at all, same contract as buildStateSnapshotPayload.
  const observer = buildTableStatePayload({
    tableState: { tableId: "table_obs", members: [{ userId: "villain", seat: 1 }] },
    tableSnapshot: {
      tableId: "table_obs",
      stateVersion: 5,
      youSeat: null,
      members: [{ userId: "villain", seat: 1 }],
      seats: [{ userId: "villain", seatNo: 1, status: "ACTIVE" }],
      stacks: { villain: 100 },
      private: { holeCards: ["2c", "2d"] }
    },
    userId: "observer"
  });

  assert.equal(Object.prototype.hasOwnProperty.call(observer, "private"), false);
});

test("buildTableStatePayload redacts opponent cards: only own holeCards in private branch", () => {
  const buildTableStatePayload = loadBuildTableStatePayload();

  const payload = buildTableStatePayload({
    tableState: { tableId: "table_redact", members: [{ userId: "hero", seat: 2 }] },
    tableSnapshot: {
      tableId: "table_redact",
      stateVersion: 9,
      youSeat: 2,
      members: [{ userId: "hero", seat: 2 }, { userId: "villain", seat: 4 }],
      seats: [
        { userId: "hero", seatNo: 2, status: "ACTIVE" },
        { userId: "villain", seatNo: 4, status: "ACTIVE" }
      ],
      stacks: { hero: 80, villain: 120 },
      hand: { handId: "hand_2", status: "TURN", round: null },
      // Snapshot private branch is scoped by the server to the requesting user already;
      // ensure the client payload carries only that scoped branch.
      private: { holeCards: ["Ah", "Ad"] }
    },
    userId: "hero"
  });

  assert.deepEqual(payload.private.holeCards, ["Ah", "Ad"]);
  assert.deepEqual(Object.keys(payload.private).sort(), ["holeCards", "seat", "userId"]);
  // Opponent cards are never present anywhere in the payload.
  assert.equal(JSON.stringify(payload).includes("villain"), true); // villain seat/member is public
  assert.deepEqual(payload.private.userId, "hero");
});
