import test from "node:test";
import assert from "node:assert/strict";
import { __testOnly, createTableManager } from "./table-manager.mjs";

function fakeWs(id) {
  return { id };
}

function memberPairs(members) {
  return members.map((member) => [member.userId, member.seat]);
}



test("buildNextHandStateFromSettled requires at least two continuation-eligible stacks", () => {
  const settledState = {
    dealerSeatNo: 1,
    stacks: { user_a: 120, user_b: 0, user_c: 0 }
  };
  const coreState = {
    version: 9,
    roomId: "table_eligibility_gate",
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 },
      { userId: "user_c", seat: 3 }
    ]
  };

  const nextHand = __testOnly.buildNextHandStateFromSettled({
    tableId: "table_eligibility_gate",
    coreState,
    settledState,
    nextVersion: 10
  });

  assert.equal(nextHand, null);
});

test("resolveNextDealerSeatNo skips ineligible seats based on settled continuation stacks", () => {
  const members = [
    { userId: "user_a", seat: 1 },
    { userId: "user_b", seat: 2 },
    { userId: "user_c", seat: 3 },
    { userId: "user_d", seat: 4 }
  ];

  const nextDealer = __testOnly.resolveNextDealerSeatNo({
    members,
    settledState: {
      dealerSeatNo: 1,
      stacks: { user_a: 50, user_b: 0, user_c: 80, user_d: 0 }
    }
  });

  assert.equal(nextDealer, 3);
});

test("rolloverSettledHand delays next-hand bootstrap until explicitly invoked", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const tableId = "table_settled_rollover";
  const wsA = fakeWs("ws-rollover-a");
  const wsB = fakeWs("ws-rollover-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-rollover-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-rollover-b", nowTs: 2 }).ok, true);

  const restored = tableManager.restoreTableFromPersisted(tableId, {
    coreState: {
      version: 7,
      roomId: tableId,
      maxSeats: 6,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      seats: { user_a: 1, user_b: 2 },
      publicStacks: { user_a: 102, user_b: 98 },
      seatDetailsByUserId: {
        user_a: { isBot: false, botProfile: null, leaveAfterHand: false },
        user_b: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: {
        roomId: tableId,
        handId: "hand_settled_rollover",
        phase: "SETTLED",
        dealerSeatNo: 1,
        seats: [
          { userId: "user_a", seatNo: 1, status: "ACTIVE" },
          { userId: "user_b", seatNo: 2, status: "ACTIVE" }
        ],
        stacks: { user_a: 102, user_b: 98 },
        showdown: {
          handId: "hand_settled_rollover",
          winners: ["user_a"],
          potsAwarded: [{ amount: 4, winners: ["user_a"] }],
          potAwardedTotal: 4,
          reason: "computed"
        },
        handSettlement: {
          handId: "hand_settled_rollover",
          settledAt: "2026-04-11T10:00:00.000Z",
          payouts: { user_a: 4 }
        },
        holeCardsByUserId: { user_a: ["AS", "KD"], user_b: ["2C", "2D"] }
      }
    },
    presenceByUserId: new Map([
      ["user_a", { userId: "user_a", seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }],
      ["user_b", { userId: "user_b", seat: 2, connected: true, lastSeenAt: 2, expiresAt: null }]
    ])
  });

  assert.equal(restored.ok, true);
  assert.equal(tableManager.persistedPokerState(tableId).phase, "SETTLED");

  const rollover = tableManager.rolloverSettledHand({ tableId, nowMs: 5_000 });

  assert.equal(rollover.ok, true);
  assert.equal(rollover.changed, true);
  const nextState = tableManager.persistedPokerState(tableId);
  assert.equal(nextState.phase, "PREFLOP");
  assert.equal(nextState.dealerSeatNo, 2);
  assert.equal(nextState.turnStartedAt, 5_000);
  assert.equal(nextState.turnDeadlineAt > nextState.turnStartedAt, true);
});

test("bootstrapHand excludes disconnected human ghost seats from the next hand", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const tableId = "table_bootstrap_connected_human_only";
  const wsHuman = fakeWs("ws-bootstrap-human");

  assert.equal(tableManager.join({ ws: wsHuman, userId: "human_live", tableId, requestId: "join-bootstrap-human", nowTs: 1 }).ok, true);

  const restored = tableManager.restoreTableFromPersisted(tableId, {
    coreState: {
      version: 9,
      roomId: tableId,
      maxSeats: 6,
      appliedRequestIds: [],
      members: [
        { userId: "human_live", seat: 1 },
        { userId: "bot_2", seat: 2 },
        { userId: "ghost_human", seat: 4 }
      ],
      seats: { human_live: 1, bot_2: 2, ghost_human: 4 },
      publicStacks: { human_live: 120, bot_2: 100, ghost_human: 100 },
      seatDetailsByUserId: {
        human_live: { isBot: false, botProfile: null, leaveAfterHand: false },
        bot_2: { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false },
        ghost_human: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: null
    },
    presenceByUserId: new Map([
      ["human_live", { userId: "human_live", seat: 1 }],
      ["bot_2", { userId: "bot_2", seat: 2 }],
      ["ghost_human", { userId: "ghost_human", seat: 4 }]
    ])
  });

  assert.equal(restored.ok, true);

  const bootstrapped = tableManager.bootstrapHand(tableId, { nowMs: 1_000 });

  assert.equal(bootstrapped.ok, true);
  assert.equal(bootstrapped.changed, true);

  const nextState = tableManager.persistedPokerState(tableId);
  assert.deepEqual(nextState.seats, [
    { userId: "human_live", seatNo: 1 },
    { userId: "bot_2", seatNo: 2 }
  ]);
  assert.equal(nextState.foldedByUserId.human_live, false);
  assert.equal(Object.prototype.hasOwnProperty.call(nextState.foldedByUserId, "ghost_human"), false);
});

