import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCoreStateAction,
  bootstrapCoreStateHand,
  buildBootstrappedPokerState,
  buildNextHandStateFromSettled,
  replaceBrokeBotsForNextHand
} from "./poker-engine.mjs";

function initialCore() {
  return {
    roomId: "table_engine_roll",
    version: 5,
    seats: { user_a: 1, user_b: 2 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    pokerState: null
  };
}

test("engine rollover starts next preflop hand after settled terminal action", () => {
  let coreState = bootstrapCoreStateHand({ tableId: "table_engine_roll", coreState: initialCore(), nowMs: 1000 }).coreState;
  const oldHandId = coreState.pokerState.handId;

  const folded = applyCoreStateAction({
    tableId: "table_engine_roll",
    coreState,
    handId: oldHandId,
    userId: coreState.pokerState.turnUserId,
    action: "FOLD",
    nowIso: new Date(1001).toISOString(),
    nowMs: 1001
  });

  assert.equal(folded.accepted, true);
  coreState = folded.coreState;
  assert.equal(coreState.pokerState.phase, "PREFLOP");
  assert.notEqual(coreState.pokerState.handId, oldHandId);
  assert.deepEqual(coreState.pokerState.community, []);
  assert.equal(coreState.pokerState.communityDealt, 0);
  assert.equal(coreState.pokerState.turnUserId !== null, true);
});

test("fold settlement carryover preserves stack-eligible members and deterministic dealer rotation", () => {
  const threePlayer = {
    roomId: "table_engine_roll_3p",
    version: 9,
    seats: { user_a: 1, user_b: 2, user_c: 3 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 },
      { userId: "user_c", seat: 3 }
    ],
    pokerState: null
  };

  const settledLikeState = {
    handId: "settled_1",
    phase: "SETTLED",
    dealerSeatNo: 1,
    stacks: { user_a: 0, user_b: 130, user_c: 70 }
  };

  const next = buildNextHandStateFromSettled({
    tableId: "table_engine_roll_3p",
    coreState: threePlayer,
    settledState: settledLikeState,
    nextVersion: 10
  });

  assert.equal(next.phase, "PREFLOP");
  assert.equal(next.handId, "ws_hand_table_engine_roll_3p_10_2");
  assert.deepEqual(next.community, []);
  assert.equal(next.communityDealt, 0);
  assert.equal(next.currentBet, 2);
  assert.equal(next.dealerSeatNo, 2);
  assert.deepEqual(next.seats, [
    { userId: "user_b", seatNo: 2 },
    { userId: "user_c", seatNo: 3 }
  ]);
  assert.equal(next.turnUserId, "user_b");
});

test("rollover does not bootstrap a live hand when fewer than two stack-eligible players remain", () => {
  const baseCore = {
    roomId: "table_engine_roll_no_start",
    version: 20,
    seats: { user_a: 1, user_b: 2, user_c: 3 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 },
      { userId: "user_c", seat: 3 }
    ],
    pokerState: null
  };

  const notEnough = buildBootstrappedPokerState({
    tableId: "table_engine_roll_no_start",
    coreState: baseCore,
    startingStacks: { user_a: 0, user_b: 25, user_c: 0 },
    handVersion: 21,
    dealerSeatNo: 2
  });

  assert.equal(notEnough, null);

  const nextFromSettled = buildNextHandStateFromSettled({
    tableId: "table_engine_roll_no_start",
    coreState: baseCore,
    settledState: {
      handId: "settled_2",
      phase: "SETTLED",
      dealerSeatNo: 2,
      stacks: { user_a: 0, user_b: 25, user_c: 0 }
    },
    nextVersion: 21
  });

  assert.equal(nextFromSettled, null);
});

test("replaceBrokeBotsForNextHand swaps too-short bot only after settlement", () => {
  const coreState = {
    roomId: "table_engine_roll_bot_replace",
    version: 30,
    seats: { human_a: 1, bot_old: 2, human_b: 3 },
    members: [
      { userId: "human_a", seat: 1 },
      { userId: "bot_old", seat: 2 },
      { userId: "human_b", seat: 3 }
    ],
    seatDetailsByUserId: {
      human_a: { isBot: false, botProfile: null, leaveAfterHand: false },
      bot_old: { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false },
      human_b: { isBot: false, botProfile: null, leaveAfterHand: false }
    },
    publicStacks: { human_a: 120, bot_old: 1, human_b: 120 },
    pokerState: null
  };

  const settledState = {
    handId: "settled_bot_replace",
    phase: "SETTLED",
    dealerSeatNo: 1,
    stacks: { human_a: 120, bot_old: 1, human_b: 120 }
  };

  const recycled = replaceBrokeBotsForNextHand({
    coreState,
    settledState,
    nextVersion: 31
  });

  assert.notEqual(recycled.coreState, coreState);
  assert.equal(recycled.coreState.members.some((member) => member.userId === "bot_old"), false);

  const replacementBot = recycled.coreState.members.find((member) => member.seat === 2);
  assert.ok(replacementBot);
  assert.notEqual(replacementBot.userId, "bot_old");
  assert.equal(recycled.coreState.seatDetailsByUserId[replacementBot.userId].isBot, true);
  assert.equal(recycled.settledState.stacks[replacementBot.userId], 100);
  assert.equal("bot_old" in recycled.settledState.stacks, false);
});