test("rolloverSettledHand keeps reconnect-grace human with bots but still excludes disconnected human ghosts", () => {
  const tableManager = createTableManager({ maxSeats: 6, presenceTtlMs: 100 });
  const tableId = "table_rollover_connected_human_gate";
  const wsHuman = fakeWs("ws-rollover-human");

  assert.equal(tableManager.join({ ws: wsHuman, userId: "human_live", tableId, requestId: "join-rollover-human", nowTs: 1 }).ok, true);

  let restored = tableManager.restoreTableFromPersisted(tableId, {
    coreState: {
      version: 11,
      roomId: tableId,
      maxSeats: 6,
      appliedRequestIds: [],
      members: [
        { userId: "human_live", seat: 1 },
        { userId: "bot_2", seat: 2 },
        { userId: "ghost_human", seat: 4 }
      ],
      seats: { human_live: 1, bot_2: 2, ghost_human: 4 },
      publicStacks: { human_live: 118, bot_2: 102, ghost_human: 100 },
      seatDetailsByUserId: {
        human_live: { isBot: false, botProfile: null, leaveAfterHand: false },
        bot_2: { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false },
        ghost_human: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: {
        tableId,
        handId: "hand_rollover_gate",
        phase: "SETTLED",
        dealerSeatNo: 1,
        seats: [
          { userId: "human_live", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_2", seatNo: 2, status: "ACTIVE", isBot: true },
          { userId: "ghost_human", seatNo: 4, status: "ACTIVE" }
        ],
        stacks: { human_live: 118, bot_2: 102, ghost_human: 100 }
      }
    },
    presenceByUserId: new Map([
      ["human_live", { userId: "human_live", seat: 1 }],
      ["bot_2", { userId: "bot_2", seat: 2 }],
      ["ghost_human", { userId: "ghost_human", seat: 4 }]
    ])
  });

  assert.equal(restored.ok, true);

  let rollover = tableManager.rolloverSettledHand({ tableId, nowMs: 5_000 });

  assert.equal(rollover.ok, true);
  assert.equal(rollover.changed, true);
  let nextState = tableManager.persistedPokerState(tableId);
  assert.deepEqual(nextState.seats, [
    { userId: "human_live", seatNo: 1 },
    { userId: "bot_2", seatNo: 2 }
  ]);
  assert.equal(nextState.foldedByUserId.human_live, false);
  assert.equal(Object.prototype.hasOwnProperty.call(nextState.foldedByUserId, "ghost_human"), false);

  tableManager.cleanupConnection({ ws: wsHuman, userId: "human_live", nowTs: 6_000, activeSockets: [] });
  restored = tableManager.restoreTableFromPersisted(tableId, {
    coreState: {
      version: 12,
      roomId: tableId,
      maxSeats: 6,
      appliedRequestIds: [],
      members: [
        { userId: "human_live", seat: 1 },
        { userId: "bot_2", seat: 2 },
        { userId: "ghost_human", seat: 4 }
      ],
      seats: { human_live: 1, bot_2: 2, ghost_human: 4 },
      publicStacks: { human_live: 116, bot_2: 104, ghost_human: 100 },
      seatDetailsByUserId: {
        human_live: { isBot: false, botProfile: null, leaveAfterHand: false },
        bot_2: { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false },
        ghost_human: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: {
        tableId,
        handId: "hand_rollover_gate_2",
        phase: "SETTLED",
        dealerSeatNo: 2,
        seats: [
          { userId: "human_live", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_2", seatNo: 2, status: "ACTIVE", isBot: true },
          { userId: "ghost_human", seatNo: 4, status: "ACTIVE" }
        ],
        stacks: { human_live: 116, bot_2: 104, ghost_human: 100 }
      }
    },
    presenceByUserId: new Map([
      ["human_live", { userId: "human_live", seat: 1 }],
      ["bot_2", { userId: "bot_2", seat: 2 }],
      ["ghost_human", { userId: "ghost_human", seat: 4 }]
    ])
  });

  assert.equal(restored.ok, true);

  rollover = tableManager.rolloverSettledHand({ tableId, nowMs: 6_050 });

  assert.equal(rollover.ok, true);
  assert.equal(rollover.changed, true);
  nextState = tableManager.persistedPokerState(tableId);
  assert.equal(nextState.phase, "PREFLOP");
  assert.deepEqual(nextState.seats, [
    { userId: "human_live", seatNo: 1 },
    { userId: "bot_2", seatNo: 2 }
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(nextState.foldedByUserId, "ghost_human"), false);
});

test("rolloverSettledHand excludes runtime-disconnected humans from pure-human next hands", () => {
  const tableManager = createTableManager({ maxSeats: 4, presenceTtlMs: 10_000 });
  const tableId = "table_rollover_pure_human_disconnect_gate";
  const wsA = fakeWs("ws-rollover-pure-human-a");
  const wsB = fakeWs("ws-rollover-pure-human-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "human_a", tableId, requestId: "join-pure-human-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "human_b", tableId, requestId: "join-pure-human-b", nowTs: 2 }).ok, true);

  const restored = tableManager.restoreTableFromPersisted(tableId, {
    coreState: {
      version: 15,
      roomId: tableId,
      maxSeats: 4,
      appliedRequestIds: [],
      members: [
        { userId: "human_a", seat: 1 },
        { userId: "human_b", seat: 2 }
      ],
      seats: { human_a: 1, human_b: 2 },
      publicStacks: { human_a: 118, human_b: 102 },
      seatDetailsByUserId: {
        human_a: { isBot: false, botProfile: null, leaveAfterHand: false },
        human_b: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: {
        tableId,
        handId: "hand_rollover_pure_human_gate",
        phase: "SETTLED",
        dealerSeatNo: 1,
        seats: [
          { userId: "human_a", seatNo: 1, status: "ACTIVE" },
          { userId: "human_b", seatNo: 2, status: "ACTIVE" }
        ],
        stacks: { human_a: 118, human_b: 102 }
      }
    },
    presenceByUserId: new Map([
      ["human_a", { userId: "human_a", seat: 1 }],
      ["human_b", { userId: "human_b", seat: 2 }]
    ])
  });

  assert.equal(restored.ok, true);

  tableManager.cleanupConnection({ ws: wsA, userId: "human_a", nowTs: 3_000, activeSockets: [] });
  const rollover = tableManager.rolloverSettledHand({ tableId, nowMs: 3_050 });

  assert.equal(rollover.ok, true);
  assert.equal(rollover.changed, false);
  assert.equal(rollover.reason, "not_enough_players");
  const nextState = tableManager.persistedPokerState(tableId);
  assert.equal(nextState.phase, "SETTLED");
});

test("bootstrapHand keeps cold-restored human placeholders eligible when expiresAt is null", () => {
  const tableManager = createTableManager({ maxSeats: 4, presenceTtlMs: 10_000 });
  const tableId = "table_bootstrap_cold_restore_placeholder";
  const wsA = fakeWs("ws-bootstrap-cold-restore-a");

  const restored = tableManager.restoreTableFromPersisted(tableId, {
    coreState: {
      version: 12,
      roomId: tableId,
      maxSeats: 4,
      appliedRequestIds: [],
      members: [
        { userId: "human_a", seat: 1 },
        { userId: "human_b", seat: 2 }
      ],
      seats: { human_a: 1, human_b: 2 },
      publicStacks: { human_a: 100, human_b: 100 },
      seatDetailsByUserId: {
        human_a: { isBot: false, botProfile: null, leaveAfterHand: false },
        human_b: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: null
    },
    presenceByUserId: new Map([
      ["human_a", { userId: "human_a", seat: 1, connected: false, lastSeenAt: null, expiresAt: null }],
      ["human_b", { userId: "human_b", seat: 2, connected: false, lastSeenAt: null, expiresAt: null }]
    ])
  });

  assert.equal(restored.ok, true);
  assert.equal(tableManager.join({ ws: wsA, userId: "human_a", tableId, requestId: "join-cold-restore-a", nowTs: 100 }).ok, true);

  const bootstrapped = tableManager.bootstrapHand(tableId, { nowMs: 150 });

  assert.equal(bootstrapped.ok, true);
  assert.equal(bootstrapped.changed, true);
  assert.equal(tableManager.persistedPokerState(tableId).phase, "PREFLOP");
  assert.deepEqual(memberPairs(tableManager.tableSnapshot(tableId, "human_a").members), [["human_a", 1], ["human_b", 2]]);
});

test("persistedPokerState keeps runtime private cards available for autoplay", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const tableId = "table_persisted_public_state";

  const restored = tableManager.restoreTableFromPersisted(tableId, {
    coreState: {
      version: 7,
      roomId: tableId,
      maxSeats: 6,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      seats: { user_a: 1, user_b: 2 },
      publicStacks: { user_a: 102, user_b: 98 },
      seatDetailsByUserId: {
        user_a: { isBot: false, botProfile: null, leaveAfterHand: false },
        user_b: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: {
        tableId,
        handId: "hand_public_state",
        handSeed: "seed_public_state",
        phase: "TURN",
        dealerSeatNo: 1,
        communityDealt: 4,
        community: ["AS", "KS", "QS", "JD"],
        seats: [
          { userId: "user_a", seatNo: 1, status: "ACTIVE" },
          { userId: "user_b", seatNo: 2, status: "ACTIVE" }
        ],
        stacks: { user_a: 102, user_b: 98 },
        holeCardsByUserId: { user_a: ["AH", "AD"], user_b: ["2C", "2D"] },
        deck: ["TC"]
      }
    },
    presenceByUserId: new Map()
  });

  assert.equal(restored.ok, true);
  const persistedState = tableManager.persistedPokerState(tableId);
  assert.equal(persistedState.handSeed, "seed_public_state");
  assert.deepEqual(persistedState.holeCardsByUserId, { user_a: ["AH", "AD"], user_b: ["2C", "2D"] });
  assert.deepEqual(persistedState.deck, ["TC"]);
});

test("evictTable removes restored runtime table state", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const tableId = "table_evict_runtime";

  const restored = tableManager.restoreTableFromPersisted(tableId, {
    tableId,
    tableStatus: "CLOSED",
    coreState: {
      version: 3,
      roomId: tableId,
      maxSeats: 6,
      members: [{ userId: "bot_a", seat: 1 }],
      seats: { bot_a: 1 },
      publicStacks: { bot_a: 50 },
      seatDetailsByUserId: {
        bot_a: { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false }
      },
      pokerState: {
        tableId,
        phase: "HAND_DONE",
        seats: [{ userId: "bot_a", seatNo: 1, isBot: true }],
        stacks: { bot_a: 50 }
      }
    },
    presenceByUserId: new Map()
  });

  assert.equal(restored.ok, true);
  assert.equal(tableManager.listTableIds().includes(tableId), true);
  assert.equal(tableManager.evictTable(tableId).existed, true);
  assert.equal(tableManager.listTableIds().includes(tableId), false);
  assert.deepEqual(tableManager.tableState(tableId), { tableId, members: [] });
});

test("table manager exposes connected members as sorted {userId, seat} and reuses freed seats", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 0 });
  const ws1 = fakeWs("ws-1");
  const ws2 = fakeWs("ws-2");
  const ws3 = fakeWs("ws-3");

  const join1 = tableManager.join({ ws: ws1, userId: "user_1", tableId: "table_A", requestId: "join-1", nowTs: 100 });
  const join2 = tableManager.join({ ws: ws2, userId: "user_2", tableId: "table_A", requestId: "join-2", nowTs: 100 });
  assert.equal(join1.ok, true);
  assert.equal(join2.ok, true);

  const leave2 = tableManager.leave({ ws: ws2, userId: "user_2", tableId: "table_A", requestId: "leave-2" });
  assert.equal(leave2.ok, true);

  const join3 = tableManager.join({ ws: ws3, userId: "user_3", tableId: "table_A", requestId: "join-3", nowTs: 100 });
  assert.equal(join3.ok, true);

  const snapshot = tableManager.tableState("table_A");
  assert.deepEqual(memberPairs(snapshot.members), [
    ["user_1", 1],
    ["user_3", 2]
  ]);

  const join2Again = tableManager.join({ ws: ws2, userId: "user_2", tableId: "table_A", requestId: "join-2-again", nowTs: 100 });
  assert.equal(join2Again.ok, true);
  assert.deepEqual(memberPairs(tableManager.tableState("table_A").members), [
    ["user_1", 1],
    ["user_3", 2],
    ["user_2", 3]
  ]);
});

test("table manager authoritative join bumps version only for material membership/public stack changes", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const ws = fakeWs("ws-authoritative-version");
  const tableId = "table_authoritative_version";

  assert.equal(tableManager.tableSnapshot(tableId, "user_authoritative").stateVersion, 0);

  const firstJoin = tableManager.join({
    ws,
    userId: "user_authoritative",
    tableId,
    requestId: "join-authoritative-1",
    nowTs: 100,
    authoritativeSeatNo: 4,
    buyIn: 175
  });

  assert.equal(firstJoin.ok, true);
  assert.equal(firstJoin.changed, true);
  assert.equal(tableManager.tableSnapshot(tableId, "user_authoritative").stateVersion, 1);
  assert.deepEqual(tableManager.tableSnapshot(tableId, "user_authoritative").stacks, { user_authoritative: 175 });

  const replayJoin = tableManager.join({
    ws,
    userId: "user_authoritative",
    tableId,
    requestId: "join-authoritative-2",
    nowTs: 101,
    authoritativeSeatNo: 4,
    buyIn: 175
  });

  assert.equal(replayJoin.ok, true);
  assert.equal(replayJoin.changed, false);
  assert.equal(tableManager.tableSnapshot(tableId, "user_authoritative").stateVersion, 1);

  const stackRefresh = tableManager.join({
    ws,
    userId: "user_authoritative",
    tableId,
    requestId: "join-authoritative-3",
    nowTs: 102,
    authoritativeSeatNo: 4,
    buyIn: 220
  });

  assert.equal(stackRefresh.ok, true);
  assert.equal(stackRefresh.changed, true);
  assert.equal(tableManager.tableSnapshot(tableId, "user_authoritative").stateVersion, 2);
  assert.deepEqual(tableManager.tableSnapshot(tableId, "user_authoritative").stacks, { user_authoritative: 220 });
});

test("table manager authoritative attach uses provided authoritativeSeatNo without local recompute", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const ws = fakeWs("ws-authoritative-attach");

  const joined = tableManager.join({
    ws,
    userId: "user_authoritative",
    tableId: "table_authoritative_attach",
    requestId: "join-authoritative",
    nowTs: 100,
    authoritativeSeatNo: 4
  });

  assert.equal(joined.ok, true);
  assert.deepEqual(memberPairs(joined.tableState.members), [["user_authoritative", 4]]);
  assert.deepEqual(memberPairs(tableManager.tableState("table_authoritative_attach").members), [["user_authoritative", 4]]);
});

test("table manager authoritative attach normalizes existing in-memory seat to authoritative seat", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const ws = fakeWs("ws-authoritative-normalize");

  const initial = tableManager.join({ ws, userId: "user_norm", tableId: "table_authoritative_normalize", requestId: "join-local", nowTs: 1 });
  assert.equal(initial.ok, true);
  assert.deepEqual(memberPairs(tableManager.tableState("table_authoritative_normalize").members), [["user_norm", 1]]);

  const normalized = tableManager.join({
    ws,
    userId: "user_norm",
    tableId: "table_authoritative_normalize",
    requestId: "join-authoritative-norm",
    nowTs: 2,
    authoritativeSeatNo: 2
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.changed, true);
  assert.deepEqual(memberPairs(normalized.tableState.members), [["user_norm", 2]]);
  assert.deepEqual(memberPairs(tableManager.tableState("table_authoritative_normalize").members), [["user_norm", 2]]);
});







test("syncAuthoritativeLeave removes member in-memory without persistence side-effects and is idempotent", () => {
  const tableId = "table_sync_leave";
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsMember = fakeWs("ws-sync-member");
  const wsOther = fakeWs("ws-sync-other");

  const joinMember = tableManager.join({ ws: wsMember, userId: "user_leave", tableId, requestId: "join-sync-1", nowTs: 1 });
  const joinOther = tableManager.join({ ws: wsOther, userId: "user_stay", tableId, requestId: "join-sync-2", nowTs: 2 });
  assert.equal(joinMember.ok, true);
  assert.equal(joinOther.ok, true);

  const synced = tableManager.syncAuthoritativeLeave({
    ws: wsMember,
    userId: "user_leave",
    tableId,
    stateVersion: 7,
    pokerState: {
      tableId,
      seats: [{ seatNo: 2, userId: "user_stay" }],
      stacks: { user_stay: 100 },
      phase: "INIT"
    }
  });

  assert.equal(synced.ok, true);
  assert.equal(synced.changed, true);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [["user_stay", 2]]);

  const replayed = tableManager.syncAuthoritativeLeave({
    ws: wsMember,
    userId: "user_leave",
    tableId,
    stateVersion: 7,
    pokerState: {
      tableId,
      seats: [{ seatNo: 2, userId: "user_stay" }],
      stacks: { user_stay: 100 },
      phase: "INIT"
    }
  });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.changed, false);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [["user_stay", 2]]);
});



test("syncAuthoritativeLeave tolerates seat compatibility alias", () => {
  const tableId = "table_sync_leave_alias";
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsMember = fakeWs("ws-sync-alias-member");
  const wsOther = fakeWs("ws-sync-alias-other");

  tableManager.join({ ws: wsMember, userId: "user_leave", tableId, requestId: "join-sync-alias-1", nowTs: 1 });
  tableManager.join({ ws: wsOther, userId: "user_stay", tableId, requestId: "join-sync-alias-2", nowTs: 2 });

  const synced = tableManager.syncAuthoritativeLeave({
    ws: wsMember,
    userId: "user_leave",
    tableId,
    stateVersion: 9,
    pokerState: {
      tableId,
      seats: [{ seat: 2, userId: "user_stay" }],
      stacks: { user_stay: 100 },
      phase: "INIT"
    }
  });

  assert.equal(synced.ok, true);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [["user_stay", 2]]);
});



test("syncAuthoritativeLeave changed=true when authoritative version/state changes with stable members", () => {
  const tableId = "table_sync_leave_version";
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("ws-sync-version-a");
  const wsB = fakeWs("ws-sync-version-b");

  tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-version-a", nowTs: 1 });
  tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-version-b", nowTs: 2 });

  const synced = tableManager.syncAuthoritativeLeave({
    ws: wsA,
    userId: "user_a",
    tableId,
    stateVersion: 9,
    pokerState: {
      tableId,
      seats: [{ seatNo: 2, userId: "user_b" }],
      phase: "PREFLOP",
      handId: "h-9"
    }
  });

  assert.equal(synced.ok, true);
  assert.equal(synced.changed, true);
  assert.equal(tableManager.__debugCore(tableId).version, 9);
});

test("syncAuthoritativeLeave replay remains changed=false for identical authoritative state", () => {
  const tableId = "table_sync_leave_replay_identical";
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("ws-sync-replay-a");
  const wsB = fakeWs("ws-sync-replay-b");

  tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-replay-a", nowTs: 1 });
  tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-replay-b", nowTs: 2 });

  const state = {
    tableId,
    seats: [{ seatNo: 2, userId: "user_b" }],
    phase: "INIT"
  };

  const first = tableManager.syncAuthoritativeLeave({ ws: wsA, userId: "user_a", tableId, stateVersion: 4, pokerState: state });
  const replay = tableManager.syncAuthoritativeLeave({ ws: wsA, userId: "user_a", tableId, stateVersion: 4, pokerState: state });

  assert.equal(first.changed, true);
  assert.equal(replay.changed, false);
});

test("syncAuthoritativeLeave applies authoritative closed table status", () => {
  const tableId = "table_sync_leave_closed_status";
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("ws-sync-closed-a");
  const wsB = fakeWs("ws-sync-closed-b");

  tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-closed-a", nowTs: 1 });
  tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-closed-b", nowTs: 2 });

  const synced = tableManager.syncAuthoritativeLeave({
    ws: wsA,
    userId: "user_a",
    tableId,
    stateVersion: 4,
    tableStatus: "CLOSED",
    pokerState: {
      tableId,
      seats: [{ seatNo: 2, userId: "user_b" }],
      phase: "HAND_DONE"
    }
  });

  assert.equal(synced.ok, true);
  assert.equal(synced.changed, true);
  assert.equal(tableManager.isTableClosed(tableId), true);
});

test("syncAuthoritativeLeave intentionally drops caller subscription while preserving non-leaving observer", () => {
  const tableId = "table_sync_leave_subscription_policy";
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsLeave = fakeWs("ws-sync-leaver");
  const wsObserver = fakeWs("ws-sync-observer");

  tableManager.join({ ws: wsLeave, userId: "user_leave", tableId, requestId: "join-sub-leaver", nowTs: 1 });
  tableManager.join({ ws: wsObserver, userId: "user_keep", tableId, requestId: "join-sub-observer", nowTs: 2 });

  tableManager.syncAuthoritativeLeave({
    ws: wsLeave,
    userId: "user_leave",
    tableId,
    stateVersion: 5,
    pokerState: {
      tableId,
      seats: [{ seatNo: 2, userId: "user_keep" }],
      phase: "INIT"
    }
  });

  const connections = tableManager.orderedConnectionsForTable(tableId, (socket) => socket.id || "");
  assert.deepEqual(connections, [wsObserver]);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [["user_keep", 2]]);
});



test("table presence helpers distinguish seated humans from connected observers", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const tableId = "table_presence_helpers";
  const wsSeat = fakeWs("ws-presence-seat");
  const wsObserver = fakeWs("ws-presence-observer");

  tableManager.join({ ws: wsSeat, userId: "human_user", tableId, requestId: "join-presence-seat", nowTs: 1 });
  tableManager.subscribe({ ws: wsObserver, tableId });

  assert.equal(tableManager.hasActiveHumanMember(tableId), true);
  assert.equal(tableManager.hasConnectedHumanPresence(tableId), true);

  const left = tableManager.leave({ ws: wsSeat, userId: "human_user", tableId, requestId: "leave-presence-seat" });
  assert.equal(left.ok, true);
  assert.equal(tableManager.hasActiveHumanMember(tableId), false);
  assert.equal(tableManager.hasConnectedHumanPresence(tableId), true);

  const observerLeft = tableManager.leave({ ws: wsObserver, userId: "observer_user", tableId, requestId: "leave-presence-observer" });
  assert.equal(observerLeft.ok, true);
  assert.equal(tableManager.hasConnectedHumanPresence(tableId), false);
});

test("table presence helpers ignore session-invalidated stale sockets", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const tableId = "table_presence_invalidated";
  const wsObserver = fakeWs("ws-presence-invalidated");

  tableManager.subscribe({ ws: wsObserver, tableId });
  assert.equal(tableManager.hasConnectedHumanPresence(tableId), true);

  wsObserver.__connState = { sessionInvalidated: true };
  assert.equal(tableManager.hasConnectedHumanPresence(tableId), false);
});

test("observer disconnect from settled table emits update so rollover can re-evaluate presence", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const tableId = "table_settled_observer_disconnect";
  const wsObserver = fakeWs("ws-settled-observer");

  tableManager.subscribe({ ws: wsObserver, tableId });
  tableManager.restoreTableFromPersisted(tableId, {
    tableStatus: "OPEN",
    coreState: {
      version: 5,
      roomId: tableId,
      maxSeats: 4,
      appliedRequestIds: [],
      members: [{ userId: "bot_1", seat: 1 }],
      seats: { bot_1: 1 },
      publicStacks: { bot_1: 100 },
      seatDetailsByUserId: {
        bot_1: { isBot: true, botProfile: null, leaveAfterHand: false }
      },
      pokerState: {
        tableId,
        phase: "SETTLED",
        seats: [{ userId: "bot_1", seatNo: 1, isBot: true }],
        stacks: { bot_1: 100 },
        handSettlement: { settledAt: "2026-04-14T10:00:00.000Z" }
      }
    },
    presenceByUserId: new Map()
  });

  const updates = tableManager.cleanupConnection({ ws: wsObserver, userId: "observer_user", nowTs: 10, activeSockets: [] });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].tableId, tableId);
  assert.equal(tableManager.hasConnectedHumanPresence(tableId), false);
});

test("syncAuthoritativeLeave rejects mismatched authoritative tableId without mutating state", () => {
  const tableId = "table_sync_leave_mismatch";
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsLeave = fakeWs("ws-sync-mismatch-leave");
  const wsKeep = fakeWs("ws-sync-mismatch-keep");

  tableManager.join({ ws: wsLeave, userId: "user_leave", tableId, requestId: "join-mismatch-leave", nowTs: 1 });
  tableManager.join({ ws: wsKeep, userId: "user_keep", tableId, requestId: "join-mismatch-keep", nowTs: 2 });

  const before = tableManager.__debugCore(tableId);
  const result = tableManager.syncAuthoritativeLeave({
    ws: wsLeave,
    userId: "user_leave",
    tableId,
    stateVersion: 99,
    pokerState: {
      tableId: "table_other",
      seats: [{ seatNo: 2, userId: "user_keep" }],
      phase: "INIT"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "authoritative_state_invalid");
  assert.equal(result.changed, false);
  assert.deepEqual(tableManager.__debugCore(tableId), before);
});

test("syncAuthoritativeLeave rejects malformed seats payload without mutating state", () => {
  const tableId = "table_sync_leave_bad_seats";
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsLeave = fakeWs("ws-sync-bad-seats-leave");
  const wsKeep = fakeWs("ws-sync-bad-seats-keep");

  tableManager.join({ ws: wsLeave, userId: "user_leave", tableId, requestId: "join-bad-seats-leave", nowTs: 1 });
  tableManager.join({ ws: wsKeep, userId: "user_keep", tableId, requestId: "join-bad-seats-keep", nowTs: 2 });

  const before = tableManager.__debugCore(tableId);
  const beforeConnections = tableManager.orderedConnectionsForTable(tableId, (socket) => socket.id || "");

  const result = tableManager.syncAuthoritativeLeave({
    ws: wsLeave,
    userId: "user_leave",
    tableId,
    stateVersion: 7,
    pokerState: {
      tableId,
      seats: null,
      phase: "INIT"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "authoritative_state_invalid");
  assert.equal(result.changed, false);
  assert.deepEqual(tableManager.__debugCore(tableId), before);
  assert.deepEqual(tableManager.orderedConnectionsForTable(tableId, (socket) => socket.id || ""), beforeConnections);
});

test("syncAuthoritativeLeave rejects invalid seat entries without mutating state", () => {
  const tableId = "table_sync_leave_bad_entries";
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsLeave = fakeWs("ws-sync-bad-entry-leave");
  const wsKeep = fakeWs("ws-sync-bad-entry-keep");

  tableManager.join({ ws: wsLeave, userId: "user_leave", tableId, requestId: "join-bad-entry-leave", nowTs: 1 });
  tableManager.join({ ws: wsKeep, userId: "user_keep", tableId, requestId: "join-bad-entry-keep", nowTs: 2 });

  const before = tableManager.__debugCore(tableId);

  const result = tableManager.syncAuthoritativeLeave({
    ws: wsLeave,
    userId: "user_leave",
    tableId,
    stateVersion: 8,
    pokerState: {
      tableId,
      seats: [{ seatNo: "not-an-int", userId: "user_keep" }, { seatNo: 2, userId: "" }],
      phase: "INIT"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "authoritative_state_invalid");
  assert.equal(result.changed, false);
  assert.deepEqual(tableManager.__debugCore(tableId), before);
});

test("syncAuthoritativeLeave rejects seats that still contain leaving user without mutating state", () => {
  const tableId = "table_sync_leave_still_present";
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsLeave = fakeWs("ws-sync-still-present-leave");
  const wsKeep = fakeWs("ws-sync-still-present-keep");

  tableManager.join({ ws: wsLeave, userId: "user_leave", tableId, requestId: "join-still-present-leave", nowTs: 1 });
  tableManager.join({ ws: wsKeep, userId: "user_keep", tableId, requestId: "join-still-present-keep", nowTs: 2 });

  const beforeCore = tableManager.__debugCore(tableId);
  const beforeConnections = tableManager.orderedConnectionsForTable(tableId, (socket) => socket.id || "");
  const beforeMembers = tableManager.tableState(tableId).members;

  const result = tableManager.syncAuthoritativeLeave({
    ws: wsLeave,
    userId: "user_leave",
    tableId,
    stateVersion: 9,
    pokerState: {
      tableId,
      seats: [
        { seatNo: 1, userId: "user_leave" },
        { seatNo: 2, userId: "user_keep" }
      ],
      phase: "INIT"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "authoritative_state_invalid");
  assert.equal(result.changed, false);
  assert.deepEqual(tableManager.__debugCore(tableId), beforeCore);
  assert.deepEqual(tableManager.orderedConnectionsForTable(tableId, (socket) => socket.id || ""), beforeConnections);
  assert.deepEqual(tableManager.tableState(tableId).members, beforeMembers);
});

test("observeOnlyJoin rejects second different table on same socket and keeps original subscription", async () => {
  const tableManager = createTableManager({ maxSeats: 4, observeOnlyJoin: true });
  const ws = fakeWs("ws-observer-one-table");

  const joinA = tableManager.join({ ws, userId: "observer_user", tableId: "table_A", requestId: "join-a", nowTs: 10 });
  assert.equal(joinA.ok, true);

  const joinB = tableManager.join({ ws, userId: "observer_user", tableId: "table_B", requestId: "join-b", nowTs: 11 });
  assert.equal(joinB.ok, false);
  assert.equal(joinB.code, "one_table_per_connection");

  const resyncB = tableManager.resync({ ws, userId: "observer_user", tableId: "table_B", nowTs: 12 });
  assert.equal(resyncB.ok, false);
  assert.equal(resyncB.code, "one_table_per_connection");

  const rejoinA = tableManager.join({ ws, userId: "observer_user", tableId: "table_A", requestId: "join-a-2", nowTs: 13 });
  assert.equal(rejoinA.ok, true);
  assert.deepEqual(memberPairs(rejoinA.tableState.members), []);

  const leaveA = tableManager.leave({ ws, userId: "observer_user", tableId: "table_A", requestId: "leave-a" });
  assert.equal(leaveA.ok, true);
  assert.deepEqual(memberPairs(tableManager.tableState("table_B").members), []);
});


test("observeOnlyJoin seated leave remains authoritative and idempotent", async () => {
  const tableId = "table_seated_leave_authoritative";
  const tableManager = createTableManager({
    observeOnlyJoin: true,
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => ({
      ok: true,
      table: {
        tableId: loadedTableId,
        coreState: {
          version: 3,
          roomId: loadedTableId,
          maxSeats: 4,
          appliedRequestIds: [],
          members: [{ userId: "seat_user", seat: 2 }],
          seats: { seat_user: 2 },
          pokerState: null
        },
        presenceByUserId: new Map([["seat_user", { userId: "seat_user", seat: 2, connected: true, lastSeenAt: 1, expiresAt: null }]]),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      }
    })
  });

  const ws = fakeWs("ws-seat-authoritative-leave");
  await tableManager.ensureTableLoaded(tableId);

  const joined = tableManager.join({ ws, userId: "seat_user", tableId, requestId: "join-seat", nowTs: 10 });
  assert.equal(joined.ok, true);
  assert.deepEqual(memberPairs(joined.tableState.members), [["seat_user", 2]]);

  const left = tableManager.leave({ ws, userId: "seat_user", tableId, requestId: "leave-seat" });
  assert.equal(left.ok, true);
  assert.equal(left.effects.some((effect) => effect.type === "member_left"), true);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), []);

  const resynced = tableManager.resync({ ws, userId: "seat_user", tableId, nowTs: 11 });
  assert.equal(resynced.ok, true);
  assert.deepEqual(memberPairs(resynced.tableState.members), []);

  const leftAgain = tableManager.leave({ ws, userId: "seat_user", tableId, requestId: "leave-seat-again" });
  assert.equal(leftAgain.ok, true);
  assert.equal(leftAgain.changed, false);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), []);
});
test("observeOnlyJoin keeps non-member join transport-only and idempotent", async () => {
  const tableId = "table_observe_only";
  const tableManager = createTableManager({
    maxSeats: 4,
    observeOnlyJoin: true,
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => ({
      ok: true,
      table: {
        tableId: loadedTableId,
        coreState: {
          version: 1,
          roomId: loadedTableId,
          maxSeats: 4,
          appliedRequestIds: [],
          members: [{ userId: "seat_user", seat: 1 }],
          seats: { seat_user: 1 },
          pokerState: null
        },
        presenceByUserId: new Map([["seat_user", { userId: "seat_user", seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }]]),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      }
    })
  });
  const wsObserver = fakeWs("ws-observer");

  const ensured = await tableManager.ensureTableLoaded(tableId);
  assert.equal(ensured.ok, true);

  const firstObserve = tableManager.join({ ws: wsObserver, userId: "observer_user", tableId, requestId: "observe-1", nowTs: 20 });
  assert.equal(firstObserve.ok, true);
  assert.equal(firstObserve.changed, false);
  assert.deepEqual(memberPairs(firstObserve.tableState.members), [["seat_user", 1]]);

  const secondObserve = tableManager.join({ ws: wsObserver, userId: "observer_user", tableId, requestId: "observe-2", nowTs: 21 });
  assert.equal(secondObserve.ok, true);
  assert.equal(secondObserve.changed, false);
  assert.deepEqual(memberPairs(secondObserve.tableState.members), [["seat_user", 1]]);
});

test("table manager does not expose __debugCore by default even when nodeEnv is test", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, nodeEnv: "test" });
  assert.equal(tableManager.__debugCore, undefined);
});

test("table manager does not expose __debugCore when nodeEnv is production even if enableDebugCore is true", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "production" });
  assert.equal(tableManager.__debugCore, undefined);
});

test("__debugCore is exposed only when enableDebugCore is true and nodeEnv is non-production", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  assert.equal(typeof tableManager.__debugCore, "function");

  const ws = fakeWs("ws-debug-core");
  const joined = tableManager.join({ ws, userId: "user_debug", tableId: "table_debug", requestId: "join-debug", nowTs: 50 });
  assert.equal(joined.ok, true);
  assert.deepEqual(tableManager.__debugCore("table_debug"), {
    version: 1,
    appliedRequestIdsLength: 1,
    actionResultsCacheSize: 0
  });
});

test("repeated maintenance with identical nowTs does not bump core version or appliedRequestIds", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  const wsMember = fakeWs("ws-member");
  const wsObserver = fakeWs("ws-observer");

  assert.equal(typeof tableManager.__debugCore, "function");

  const joined = tableManager.join({ ws: wsMember, userId: "user_1", tableId: "table_B", requestId: "join-1", nowTs: 10 });
  assert.equal(joined.ok, true);

  const subscribed = tableManager.subscribe({ ws: wsObserver, tableId: "table_B" });
  assert.equal(subscribed.ok, true);

  const disconnected = tableManager.cleanupConnection({ ws: wsMember, userId: "user_1", nowTs: 20, activeSockets: [] });
  assert.equal(disconnected.length, 1);

  const firstSweep = tableManager.sweepExpiredPresence({ nowTs: 25 });
  assert.equal(firstSweep.length, 0);
  const afterFirstSweep = tableManager.__debugCore("table_B");
  assert.ok(afterFirstSweep);

  const secondSweep = tableManager.sweepExpiredPresence({ nowTs: 25 });
  assert.deepEqual(secondSweep, []);
  const afterSecondSweep = tableManager.__debugCore("table_B");

  assert.deepEqual(afterFirstSweep, afterSecondSweep);
  assert.deepEqual(tableManager.tableState("table_B").members, []);
});

test("maintenance requestIds are collision-safe under identical nowTs", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5 });
  const wsCycle1 = fakeWs("ws-cycle-1");
  const wsCycle2 = fakeWs("ws-cycle-2");

  const firstJoin = tableManager.join({ ws: wsCycle1, userId: "user_1", tableId: "table_C", requestId: "join-1", nowTs: 100 });
  assert.equal(firstJoin.ok, true);

  const firstDisconnect = tableManager.cleanupConnection({ ws: wsCycle1, userId: "user_1", nowTs: 100, activeSockets: [] });
  assert.equal(firstDisconnect.length, 1);

  const firstSweep = tableManager.sweepExpiredPresence({ nowTs: 105 });
  assert.equal(firstSweep.length, 0);
  assert.deepEqual(tableManager.tableState("table_C").members, []);

  const secondJoin = tableManager.join({ ws: wsCycle2, userId: "user_1", tableId: "table_C", requestId: "join-2", nowTs: 100 });
  assert.equal(secondJoin.ok, true);

  const secondDisconnect = tableManager.cleanupConnection({ ws: wsCycle2, userId: "user_1", nowTs: 100, activeSockets: [] });
  assert.equal(secondDisconnect.length, 1);

  const secondSweep = tableManager.sweepExpiredPresence({ nowTs: 105 });
  assert.equal(secondSweep.length, 0);
  assert.deepEqual(tableManager.tableState("table_C").members, []);

  const thirdSweep = tableManager.sweepExpiredPresence({ nowTs: 105 });
  assert.deepEqual(thirdSweep, []);
  assert.deepEqual(tableManager.tableState("table_C").members, []);
});



test("sweepExpiredPresence only prunes local presence and never emits authoritative leave updates", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5 });
  const ws = fakeWs("ws-local-prune");
  const joined = tableManager.join({ ws, userId: "user_local", tableId: "table_local", requestId: "join-local", nowTs: 10 });
  assert.equal(joined.ok, true);
  const cleanupUpdates = tableManager.cleanupConnection({ ws, userId: "user_local", nowTs: 20, activeSockets: [] });
  assert.equal(cleanupUpdates.length, 1, "disconnect scheduling remains server-owned");

  const sweepUpdates = tableManager.sweepExpiredPresence({ nowTs: 30 });
  assert.deepEqual(sweepUpdates, [], "sweepExpiredPresence should not perform authoritative leave updates");
  assert.deepEqual(tableManager.tableState("table_local").members, [], "local presence should still be pruned");
});
test("join on full table is side-effect free and repeatable", () => {
  const tableManager = createTableManager({ maxSeats: 2, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  const ws1 = fakeWs("ws-1");
  const ws2 = fakeWs("ws-2");
  const ws3 = fakeWs("ws-3");
  const tableId = "table_full";

  assert.equal(tableManager.join({ ws: ws1, userId: "user_1", tableId, requestId: "join-1", nowTs: 100 }).ok, true);
  assert.equal(tableManager.join({ ws: ws2, userId: "user_2", tableId, requestId: "join-2", nowTs: 100 }).ok, true);

  const beforeReject = tableManager.__debugCore(tableId);
  assert.ok(beforeReject);

  const join3 = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-3", nowTs: 100 });
  assert.equal(join3.ok, false);
  assert.equal(join3.code, "bounds_exceeded");

  const afterReject = tableManager.__debugCore(tableId);
  assert.equal(afterReject?.version, beforeReject?.version);
  assert.equal(afterReject?.appliedRequestIdsLength, beforeReject?.appliedRequestIdsLength);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_2", 2]
  ]);

  const join3Again = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-3", nowTs: 100 });
  assert.equal(join3Again.ok, false);
  assert.equal(join3Again.code, "bounds_exceeded");
  const afterSameRequestReject = tableManager.__debugCore(tableId);
  assert.equal(afterSameRequestReject?.version, beforeReject?.version);
  assert.equal(afterSameRequestReject?.appliedRequestIdsLength, beforeReject?.appliedRequestIdsLength);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_2", 2]
  ]);

  const join3DifferentRequestId = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-3b", nowTs: 100 });
  assert.equal(join3DifferentRequestId.ok, false);
  assert.equal(join3DifferentRequestId.code, "bounds_exceeded");
  const afterDifferentRequestReject = tableManager.__debugCore(tableId);
  assert.equal(afterDifferentRequestReject?.version, beforeReject?.version);
  assert.equal(afterDifferentRequestReject?.appliedRequestIdsLength, beforeReject?.appliedRequestIdsLength);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_2", 2]
  ]);
});

test("join reject does not record requestId as applied and does not block future successful join", () => {
  const tableManager = createTableManager({ maxSeats: 2, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  const ws1 = fakeWs("ws-a");
  const ws2 = fakeWs("ws-b");
  const ws3 = fakeWs("ws-c");
  const tableId = "table_reject_recover";

  assert.equal(tableManager.join({ ws: ws1, userId: "user_1", tableId, requestId: "join-a", nowTs: 100 }).ok, true);
  assert.equal(tableManager.join({ ws: ws2, userId: "user_2", tableId, requestId: "join-b", nowTs: 100 }).ok, true);

  const beforeReject = tableManager.__debugCore(tableId);
  assert.ok(beforeReject);

  const rejected = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-reject", nowTs: 100 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "bounds_exceeded");
  assert.deepEqual(tableManager.__debugCore(tableId), beforeReject);

  const left = tableManager.leave({ ws: ws2, userId: "user_2", tableId, requestId: "leave-b" });
  assert.equal(left.ok, true);

  const accepted = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-reject", nowTs: 101 });
  assert.equal(accepted.ok, true);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_3", 2]
  ]);
});

test("tableSnapshot is read-only and deterministic", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("snap-a");
  const wsB = fakeWs("snap-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_snap", requestId: "join-a", nowTs: 10 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_snap", requestId: "join-b", nowTs: 11 }).ok, true);

  const before = tableManager.__debugCore("table_snap");
  const snapshot1 = tableManager.tableSnapshot("table_snap", "user_a");
  const snapshot2 = tableManager.tableSnapshot("table_snap", "user_a");
  const after = tableManager.__debugCore("table_snap");

  assert.deepEqual(snapshot1, snapshot2);
  assert.deepEqual(before, after);
  assert.deepEqual(snapshot1.hand, { handId: null, status: "LOBBY", round: null, dealerSeatNo: null });
  assert.deepEqual(snapshot1.board, { cards: [] });
  assert.deepEqual(snapshot1.turn, { userId: "user_a", seat: 1, startedAt: null, deadlineAt: null });
  assert.deepEqual(snapshot1.legalActions, { seat: null, actions: [] });
  assert.deepEqual(snapshot1.private, { userId: "user_a", seat: 1, holeCards: [] });
});

test("tableSnapshot for missing table returns canonical placeholders", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });

  const snapshot = tableManager.tableSnapshot("missing_table", "observer");

  assert.equal(snapshot.tableId, "missing_table");
  assert.equal(snapshot.roomId, "missing_table");
  assert.equal(snapshot.stateVersion, 0);
  assert.equal(snapshot.memberCount, 0);
  assert.deepEqual(snapshot.members, []);
  assert.equal(snapshot.youSeat, null);
  assert.deepEqual(snapshot.hand, { handId: null, status: "EMPTY", round: null, dealerSeatNo: null });
  assert.deepEqual(snapshot.board, { cards: [] });
  assert.deepEqual(snapshot.pot, { total: 0, sidePots: [] });
  assert.deepEqual(snapshot.turn, { userId: null, seat: null, startedAt: null, deadlineAt: null });
  assert.equal(snapshot.private, null);
  assert.deepEqual(snapshot.legalActions, { seat: null, actions: [] });
  assert.equal(tableManager.__debugCore("missing_table"), null);
});

test("tableSnapshot memberCount matches authoritative members after disconnect cleanup", () => {
  const tableManager = createTableManager({ maxSeats: 4, presenceTtlMs: 10, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("disc-a");
  const wsB = fakeWs("disc-b");
  const tableId = "table_disconnect_snapshot";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 100 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 100 }).ok, true);

  const before = tableManager.__debugCore(tableId);
  const updates = tableManager.cleanupConnection({ ws: wsB, userId: "user_b", nowTs: 101, activeSockets: [] });
  assert.equal(updates.length, 1);

  const snapshot = tableManager.tableSnapshot(tableId, "observer_user");
  const after = tableManager.__debugCore(tableId);

  assert.deepEqual(snapshot.members, [
    { userId: "user_a", seat: 1 },
    { userId: "user_b", seat: 2 }
  ]);
  assert.equal(snapshot.memberCount, snapshot.members.length);
  assert.deepEqual(after, before);
});

test("subscribe keeps tableState.members presence-based while tableSnapshot.members remains authoritative", async () => {
  const tableId = "table_subscribe_authoritative";
  const wsObserver = fakeWs("ws-subscribe-authoritative");
  const tableManager = createTableManager({
    maxSeats: 6,
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => ({
      ok: true,
      table: {
        tableId: loadedTableId,
        coreState: {
          roomId: loadedTableId,
          version: 11,
          members: [
            { userId: "seed_user_a", seat: 1 },
            { userId: "seed_user_b", seat: 3 }
          ],
          seats: { seed_user_a: 1, seed_user_b: 3 },
          pokerState: { tableId: loadedTableId, phase: "TURN", turnUserId: "seed_user_a" },
          appliedRequestIds: []
        },
        presenceByUserId: new Map(),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      }
    })
  });

  const ensured = await tableManager.ensureTableLoaded(tableId);
  assert.equal(ensured.ok, true);

  const first = tableManager.subscribe({ ws: wsObserver, tableId });
  const second = tableManager.subscribe({ ws: wsObserver, tableId });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(memberPairs(first.tableState.members), []);
  assert.deepEqual(memberPairs(second.tableState.members), []);

  const snapshot = tableManager.tableSnapshot(tableId, "observer_user");
  assert.deepEqual(memberPairs(snapshot.members), [
    ["seed_user_a", 1],
    ["seed_user_b", 3]
  ]);
});


test("bootstrapHand starts PREFLOP once and remains idempotent for live hand", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("boot-a");
  const wsB = fakeWs("boot-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_boot", requestId: "join-a", nowTs: 10 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_boot", requestId: "join-b", nowTs: 10 }).ok, true);

  const first = tableManager.bootstrapHand("table_boot");
  const firstSnapshot = tableManager.tableSnapshot("table_boot", "user_a");
  const second = tableManager.bootstrapHand("table_boot");
  const secondSnapshot = tableManager.tableSnapshot("table_boot", "user_a");

  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.bootstrap, "started");
  assert.equal(firstSnapshot.hand.status, "PREFLOP");
  assert.equal(typeof firstSnapshot.hand.handId, "string");
  assert.ok(firstSnapshot.hand.handId.length > 0);
  assert.equal(firstSnapshot.turn.userId, "user_a");
  assert.deepEqual(firstSnapshot.pot, { total: 3, sidePots: [] });
  assert.deepEqual(firstSnapshot.legalActions, { seat: 1, actions: ["FOLD", "CALL", "RAISE"] });
  assert.equal(Array.isArray(firstSnapshot.private?.holeCards), true);
  assert.equal(firstSnapshot.private.holeCards.length, 2);

  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.bootstrap, "already_live");
  assert.equal(second.handId, first.handId);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.deepEqual(secondSnapshot, firstSnapshot);
});


test("bootstrapHand uses seed-derived shuffled deck and can vary by effective seed", () => {
  const managerA = createTableManager({ maxSeats: 4 });
  const managerB = createTableManager({ maxSeats: 4 });
  const wsA1 = fakeWs("seed-a1");
  const wsA2 = fakeWs("seed-a2");
  const wsB1 = fakeWs("seed-b1");
  const wsB2 = fakeWs("seed-b2");

  assert.equal(managerA.join({ ws: wsA1, userId: "user_a", tableId: "table_seed_a", requestId: "join-a1" }).ok, true);
  assert.equal(managerA.join({ ws: wsA2, userId: "user_b", tableId: "table_seed_a", requestId: "join-a2" }).ok, true);
  assert.equal(managerB.join({ ws: wsB1, userId: "user_a", tableId: "table_seed_b", requestId: "join-b1" }).ok, true);
  assert.equal(managerB.join({ ws: wsB2, userId: "user_b", tableId: "table_seed_b", requestId: "join-b2" }).ok, true);

  const bootA = managerA.bootstrapHand("table_seed_a");
  const bootB = managerB.bootstrapHand("table_seed_b");
  assert.equal(bootA.ok, true);
  assert.equal(bootB.ok, true);

  const snapA = managerA.tableSnapshot("table_seed_a", "user_a");
  const snapB = managerB.tableSnapshot("table_seed_b", "user_a");

  assert.equal(snapA.hand.status, "PREFLOP");
  assert.equal(snapB.hand.status, "PREFLOP");
  assert.equal(snapA.private.holeCards.length, 2);
  assert.equal(snapB.private.holeCards.length, 2);
  assert.deepEqual(snapA.pot, { total: 3, sidePots: [] });
  assert.deepEqual(snapB.pot, { total: 3, sidePots: [] });
  assert.equal(snapA.turn.userId, "user_a");
  assert.equal(snapB.turn.userId, "user_a");
  assert.notDeepEqual(snapA.private.holeCards, snapB.private.holeCards);
});

test("applyAction accepts legal turn CALL and increments state version once", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("apply-a");
  const wsB = fakeWs("apply-b");
  const tableId = "table_apply_action";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  const boot = tableManager.bootstrapHand(tableId);
  assert.equal(boot.ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const action = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-act-a",
    action: "CALL",
    amount: 0
  });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(action.accepted, true);
  assert.equal(after.stateVersion, before.stateVersion + 1);
  assert.deepEqual(after.pot, { total: 4, sidePots: [] });
  assert.equal(after.hand.status, "FLOP");
  assert.equal(after.board.cards.length, 3);
  assert.equal(after.turn.userId, "user_b");
  assert.deepEqual(after.legalActions, { seat: 1, actions: ["FOLD"] });
  assert.equal(after.private.holeCards.length, 2);
});

test("applyAction CALL closes initial heads-up preflop loop coherently", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("close-a");
  const wsB = fakeWs("close-b");
  const tableId = "table_apply_close";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const action = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-close-call",
    action: "CALL",
    amount: 0
  });
  const actorAfter = tableManager.tableSnapshot(tableId, "user_a");
  const otherAfter = tableManager.tableSnapshot(tableId, "user_b");

  assert.equal(action.accepted, true);
  assert.equal(actorAfter.hand.status, "FLOP");
  assert.equal(actorAfter.board.cards.length, 3);
  assert.equal(actorAfter.turn.userId, "user_b");
  assert.deepEqual(actorAfter.legalActions, { seat: 1, actions: ["FOLD"] });
  assert.deepEqual(otherAfter.legalActions.actions.includes("CHECK"), true);
});

test("applyAction rejects mismatched hand and keeps snapshot unchanged", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("reject-a");
  const wsB = fakeWs("reject-b");
  const tableId = "table_apply_reject";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const rejected = tableManager.applyAction({
    tableId,
    handId: "bad_hand",
    userId: "user_a",
    requestId: "req-act-bad",
    action: "CALL",
    amount: 0
  });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "hand_mismatch");
  assert.deepEqual(after, before);
});

test("applyAction is idempotent for requestId and does not double-apply", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("idem-a");
  const wsB = fakeWs("idem-b");
  const tableId = "table_apply_idem";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const first = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-idem",
    action: "CALL",
    amount: 0
  });
  const mid = tableManager.tableSnapshot(tableId, "user_a");
  const second = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-idem",
    action: "CALL",
    amount: 0
  });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(first.accepted, true);
  assert.equal(first.changed, true);
  assert.equal(first.replayed, false);
  assert.equal(second.accepted, true);
  assert.equal(second.changed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.deepEqual(after, mid);
});

test("applyAction same requestId from different users does not collide", () => {
  const tableManager = createTableManager({ maxSeats: 4, actionResultCacheMax: 8 });
  const wsA = fakeWs("scope-a");
  const wsB = fakeWs("scope-b");
  const tableId = "table_apply_scope";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const actorResult = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-shared",
    action: "CALL",
    amount: 0
  });

  const otherResult = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-shared",
    action: "CALL",
    amount: 0
  });

  assert.equal(actorResult.accepted, true);
  assert.equal(actorResult.replayed, false);
  assert.equal(otherResult.accepted, false);
  assert.equal(otherResult.replayed, false);
  assert.equal(otherResult.reason, "illegal_action");
});

test("applyAction cache is bounded and evicts oldest requestIds deterministically", () => {
  const tableManager = createTableManager({ maxSeats: 4, actionResultCacheMax: 2, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("bounded-a");
  const wsB = fakeWs("bounded-b");
  const tableId = "table_apply_bounded";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const req1 = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-bounded-1",
    action: "CALL",
    amount: 0
  });
  assert.equal(req1.accepted, true);

  const req2 = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-bounded-2",
    action: "CALL",
    amount: 0
  });
  const req3 = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-bounded-3",
    action: "FOLD",
    amount: 0
  });

  assert.equal(req2.accepted, false);
  assert.equal(req3.accepted, true);
  assert.equal(tableManager.__debugCore(tableId).actionResultsCacheSize, 2);

  const replayEvicted = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-bounded-1",
    action: "CALL",
    amount: 0
  });
  assert.equal(replayEvicted.accepted, false);
  assert.equal(replayEvicted.reason, "hand_not_live");

  const replayKept = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-bounded-3",
    action: "FOLD",
    amount: 0
  });
  assert.equal(replayKept.accepted, req3.accepted);
  assert.equal(replayKept.reason, req3.reason);
  assert.equal(replayKept.replayed, true);
  assert.equal(tableManager.__debugCore(tableId).actionResultsCacheSize, 2);
});

test("applyAction remains actionable after preflop street progression", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("street-a");
  const wsB = fakeWs("street-b");
  const tableId = "table_apply_street";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const pre = tableManager.tableSnapshot(tableId, "user_a");
  const closePreflop = tableManager.applyAction({ tableId, handId: pre.hand.handId, userId: "user_a", requestId: "req-pre-close", action: "CALL", amount: 0 });
  assert.equal(closePreflop.accepted, true);

  const flop = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(flop.hand.status, "FLOP");
  const flopAct = tableManager.applyAction({ tableId, handId: flop.hand.handId, userId: "user_b", requestId: "req-flop-check", action: "CHECK", amount: 0 });
  assert.equal(flopAct.accepted, true);
});

test("applyAction replay does not advance street or board twice", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("replay-a");
  const wsB = fakeWs("replay-b");
  const tableId = "table_apply_replay_street";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const first = tableManager.applyAction({ tableId, handId: before.hand.handId, userId: "user_a", requestId: "req-close-replay", action: "CALL", amount: 0 });
  const mid = tableManager.tableSnapshot(tableId, "user_a");
  const second = tableManager.applyAction({ tableId, handId: before.hand.handId, userId: "user_a", requestId: "req-close-replay", action: "CALL", amount: 0 });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(first.accepted, true);
  assert.equal(mid.hand.status, "FLOP");
  assert.equal(mid.board.cards.length, 3);
  assert.equal(second.replayed, true);
  assert.equal(second.changed, false);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.deepEqual(after.board.cards, mid.board.cards);
  assert.equal(after.stateVersion, mid.stateVersion);
});

test("first FLOP CHECK keeps FLOP and passes turn", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("flop-a");
  const wsB = fakeWs("flop-b");
  const tableId = "table_apply_flop_first_check";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);
  const pre = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(tableManager.applyAction({ tableId, handId: pre.hand.handId, userId: "user_a", requestId: "req-pre-call", action: "CALL", amount: 0 }).accepted, true);

  const flopBefore = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(flopBefore.hand.status, "FLOP");
  assert.equal(flopBefore.turn.userId, "user_b");
  const firstCheck = tableManager.applyAction({ tableId, handId: flopBefore.hand.handId, userId: "user_b", requestId: "req-flop-check-1", action: "CHECK", amount: 0 });
  const flopAfter = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(firstCheck.accepted, true);
  assert.equal(flopAfter.hand.status, "FLOP");
  assert.equal(flopAfter.board.cards.length, 3);
  assert.equal(flopAfter.turn.userId, "user_a");
});

test("preflop fold-win settles first and boots next hand only after explicit rollover", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("fold-a");
  const wsB = fakeWs("fold-b");
  const tableId = "table_fold_settle";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const pre = tableManager.tableSnapshot(tableId, "user_b");
  const before = tableManager.tableSnapshot(tableId, "user_a");
  const close = tableManager.applyAction({ tableId, handId: pre.hand.handId, userId: pre.turn.userId, requestId: "req-fold-close", action: "FOLD", amount: 0 });
  const settled = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(close.accepted, true);
  assert.equal(settled.hand.status, "SETTLED");
  assert.equal(settled.hand.handId, before.hand.handId);
  assert.equal(Array.isArray(settled.showdown.winners), true);
  assert.equal(typeof settled.handSettlement.settledAt, "string");
  const rollover = tableManager.rolloverSettledHand({ tableId, nowMs: 3_000 });
  const after = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(rollover.changed, true);
  assert.equal(after.hand.status, "PREFLOP");
  assert.notEqual(after.hand.handId, before.hand.handId);
  assert.equal(after.board.cards.length, 0);
  assert.equal(typeof after.turn.userId, "string");
  assert.equal(after.pot.total, 3);
  assert.equal("showdown" in after, false);
  assert.equal("handSettlement" in after, false);
  assert.equal(Array.isArray(after.legalActions.actions), true);
});

test("closing RIVER action settles first and replay is idempotent before rollover", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("river-a");
  const wsB = fakeWs("river-b");
  const tableId = "table_apply_river_close";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const pre = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(tableManager.applyAction({ tableId, handId: pre.hand.handId, userId: "user_a", requestId: "req-pre-call", action: "CALL", amount: 0 }).accepted, true);
  const flop = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(tableManager.applyAction({ tableId, handId: flop.hand.handId, userId: "user_b", requestId: "req-flop-check-1", action: "CHECK", amount: 0 }).accepted, true);
  assert.equal(tableManager.applyAction({ tableId, handId: flop.hand.handId, userId: "user_a", requestId: "req-flop-check-2", action: "CHECK", amount: 0 }).accepted, true);

  const turn = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(tableManager.applyAction({ tableId, handId: turn.hand.handId, userId: "user_b", requestId: "req-turn-check-1", action: "CHECK", amount: 0 }).accepted, true);
  assert.equal(tableManager.applyAction({ tableId, handId: turn.hand.handId, userId: "user_a", requestId: "req-turn-check-2", action: "CHECK", amount: 0 }).accepted, true);

  const river = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(river.hand.status, "RIVER");
  assert.equal(tableManager.applyAction({ tableId, handId: river.hand.handId, userId: "user_b", requestId: "req-river-check-1", action: "CHECK", amount: 0 }).accepted, true);
  const close = tableManager.applyAction({ tableId, handId: river.hand.handId, userId: "user_a", requestId: "req-river-check-2", action: "CHECK", amount: 0 });
  const settled = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(close.accepted, true);
  assert.equal(settled.hand.status, "SETTLED");
  assert.equal(settled.hand.handId, river.hand.handId);

  const replayClose = tableManager.applyAction({ tableId, handId: river.hand.handId, userId: "user_a", requestId: "req-river-check-2", action: "CHECK", amount: 0 });
  assert.equal(replayClose.accepted, true);
  assert.equal(replayClose.replayed, true);
  assert.equal(replayClose.changed, false);
  assert.equal(replayClose.stateVersion, close.stateVersion);

  const afterReplay = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(afterReplay.hand.handId, settled.hand.handId);
  assert.equal(afterReplay.stateVersion, settled.stateVersion);

  const rejected = tableManager.applyAction({ tableId, handId: river.hand.handId, userId: "user_b", requestId: "req-river-check-3", action: "CHECK", amount: 0 });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "hand_not_live");
  assert.equal(rejected.stateVersion, close.stateVersion);

  assert.equal(tableManager.rolloverSettledHand({ tableId, nowMs: 9_000 }).changed, true);
  const after = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(after.hand.status, "PREFLOP");
  assert.notEqual(after.hand.handId, river.hand.handId);
  assert.equal(after.board.cards.length, 0);
  assert.equal(typeof after.turn.userId, "string");
  assert.equal(after.pot.total, 3);
  assert.equal("showdown" in after, false);
  assert.equal("handSettlement" in after, false);
});

test("next hand rotates dealer for heads-up and three-player tables", () => {
  const headsUpManager = createTableManager({ maxSeats: 4 });
  const wsHU1 = fakeWs("hu-a");
  const wsHU2 = fakeWs("hu-b");
  const headsUpTableId = "table_rotate_hu";
  assert.equal(headsUpManager.join({ ws: wsHU1, userId: "user_a", tableId: headsUpTableId, requestId: "join-hu-a" }).ok, true);
  assert.equal(headsUpManager.join({ ws: wsHU2, userId: "user_b", tableId: headsUpTableId, requestId: "join-hu-b" }).ok, true);
  assert.equal(headsUpManager.bootstrapHand(headsUpTableId).ok, true);

  const preHu = headsUpManager.tableSnapshot(headsUpTableId, "user_a");
  const dealerBeforeHu = preHu.turn.userId;
  assert.equal(headsUpManager.applyAction({ tableId: headsUpTableId, handId: preHu.hand.handId, userId: preHu.turn.userId, requestId: "hu-fold-close", action: "FOLD", amount: 0 }).accepted, true);
  assert.equal(headsUpManager.rolloverSettledHand({ tableId: headsUpTableId, nowMs: 4_000 }).changed, true);
  const nextHu = headsUpManager.tableSnapshot(headsUpTableId, "user_a");
  assert.equal(nextHu.hand.status, "PREFLOP");
  assert.notEqual(nextHu.turn.userId, dealerBeforeHu);

  const ringManager = createTableManager({ maxSeats: 6 });
  const wsR1 = fakeWs("r-a");
  const wsR2 = fakeWs("r-b");
  const wsR3 = fakeWs("r-c");
  const ringTableId = "table_rotate_ring";
  assert.equal(ringManager.join({ ws: wsR1, userId: "user_a", tableId: ringTableId, requestId: "join-r-a" }).ok, true);
  assert.equal(ringManager.join({ ws: wsR2, userId: "user_b", tableId: ringTableId, requestId: "join-r-b" }).ok, true);
  assert.equal(ringManager.join({ ws: wsR3, userId: "user_c", tableId: ringTableId, requestId: "join-r-c" }).ok, true);
  assert.equal(ringManager.restoreTableFromPersisted(ringTableId, {
    coreState: {
      version: 4,
      roomId: ringTableId,
      maxSeats: 6,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 },
        { userId: "user_c", seat: 3 }
      ],
      seats: { user_a: 1, user_b: 2, user_c: 3 },
      publicStacks: { user_a: 100, user_b: 100, user_c: 100 },
      seatDetailsByUserId: {
        user_a: { isBot: false, botProfile: null, leaveAfterHand: false },
        user_b: { isBot: false, botProfile: null, leaveAfterHand: false },
        user_c: { isBot: false, botProfile: null, leaveAfterHand: false }
      },
      pokerState: {
        roomId: ringTableId,
        handId: "ring_settled",
        phase: "SETTLED",
        dealerSeatNo: 1,
        stacks: { user_a: 100, user_b: 100, user_c: 100 },
        showdown: {
          handId: "ring_settled",
          winners: ["user_b"],
          potsAwarded: [{ amount: 9, winners: ["user_b"] }],
          potAwardedTotal: 9,
          reason: "computed"
        },
        handSettlement: {
          handId: "ring_settled",
          settledAt: "2026-04-11T10:00:02.000Z",
          payouts: { user_b: 9 }
        }
      }
    },
    presenceByUserId: new Map([
      ["user_a", { userId: "user_a", seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }],
      ["user_b", { userId: "user_b", seat: 2, connected: true, lastSeenAt: 1, expiresAt: null }],
      ["user_c", { userId: "user_c", seat: 3, connected: true, lastSeenAt: 1, expiresAt: null }]
    ])
  }).ok, true);
  assert.equal(ringManager.rolloverSettledHand({ tableId: ringTableId, nowMs: 4_000 }).changed, true);

  const nextRing = ringManager.tableSnapshot(ringTableId, "user_a");
  assert.equal(nextRing.hand.status, "PREFLOP");
  assert.equal(nextRing.turn.userId, "user_b");
});


test("maybeApplyTurnTimeout applies deterministic action once for expired turn", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("timeout-a");
  const wsB = fakeWs("timeout-b");
  const tableId = "table_timeout_once";
  const fixedFutureMs = 9_000_000;

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);

  const started = tableManager.bootstrapHand(tableId, { nowMs: fixedFutureMs - 100_000 });
  assert.equal(started.changed, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const timeoutResult = tableManager.maybeApplyTurnTimeout({ tableId, nowMs: fixedFutureMs });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(timeoutResult.ok, true);
  assert.equal(timeoutResult.changed, true);
  assert.equal(timeoutResult.action, "FOLD");
  assert.equal(after.stateVersion, before.stateVersion + 1);

  const replay = tableManager.maybeApplyTurnTimeout({ tableId, nowMs: fixedFutureMs });
  const afterReplay = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(replay.changed, false);
  assert.equal(afterReplay.stateVersion, after.stateVersion);
});

test("maybeApplyTurnTimeout does nothing when deadline is unexpired", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("timeout-noop-a");
  const wsB = fakeWs("timeout-noop-b");
  const tableId = "table_timeout_noop";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).changed, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const result = tableManager.maybeApplyTurnTimeout({ tableId, nowMs: 0 });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(after.stateVersion, before.stateVersion);
});

test("timeout progression can settle hand and next hand starts only after explicit rollover", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("timeout-cycle-a");
  const wsB = fakeWs("timeout-cycle-b");
  const tableId = "table_timeout_cycle";
  const fixedFutureMs = 7_000_000;

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);

  assert.equal(tableManager.bootstrapHand(tableId, { nowMs: fixedFutureMs - 50_000 }).changed, true);
  const before = tableManager.tableSnapshot(tableId, "user_a");
  const previousHandId = before.hand.handId;

  const timeoutResult = tableManager.maybeApplyTurnTimeout({ tableId, nowMs: fixedFutureMs });
  const settled = tableManager.tableSnapshot(tableId, "user_a");
  const settledPokerState = tableManager.__debugPokerState(tableId);

  assert.equal(timeoutResult.ok, true);
  assert.equal(timeoutResult.changed, true);
  assert.equal(settled.hand.handId, previousHandId);
  assert.equal(settled.hand.status, "SETTLED");
  assert.equal(settledPokerState.turnStartedAt, null);
  assert.equal(settledPokerState.turnDeadlineAt, null);

  const secondSweep = tableManager.maybeApplyTurnTimeout({ tableId, nowMs: fixedFutureMs });
  assert.equal(secondSweep.changed, false);

  assert.equal(tableManager.rolloverSettledHand({ tableId, nowMs: fixedFutureMs }).changed, true);
  const after = tableManager.tableSnapshot(tableId, "user_a");
  const livePokerState = tableManager.__debugPokerState(tableId);
  assert.notEqual(after.hand.handId, previousHandId);
  assert.equal(after.hand.status, "PREFLOP");
  assert.equal(typeof after.turn.userId, "string");
  assert.equal(livePokerState.turnStartedAt, fixedFutureMs);
  assert.equal(livePokerState.turnDeadlineAt > fixedFutureMs, true);
});


test("rolloverSettledHand stamps next-turn deadline using supplied action clock", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("action-clock-a");
  const wsB = fakeWs("action-clock-b");
  const tableId = "table_action_clock";
  const actionNowMs = 5_555_000;

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId, { nowMs: actionNowMs - 1_000 }).changed, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const acted = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: before.turn.userId,
    requestId: "act-clock",
    action: "FOLD",
    amount: 0,
    nowMs: actionNowMs
  });

  assert.equal(acted.accepted, true);
  assert.equal(tableManager.__debugPokerState(tableId).turnStartedAt, null);
  assert.equal(tableManager.rolloverSettledHand({ tableId, nowMs: actionNowMs }).changed, true);
  const livePokerState = tableManager.__debugPokerState(tableId);
  assert.equal(livePokerState.turnStartedAt, actionNowMs);
  assert.equal(livePokerState.turnDeadlineAt > actionNowMs, true);
});

test("boundary contract: bootstrapHand returns stable started/already_live outward semantics", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const tableId = "table_boundary_bootstrap";
  const wsA = fakeWs("boundary-boot-a");
  const wsB = fakeWs("boundary-boot-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 11 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 11 }).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const first = tableManager.bootstrapHand(tableId, { nowMs: 1_000 });
  const second = tableManager.bootstrapHand(tableId, { nowMs: 1_001 });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(before.hand.status, "LOBBY");
  assert.deepEqual(Object.keys(first).sort(), ["bootstrap", "changed", "handId", "ok", "stateVersion"]);
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.bootstrap, "started");
  assert.equal(typeof first.handId, "string");
  assert.ok(first.handId.length > 0);
  assert.equal(first.stateVersion, before.stateVersion + 1);

  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.bootstrap, "already_live");
  assert.equal(second.handId, first.handId);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.equal(after.stateVersion, first.stateVersion);
  assert.equal(after.hand.handId, first.handId);
});

test("boundary contract: applyAction preserves accepted fields and requestId replay semantics", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const tableId = "table_boundary_action";
  const wsA = fakeWs("boundary-act-a");
  const wsB = fakeWs("boundary-act-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 12 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 12 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId, { nowMs: 2_000 }).changed, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const request = {
    tableId,
    handId: before.hand.handId,
    userId: before.turn.userId,
    requestId: "boundary-action-idempotent",
    action: "CALL",
    amount: 0,
    nowIso: new Date(2_001).toISOString(),
    nowMs: 2_001
  };

  const first = tableManager.applyAction(request);
  const second = tableManager.applyAction(request);
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(first.ok, true);
  assert.equal(first.accepted, true);
  assert.equal(first.changed, true);
  assert.equal(first.replayed, false);
  assert.equal(first.reason, null);
  assert.equal(typeof first.stateVersion, "number");
  assert.equal(typeof first.handId, "string");

  assert.equal(second.ok, true);
  assert.equal(second.accepted, true);
  assert.equal(second.changed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.reason, null);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.equal(second.handId, first.handId);

  assert.equal(after.stateVersion, first.stateVersion);
});

test("boundary contract: maybeApplyTurnTimeout mutates once and replay-guards repeated sweep", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const tableId = "table_boundary_timeout";
  const wsA = fakeWs("boundary-timeout-a");
  const wsB = fakeWs("boundary-timeout-b");
  const nowMs = 9_999_000;

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 13 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 13 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId, { nowMs: nowMs - 40_000 }).changed, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const first = tableManager.maybeApplyTurnTimeout({ tableId, nowMs });
  const second = tableManager.maybeApplyTurnTimeout({ tableId, nowMs });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.replayed, false);
  assert.equal(typeof first.requestId, "string");
  assert.equal(typeof first.actorUserId, "string");
  assert.equal(typeof first.stateVersion, "number");

  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.ok(second.replayed === true || typeof second.reason === "string");

  assert.equal(after.stateVersion, before.stateVersion + 1);
});


test("applyAction rejection parity: invalid actor/hand/illegal action preserve snapshot and version", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("rej-parity-a");
  const wsB = fakeWs("rej-parity-b");
  const tableId = "table_apply_rejection_parity";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");

  const wrongTurn = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-wrong-turn",
    action: "CHECK",
    amount: 0
  });
  const afterWrongTurn = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(wrongTurn.accepted, false);
  assert.equal(wrongTurn.changed, false);
  assert.equal(wrongTurn.replayed, false);
  assert.equal(wrongTurn.reason, "illegal_action");
  assert.equal(wrongTurn.stateVersion, before.stateVersion);
  assert.deepEqual(afterWrongTurn, before);

  const nonSeated = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_c",
    requestId: "req-not-seated",
    action: "CALL",
    amount: 0
  });
  const afterNonSeated = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(nonSeated.accepted, false);
  assert.equal(nonSeated.reason, "not_seated");
  assert.equal(nonSeated.stateVersion, before.stateVersion);
  assert.deepEqual(afterNonSeated, before);

  const handMismatch = tableManager.applyAction({
    tableId,
    handId: "bad_hand",
    userId: "user_a",
    requestId: "req-bad-hand",
    action: "CALL",
    amount: 0
  });
  const afterHandMismatch = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(handMismatch.accepted, false);
  assert.equal(handMismatch.reason, "hand_mismatch");
  assert.equal(handMismatch.stateVersion, before.stateVersion);
  assert.deepEqual(afterHandMismatch, before);
});

test("applyAction replay for rejected requestId stays deterministic and non-mutating", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("rej-replay-a");
  const wsB = fakeWs("rej-replay-b");
  const tableId = "table_apply_rejection_replay";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const request = {
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-reject-replay",
    action: "CHECK",
    amount: 0
  };

  const first = tableManager.applyAction(request);
  const mid = tableManager.tableSnapshot(tableId, "user_a");
  const second = tableManager.applyAction(request);
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(first.accepted, false);
  assert.equal(first.replayed, false);
  assert.equal(first.changed, false);
  assert.equal(first.reason, "illegal_action");
  assert.equal(second.accepted, false);
  assert.equal(second.replayed, true);
  assert.equal(second.changed, false);
  assert.equal(second.reason, first.reason);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.deepEqual(mid, before);
  assert.deepEqual(after, before);
});



test("bootstrap requires loader and does not synthesize empty table", async () => {
  const tableManager = createTableManager();

  const ensured = await tableManager.ensureTableLoaded("table_without_loader");
  assert.equal(ensured.ok, false);
  assert.equal(ensured.code, "table_bootstrap_unavailable");
  assert.deepEqual(tableManager.tableState("table_without_loader").members, []);
  assert.equal(tableManager.tableSnapshot("table_without_loader", "user_1").stateVersion, 0);
});
test("bootstraps table from persisted poker state and reuses cache without writes", async () => {
  const calls = { reads: 0, writes: 0 };
  const tableManager = createTableManager({
    tableBootstrapLoader: async ({ tableId }) => {
      calls.reads += 1;
      assert.equal(tableId, "table_persisted");
      return {
        ok: true,
        table: {
          tableId,
          coreState: {
            roomId: tableId,
            maxSeats: 6,
            version: 44,
            members: [{ userId: "user_a", seat: 2 }],
            seats: { user_a: 2 },
            appliedRequestIds: [],
            pokerState: { handId: "h44", phase: "PREFLOP" }
          },
          presenceByUserId: new Map([["user_a", { userId: "user_a", seat: 2, connected: false, lastSeenAt: null, expiresAt: null }]]),
          subscribers: new Set(),
          actionResultsByRequestId: new Map()
        }
      };
    }
  });

  const ensured = await tableManager.ensureTableLoaded("table_persisted");
  assert.equal(ensured.ok, true);
  assert.equal(tableManager.tableSnapshot("table_persisted", "user_a").stateVersion, 44);

  const ws = fakeWs("persisted-ws");
  const joined = tableManager.join({ ws, userId: "user_a", tableId: "table_persisted", requestId: "join-1", nowTs: 10 });
  assert.equal(joined.ok, true);

  const ensuredAgain = await tableManager.ensureTableLoaded("table_persisted");
  assert.equal(ensuredAgain.ok, true);
  assert.equal(calls.reads, 1);
  assert.equal(calls.writes, 0);
});

test("lobby-materialized stub bootstraps persisted state on first real load", async () => {
  const calls = { reads: 0 };
  const tableId = "table_lobby_materialized_stub";
  const tableManager = createTableManager({
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => {
      calls.reads += 1;
      assert.equal(loadedTableId, tableId);
      return {
        ok: true,
        table: {
          tableId: loadedTableId,
          tableStatus: "OPEN",
          tableMeta: { maxPlayers: 6, stakes: { sb: 1, bb: 2 } },
          coreState: {
            roomId: loadedTableId,
            maxSeats: 6,
            version: 12,
            members: [{ userId: "user_a", seat: 3 }],
            seats: { user_a: 3 },
            appliedRequestIds: [],
            pokerState: {
              handId: "h12",
              phase: "PREFLOP",
              turnUserId: "user_a",
              holeCardsByUserId: { user_a: ["As", "Kd"] }
            }
          },
          presenceByUserId: new Map([["user_a", { userId: "user_a", seat: 3, connected: false, lastSeenAt: null, expiresAt: null }]]),
          subscribers: new Set(),
          actionResultsByRequestId: new Map()
        }
      };
    }
  });

  const materialized = tableManager.materializeLobbyTable({
    tableId,
    tableMeta: { maxPlayers: 6, stakes: { sb: 1, bb: 2 } },
    nowMs: 100
  });
  assert.equal(materialized.ok, true);
  assert.equal(tableManager.tableSnapshot(tableId, "user_a").stateVersion, 0);
  assert.equal(tableManager.persistedPokerState(tableId).phase, "INIT");

  const ensured = await tableManager.ensureTableLoaded(tableId);
  assert.equal(ensured.ok, true);
  assert.equal(ensured.cached, false);
  assert.equal(tableManager.tableSnapshot(tableId, "user_a").stateVersion, 12);
  assert.equal(tableManager.persistedPokerState(tableId).phase, "PREFLOP");

  const ws = fakeWs("materialized-persisted-ws");
  const joined = tableManager.join({ ws, userId: "user_a", tableId, requestId: "join-materialized", nowTs: 10 });
  assert.equal(joined.ok, true);
  assert.deepEqual(memberPairs(joined.tableState.members), [["user_a", 3]]);

  const ensuredAgain = await tableManager.ensureTableLoaded(tableId);
  assert.equal(ensuredAgain.ok, true);
  assert.equal(calls.reads, 1);
});

test("bootstrap rejects missing table without creating synthetic room", async () => {
  const tableManager = createTableManager({
    tableBootstrapLoader: async () => ({ ok: false, code: "table_not_found", message: "table_not_found" })
  });

  const ensured = await tableManager.ensureTableLoaded("missing_table");
  assert.equal(ensured.ok, false);
  assert.equal(ensured.code, "table_not_found");
  assert.deepEqual(tableManager.tableState("missing_table").members, []);
  assert.equal(tableManager.tableSnapshot("missing_table", "user_m").stateVersion, 0);
});

test("bootstrap rejects invalid persisted state and blocks actions", async () => {
  const tableManager = createTableManager({
    tableBootstrapLoader: async () => ({ ok: false, code: "invalid_persisted_state", message: "invalid_persisted_state" })
  });

  const ensured = await tableManager.ensureTableLoaded("table_invalid");
  assert.equal(ensured.ok, false);
  assert.equal(ensured.code, "invalid_persisted_state");

  const action = tableManager.applyAction({
    tableId: "table_invalid",
    handId: "h1",
    userId: "user_x",
    requestId: "act-1",
    action: "CHECK"
  });
  assert.equal(action.accepted, false);
  assert.equal(action.reason, "table_not_found");
});


test("observer leave without tableId resolves subscribed table in observeOnlyJoin mode", async () => {
  const tableId = "table_observer_leave";
  const tableManager = createTableManager({
    maxSeats: 4,
    observeOnlyJoin: true,
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => ({
      ok: true,
      table: {
        tableId: loadedTableId,
        coreState: {
          version: 1,
          roomId: loadedTableId,
          maxSeats: 4,
          appliedRequestIds: [],
          members: [{ userId: "seat_user", seat: 1 }],
          seats: { seat_user: 1 },
          pokerState: null
        },
        presenceByUserId: new Map([["seat_user", { userId: "seat_user", seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }]]),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      }
    })
  });

  const wsObserver = fakeWs("ws-observer-leave");
  const ensured = await tableManager.ensureTableLoaded(tableId);
  assert.equal(ensured.ok, true);

  const joined = tableManager.join({ ws: wsObserver, userId: "observer_user", tableId, requestId: "join-observer", nowTs: 10 });
  assert.equal(joined.ok, true);

  const left = tableManager.leave({ ws: wsObserver, userId: "observer_user", requestId: "leave-observer" });
  assert.equal(left.ok, true);
  assert.notDeepEqual(left.effects, [{ type: "noop", reason: "not_joined" }]);
  assert.deepEqual(memberPairs(left.tableState.members), [["seat_user", 1]]);
});

test("observeOnlyJoin observer lifecycle join->resync->leave stays non-mutating", async () => {
  const tableId = "table_observer_lifecycle";
  const tableManager = createTableManager({
    maxSeats: 4,
    observeOnlyJoin: true,
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => ({
      ok: true,
      table: {
        tableId: loadedTableId,
        coreState: {
          version: 2,
          roomId: loadedTableId,
          maxSeats: 4,
          appliedRequestIds: [],
          members: [{ userId: "seat_user", seat: 1 }],
          seats: { seat_user: 1 },
          pokerState: null
        },
        presenceByUserId: new Map([["seat_user", { userId: "seat_user", seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }]]),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      }
    })
  });

  const ws = fakeWs("ws-observer-lifecycle");
  await tableManager.ensureTableLoaded(tableId);

  const joined = tableManager.join({ ws, userId: "obs_user", tableId, requestId: "join-obs", nowTs: 10 });
  assert.equal(joined.ok, true);
  assert.deepEqual(memberPairs(joined.tableState.members), [["seat_user", 1]]);

  const resynced = tableManager.resync({ ws, userId: "obs_user", tableId, nowTs: 11 });
  assert.equal(resynced.ok, true);
  assert.deepEqual(memberPairs(resynced.tableState.members), [["seat_user", 1]]);

  const left = tableManager.leave({ ws, userId: "obs_user", requestId: "leave-obs" });
  assert.equal(left.ok, true);
  assert.notDeepEqual(left.effects, [{ type: "noop", reason: "not_joined" }]);
  assert.deepEqual(memberPairs(left.tableState.members), [["seat_user", 1]]);
});

test("observeOnlyJoin seated member reconnect remains non-mutating and connected", async () => {
  const tableId = "table_seated_reconnect";
  const tableManager = createTableManager({
    maxSeats: 4,
    observeOnlyJoin: true,
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => ({
      ok: true,
      table: {
        tableId: loadedTableId,
        coreState: {
          version: 3,
          roomId: loadedTableId,
          maxSeats: 4,
          appliedRequestIds: [],
          members: [{ userId: "seat_user", seat: 2 }],
          seats: { seat_user: 2 },
          pokerState: null
        },
        presenceByUserId: new Map([["seat_user", { userId: "seat_user", seat: 2, connected: false, lastSeenAt: null, expiresAt: null }]]),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      }
    })
  });

  const ws = fakeWs("ws-seat-reconnect");
  await tableManager.ensureTableLoaded(tableId);

  const firstJoin = tableManager.join({ ws, userId: "seat_user", tableId, requestId: "join-seat-1", nowTs: 10 });
  assert.equal(firstJoin.ok, true);
  assert.deepEqual(memberPairs(firstJoin.tableState.members), [["seat_user", 2]]);

  const secondJoin = tableManager.join({ ws, userId: "seat_user", tableId, requestId: "join-seat-2", nowTs: 11 });
  assert.equal(secondJoin.ok, true);
  assert.equal(secondJoin.changed, false);
  assert.deepEqual(memberPairs(secondJoin.tableState.members), [["seat_user", 2]]);
});
