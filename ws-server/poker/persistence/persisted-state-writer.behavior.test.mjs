import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPersistedStateWriter } from "./persisted-state-writer.mjs";
import { createTableManager } from "../table/table-manager.mjs";

test("persisted state writer strips runtime private cards before file persistence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "persisted-state-writer-"));
  const filePath = path.join(dir, "state.json");
  try {
    await fs.writeFile(filePath, JSON.stringify({
      tables: {
        t1: {
          tableRow: { id: "t1", status: "OPEN" },
          seatRows: [],
          stateRow: {
            version: 3,
            state: {
              tableId: "t1",
              handId: "hand_1",
              handSeed: "seed_1",
              phase: "TURN",
              community: ["AS", "KS", "QS", "JD"],
              communityDealt: 4,
              seats: [{ userId: "u1", seatNo: 1, status: "ACTIVE" }],
              stacks: { u1: 100 }
            }
          }
        }
      }
    }), "utf8");

    const writer = createPersistedStateWriter({
      env: { WS_PERSISTED_STATE_FILE: filePath },
      klog: () => {}
    });

    const result = await writer.writeMutation({
      tableId: "t1",
      expectedVersion: 3,
      nextState: {
        tableId: "t1",
        handId: "hand_1",
        handSeed: "seed_1",
        phase: "TURN",
        community: ["AS", "KS", "QS", "JD"],
        communityDealt: 4,
        seats: [{ userId: "u1", seatNo: 1, status: "ACTIVE" }],
        stacks: { u1: 100 },
        holeCardsByUserId: { u1: ["AH", "AD"] },
        deck: ["TC"]
      }
    });

    assert.deepEqual(result, { ok: true, newVersion: 4 });
    const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
    const storedState = persisted.tables.t1.stateRow.state;
    assert.equal(storedState.handSeed, "seed_1");
    assert.equal(Object.prototype.hasOwnProperty.call(storedState, "holeCardsByUserId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(storedState, "deck"), false);
    assert.deepEqual(storedState.community, ["AS", "KS", "QS", "JD"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("persisted state writer bumps table last_activity_at on successful db mutation", async () => {
  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        queries.push({ query: String(query), params });
        if (String(query).startsWith("update public.poker_state set version = version + 1")) {
          return [{ version: 5 }];
        }
        return [];
      }
    }),
    klog: () => {}
  });

  const result = await writer.writeMutation({
    tableId: "t_db",
    expectedVersion: 4,
    nextState: {
      tableId: "t_db",
      handId: "hand_db",
      handSeed: "seed_db",
      phase: "TURN",
      community: ["AS", "KS", "QS", "JD"],
      communityDealt: 4,
      seats: [{ userId: "u1", seatNo: 1, status: "ACTIVE" }],
      stacks: { u1: 100 }
    }
  });

  assert.deepEqual(result, { ok: true, newVersion: 5 });
  assert.equal(
    queries.some((entry) => (
      entry.query === "update public.poker_tables set last_activity_at = now() where id = $1;"
      && entry.params[0] === "t_db"
    )),
    true
  );
});

test("persisted state writer persists WS hand hole cards after successful db mutation", async () => {
  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          return [{ version: 5 }];
        }
        return [];
      }
    }),
    klog: () => {}
  });

  const result = await writer.writeMutation({
    tableId: "00000000-0000-4000-8000-000000000001",
    expectedVersion: 4,
    nextState: {
      tableId: "00000000-0000-4000-8000-000000000001",
      handId: "hand_ws_1",
      handSeed: "seed_ws_1",
      phase: "PREFLOP",
      seats: [
        { userId: "00000000-0000-4000-8000-0000000000a1", seatNo: 1, status: "ACTIVE" },
        { userId: "00000000-0000-4000-8000-0000000000b2", seatNo: 2, status: "ACTIVE" }
      ],
      stacks: {
        "00000000-0000-4000-8000-0000000000a1": 98,
        "00000000-0000-4000-8000-0000000000b2": 96
      },
      holeCardsByUserId: {
        "00000000-0000-4000-8000-0000000000a1": ["AS", "KD"],
        "00000000-0000-4000-8000-0000000000b2": ["2C", "2D"]
      },
      deck: ["3H"]
    }
  });

  assert.deepEqual(result, { ok: true, newVersion: 5 });
  const stateUpdate = queries.find((entry) => entry.query.startsWith("update public.poker_state set version = version + 1"));
  assert.ok(stateUpdate);
  const storedState = JSON.parse(stateUpdate.params[2]);
  assert.equal(Object.prototype.hasOwnProperty.call(storedState, "holeCardsByUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storedState, "deck"), false);
  const holeCardInsert = queries.find((entry) => entry.query.startsWith("insert into public.poker_hole_cards"));
  assert.ok(holeCardInsert);
  assert.match(holeCardInsert.query, /on conflict \(table_id, hand_id, user_id\) do update set cards = excluded\.cards/);
  assert.deepEqual(holeCardInsert.params, [
    "00000000-0000-4000-8000-000000000001",
    "hand_ws_1",
    "00000000-0000-4000-8000-0000000000a1",
    "[\"AS\",\"KD\"]",
    "00000000-0000-4000-8000-000000000001",
    "hand_ws_1",
    "00000000-0000-4000-8000-0000000000b2",
    "[\"2C\",\"2D\"]"
  ]);
});

test("persisted state writer hole card persistence is idempotent on replayed state write", async () => {
  let stateVersion = 4;
  let currentState = null;
  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          if (stateVersion === 4) {
            stateVersion = 5;
            currentState = JSON.parse(params[2]);
            return [{ version: stateVersion }];
          }
          return [];
        }
        if (text.startsWith("select version, state from public.poker_state where table_id = $1 limit 1;")) {
          return [{ version: stateVersion, state: currentState }];
        }
        return [];
      }
    }),
    klog: () => {}
  });

  const nextState = {
    tableId: "00000000-0000-4000-8000-000000000002",
    handId: "hand_ws_replay",
    phase: "PREFLOP",
    holeCardsByUserId: {
      "00000000-0000-4000-8000-0000000000a1": ["AS", "KD"],
      "00000000-0000-4000-8000-0000000000b2": ["2C", "2D"]
    }
  };

  const first = await writer.writeMutation({ tableId: "00000000-0000-4000-8000-000000000002", expectedVersion: 4, nextState });
  const second = await writer.writeMutation({ tableId: "00000000-0000-4000-8000-000000000002", expectedVersion: 4, nextState });

  assert.deepEqual(first, { ok: true, newVersion: 5 });
  assert.deepEqual(second, { ok: true, newVersion: 5, alreadyApplied: true });
  const holeCardInserts = queries.filter((entry) => entry.query.startsWith("insert into public.poker_hole_cards"));
  assert.equal(holeCardInserts.length, 2);
  assert.equal(holeCardInserts.every((entry) => entry.query.includes("on conflict (table_id, hand_id, user_id) do update")), true);
});

test("persisted state writer persists hole cards from real WS bootstrap private audit state when public state is sanitized", async () => {
  const tableId = "00000000-0000-4000-8000-000000000010";
  const userA = "00000000-0000-4000-8000-0000000000a1";
  const userB = "00000000-0000-4000-8000-0000000000b2";
  const tableManager = createTableManager({ maxSeats: 4 });
  assert.equal(tableManager.join({ ws: { id: "ws-a" }, userId: userA, tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: { id: "ws-b" }, userId: userB, tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  const bootstrapped = tableManager.bootstrapHand(tableId, { nowMs: 1_000 });
  assert.equal(bootstrapped.changed, true);

  const privateStateForHoleCards = tableManager.privatePokerStateForAudit(tableId);
  const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...nextState } = tableManager.persistedPokerState(tableId);
  assert.equal(Object.prototype.hasOwnProperty.call(nextState, "holeCardsByUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(nextState, "deck"), false);
  assert.equal(Object.keys(privateStateForHoleCards?.holeCardsByUserId || {}).length, 2);

  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) return [{ version: bootstrapped.stateVersion }];
        return [];
      }
    }),
    klog: () => {}
  });

  const result = await writer.writeMutation({
    tableId,
    expectedVersion: bootstrapped.stateVersion - 1,
    nextState,
    privateStateForHoleCards
  });

  assert.deepEqual(result, { ok: true, newVersion: bootstrapped.stateVersion });
  const holeCardInsert = queries.find((entry) => entry.query.startsWith("insert into public.poker_hole_cards"));
  assert.ok(holeCardInsert);
  assert.equal(holeCardInsert.params[0], tableId);
  assert.equal(holeCardInsert.params[1], privateStateForHoleCards.handId);
  assert.equal(holeCardInsert.params[2], userA);
  assert.equal(holeCardInsert.params[4], tableId);
  assert.equal(holeCardInsert.params[5], privateStateForHoleCards.handId);
  assert.equal(holeCardInsert.params[6], userB);
  assert.equal(JSON.parse(holeCardInsert.params[3]).length, 2);
  assert.equal(JSON.parse(holeCardInsert.params[7]).length, 2);
});

test("persisted state writer persists hole cards from real WS rollover private audit state when public state is sanitized", async () => {
  const tableId = "00000000-0000-4000-8000-000000000011";
  const userA = "00000000-0000-4000-8000-0000000000a1";
  const userB = "00000000-0000-4000-8000-0000000000b2";
  const tableManager = createTableManager({ maxSeats: 4 });
  assert.equal(tableManager.join({ ws: { id: "ws-roll-a" }, userId: userA, tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: { id: "ws-roll-b" }, userId: userB, tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  const bootstrapped = tableManager.bootstrapHand(tableId, { nowMs: 1_000 });
  assert.equal(bootstrapped.changed, true);
  const firstState = tableManager.persistedPokerState(tableId);
  const folded = tableManager.applyAction({
    tableId,
    handId: firstState.handId,
    userId: firstState.turnUserId,
    requestId: "fold-to-settle",
    action: "FOLD",
    amount: null,
    nowMs: 1_100
  });
  assert.equal(folded.accepted, true);
  assert.equal(tableManager.persistedPokerState(tableId).phase, "SETTLED");

  const rollover = tableManager.rolloverSettledHand({ tableId, nowMs: 5_000 });
  assert.equal(rollover.changed, true);
  const privateStateForHoleCards = tableManager.privatePokerStateForAudit(tableId);
  const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...nextState } = tableManager.persistedPokerState(tableId);
  assert.equal(nextState.phase, "PREFLOP");
  assert.equal(Object.keys(privateStateForHoleCards?.holeCardsByUserId || {}).length, 2);

  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) return [{ version: rollover.stateVersion }];
        return [];
      }
    }),
    klog: () => {}
  });

  const result = await writer.writeMutation({
    tableId,
    expectedVersion: rollover.stateVersion - 1,
    nextState,
    privateStateForHoleCards
  });

  assert.deepEqual(result, { ok: true, newVersion: rollover.stateVersion });
  const holeCardInsert = queries.find((entry) => entry.query.startsWith("insert into public.poker_hole_cards"));
  assert.ok(holeCardInsert);
  const persistedUsers = new Set();
  for (let index = 0; index < holeCardInsert.params.length; index += 4) {
    assert.equal(holeCardInsert.params[index], tableId);
    assert.equal(holeCardInsert.params[index + 1], privateStateForHoleCards.handId);
    persistedUsers.add(holeCardInsert.params[index + 2]);
    assert.equal(JSON.parse(holeCardInsert.params[index + 3]).length, 2);
  }
  assert.deepEqual(persistedUsers, new Set([userA, userB]));
});

test("persisted state writer logs hole card persistence failures without failing gameplay or leaking cards", async () => {
  const logs = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query) => {
        const text = String(query);
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          return [{ version: 5 }];
        }
        if (text.startsWith("insert into public.poker_hole_cards")) {
          const error = new Error("driver leaked AS KD");
          error.code = "23505";
          throw error;
        }
        return [];
      }
    }),
    klog: (kind, payload) => logs.push({ kind, payload })
  });

  const result = await writer.writeMutation({
    tableId: "00000000-0000-4000-8000-000000000003",
    expectedVersion: 4,
    nextState: {
      tableId: "00000000-0000-4000-8000-000000000003",
      handId: "hand_ws_failure",
      phase: "PREFLOP",
      holeCardsByUserId: {
        "00000000-0000-4000-8000-0000000000a1": ["AS", "KD"],
        "00000000-0000-4000-8000-0000000000b2": ["2C", "2D"]
      },
      deck: ["3H"]
    }
  });

  assert.deepEqual(result, { ok: true, newVersion: 5 });
  assert.deepEqual(logs, [{
    kind: "ws_hole_cards_persist_failed",
    payload: {
      tableId: "00000000-0000-4000-8000-000000000003",
      handId: "hand_ws_failure",
      playerCount: 2,
      reason: "23505"
    }
  }]);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes("AS"), false);
  assert.equal(serializedLogs.includes("KD"), false);
  assert.equal(serializedLogs.includes("2C"), false);
  assert.equal(serializedLogs.includes("2D"), false);
  assert.equal(serializedLogs.includes("3H"), false);
});

test("persisted state writer appends accepted human action audit row", async () => {
  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          return [{ version: 8 }];
        }
        if (text === "update public.poker_tables set last_activity_at = now() where id = $1;") {
          return [];
        }
        if (text.startsWith("select id from public.poker_actions where table_id = $1 and request_id = $2")) {
          return [];
        }
        if (text.startsWith("insert into public.poker_actions")) {
          return [{ id: 100 }];
        }
        return [];
      }
    }),
    klog: () => {}
  });

  const result = await writer.writeMutation({
    tableId: "t_action",
    expectedVersion: 7,
    nextState: {
      tableId: "t_action",
      handId: "hand_action",
      phase: "FLOP",
      potTotal: 12,
      currentBet: 0,
      stacks: { u1: 94, u2: 94 },
      seats: [{ userId: "u1", seatNo: 1, status: "ACTIVE" }, { userId: "u2", seatNo: 2, status: "ACTIVE" }],
      holeCardsByUserId: { u1: ["AH", "AD"] }
    },
    acceptedActionAudit: {
      tableId: "t_action",
      handId: "hand_action",
      actorUserId: "u2",
      isBot: false,
      source: "human",
      action: "CALL",
      amount: 4,
      requestId: "req-call",
      phaseFrom: "PREFLOP",
      phaseTo: "FLOP",
      stateVersionBefore: 7,
      stateVersionAfter: 8,
      potTotalBefore: 8,
      potTotalAfter: 12,
      currentBetBefore: 6,
      currentBetAfter: 0,
      toCall: 4,
      actorStackBefore: 98,
      actorStackAfter: 94
    }
  });

  assert.deepEqual(result, { ok: true, newVersion: 8 });
  const actionInsert = queries.find((entry) => entry.query.startsWith("insert into public.poker_actions"));
  assert.ok(actionInsert);
  assert.equal(actionInsert.params[0], "t_action");
  assert.equal(actionInsert.params[1], 8);
  assert.equal(actionInsert.params[2], "u2");
  assert.equal(actionInsert.params[3], "CALL");
  assert.equal(actionInsert.params[4], 4);
  assert.equal(actionInsert.params[5], "hand_action");
  assert.equal(actionInsert.params[6], "req-call");
  assert.equal(actionInsert.params[7], "PREFLOP");
  assert.equal(actionInsert.params[8], "FLOP");
  const meta = JSON.parse(actionInsert.params[9]);
  assert.deepEqual(meta, {
    auditVersion: 1,
    tableId: "t_action",
    handId: "hand_action",
    actorUserId: "u2",
    action: "CALL",
    phaseFrom: "PREFLOP",
    phaseTo: "FLOP",
    stateVersionAfter: 8,
    amount: 4,
    isBot: false,
    source: "human",
    stateVersionBefore: 7,
    potTotalBefore: 8,
    potTotalAfter: 12,
    currentBetBefore: 6,
    currentBetAfter: 0,
    toCall: 4,
    actorStackBefore: 98,
    actorStackAfter: 94
  });
  assert.equal(JSON.stringify(meta).includes("AH"), false);
  assert.equal(JSON.stringify(meta).includes("AD"), false);
});

test("persisted state writer dedupes replayed accepted action audit by request_id", async () => {
  let stateVersion = 7;
  let currentState = null;
  let actionExists = false;
  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          if (stateVersion === 7) {
            stateVersion = 8;
            currentState = JSON.parse(params[2]);
            return [{ version: stateVersion }];
          }
          return [];
        }
        if (text === "update public.poker_tables set last_activity_at = now() where id = $1;") {
          return [];
        }
        if (text.startsWith("select version, state from public.poker_state where table_id = $1 limit 1;")) {
          return [{ version: stateVersion, state: currentState }];
        }
        if (text.startsWith("select id from public.poker_actions where table_id = $1 and request_id = $2")) {
          return actionExists ? [{ id: 1 }] : [];
        }
        if (text.startsWith("insert into public.poker_actions")) {
          actionExists = true;
          return [{ id: 1 }];
        }
        return [];
      }
    }),
    klog: () => {}
  });

  const nextState = { tableId: "t_action", handId: "hand_action", phase: "FLOP", potTotal: 12, stacks: { u2: 94 } };
  const acceptedActionAudit = {
    handId: "hand_action",
    actorUserId: "u2",
    action: "CALL",
    amount: 4,
    requestId: "req-call",
    phaseFrom: "PREFLOP",
    phaseTo: "FLOP"
  };

  const first = await writer.writeMutation({ tableId: "t_action", expectedVersion: 7, nextState, acceptedActionAudit });
  const second = await writer.writeMutation({ tableId: "t_action", expectedVersion: 7, nextState, acceptedActionAudit });

  assert.deepEqual(first, { ok: true, newVersion: 8 });
  assert.deepEqual(second, { ok: true, newVersion: 8, alreadyApplied: true });
  assert.equal(queries.filter((entry) => entry.query.startsWith("insert into public.poker_actions")).length, 1);
});

test("persisted state writer logs accepted action audit failures without private hole cards", async () => {
  const logs = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query) => {
        const text = String(query);
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          return [{ version: 8 }];
        }
        if (text === "update public.poker_tables set last_activity_at = now() where id = $1;") {
          return [];
        }
        if (text.startsWith("select id from public.poker_actions where table_id = $1 and request_id = $2")) {
          return [];
        }
        if (text.startsWith("insert into public.poker_actions")) {
          throw new Error("accepted_audit_insert_failed");
        }
        return [];
      }
    }),
    klog: (kind, payload) => logs.push({ kind, payload })
  });

  const result = await writer.writeMutation({
    tableId: "t_action",
    expectedVersion: 7,
    nextState: {
      tableId: "t_action",
      handId: "hand_action",
      phase: "TURN",
      holeCardsByUserId: { u2: ["AS", "KS"] },
      deck: ["QD"]
    },
    acceptedActionAudit: {
      handId: "hand_action",
      actorUserId: "u2",
      action: "CHECK",
      requestId: "req-check",
      phaseFrom: "FLOP",
      phaseTo: "TURN"
    }
  });

  assert.deepEqual(result, { ok: true, newVersion: 8 });
  assert.equal(logs.some((entry) => entry.kind === "ws_accepted_action_audit_failed"), true);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes("AS"), false);
  assert.equal(serializedLogs.includes("KS"), false);
  assert.equal(serializedLogs.includes("QD"), false);
});

test("persisted state writer appends exactly one HAND_SETTLED audit event with settlement summary", async () => {
  let stateVersion = 4;
  let currentState = null;
  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          stateVersion = 5;
          currentState = JSON.parse(params[2]);
          return [{ version: stateVersion }];
        }
        if (text === "update public.poker_tables set last_activity_at = now() where id = $1;") {
          return [];
        }
        if (text.startsWith("select id from public.poker_actions where table_id = $1 and hand_id = $2 and action_type = $3")) {
          return [];
        }
        if (text.startsWith("insert into public.poker_actions")) {
          return [{ id: 99 }];
        }
        if (text.startsWith("select version, state from public.poker_state where table_id = $1 limit 1;")) {
          return [{ version: stateVersion, state: currentState }];
        }
        return [];
      }
    }),
    klog: () => {}
  });

  const result = await writer.writeMutation({
    tableId: "t_settled",
    expectedVersion: 4,
    nextState: {
      tableId: "t_settled",
      handId: "hand_settled",
      phase: "SETTLED",
      community: ["3H", "4H", "5H", "6H", "7H"],
      seats: [{ userId: "u1", seatNo: 1, status: "ACTIVE" }, { userId: "u2", seatNo: 2, status: "ACTIVE" }],
      stacks: { u1: 110, u2: 90 },
      handSettlement: {
        handId: "hand_settled",
        settledAt: "2026-07-01T18:00:00.000Z",
        payouts: { u1: 10 }
      },
      showdown: {
        reason: "computed",
        winners: ["u1"],
        potsAwarded: [{ amount: 10, winners: ["u1"], eligibleUserIds: ["u1", "u2"] }],
        handsByUserId: {
          u1: { category: 4, name: "Straight", ranks: [7], best5: [{ r: 3, s: "H" }, { r: 4, s: "H" }, { r: 5, s: "H" }, { r: 6, s: "H" }, { r: 7, s: "H" }] },
          u2: { category: 1, name: "Pair", ranks: [2, 7, 6, 5], best5: [{ r: 2, s: "C" }, { r: 2, s: "D" }, { r: 7, s: "H" }, { r: 6, s: "H" }, { r: 5, s: "H" }] }
        }
      },
      holeCardsByUserId: { u1: ["AH", "AD"], u2: ["2C", "2D"] }
    }
  });

  assert.deepEqual(result, { ok: true, newVersion: 5 });
  const auditInsert = queries.find((entry) => entry.query.startsWith("insert into public.poker_actions"));
  assert.ok(auditInsert);
  assert.equal(auditInsert.params[3], "HAND_SETTLED");
  const auditMeta = JSON.parse(auditInsert.params[9]);
  assert.deepEqual(auditMeta, {
    auditVersion: 1,
    tableId: "t_settled",
    handId: "hand_settled",
    settledAt: "2026-07-01T18:00:00.000Z",
    reason: "computed",
    communityCards: ["3H", "4H", "5H", "6H", "7H"],
    winners: ["u1"],
    payoutByUserId: { u1: 10 },
    potsAwarded: [{ amount: 10, winners: ["u1"], eligibleUserIds: ["u1", "u2"] }],
    evaluatedHands: [
      { userId: "u1", category: 4, name: "Straight", ranks: [7], bestFiveCards: ["3H", "4H", "5H", "6H", "7H"] },
      { userId: "u2", category: 1, name: "Pair", ranks: [2, 7, 6, 5], bestFiveCards: ["2C", "2D", "7H", "6H", "5H"] }
    ]
  });
});

test("persisted state writer does not duplicate HAND_SETTLED audit on replayed settlement write", async () => {
  let stateVersion = 4;
  let currentState = null;
  let auditExists = false;
  const queries = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        queries.push({ query: text, params });
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          if (stateVersion === 4) {
            stateVersion = 5;
            currentState = JSON.parse(params[2]);
            return [{ version: stateVersion }];
          }
          return [];
        }
        if (text === "update public.poker_tables set last_activity_at = now() where id = $1;") {
          return [];
        }
        if (text.startsWith("select version, state from public.poker_state where table_id = $1 limit 1;")) {
          return [{ version: stateVersion, state: currentState }];
        }
        if (text.startsWith("select id from public.poker_actions where table_id = $1 and hand_id = $2 and action_type = $3")) {
          return auditExists ? [{ id: 1 }] : [];
        }
        if (text.startsWith("insert into public.poker_actions")) {
          auditExists = true;
          return [{ id: 1 }];
        }
        return [];
      }
    }),
    klog: () => {}
  });

  const nextState = {
    tableId: "t_settled",
    handId: "hand_settled",
    phase: "SETTLED",
    community: ["3H", "4H", "5H", "6H", "7H"],
    seats: [{ userId: "u1", seatNo: 1, status: "ACTIVE" }, { userId: "u2", seatNo: 2, status: "ACTIVE" }],
    stacks: { u1: 110, u2: 90 },
    handSettlement: { handId: "hand_settled", settledAt: "2026-07-01T18:00:00.000Z", payouts: { u1: 10 } },
    showdown: { reason: "all_folded", winners: ["u1"], potsAwarded: [{ amount: 10, winners: ["u1"], eligibleUserIds: ["u1"] }] }
  };

  const first = await writer.writeMutation({ tableId: "t_settled", expectedVersion: 4, nextState });
  const second = await writer.writeMutation({ tableId: "t_settled", expectedVersion: 4, nextState });

  assert.deepEqual(first, { ok: true, newVersion: 5 });
  assert.deepEqual(second, { ok: true, newVersion: 5, alreadyApplied: true });
  assert.equal(queries.filter((entry) => entry.query.startsWith("insert into public.poker_actions")).length, 1);
});

test("persisted state writer logs settlement audit failures without private hole cards", async () => {
  const logs = [];
  const writer = createPersistedStateWriter({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({
      unsafe: async (query, params = []) => {
        const text = String(query);
        if (text.startsWith("update public.poker_state set version = version + 1")) {
          return [{ version: 5 }];
        }
        if (text === "update public.poker_tables set last_activity_at = now() where id = $1;") {
          return [];
        }
        if (text.startsWith("select id from public.poker_actions where table_id = $1 and hand_id = $2 and action_type = $3")) {
          return [];
        }
        if (text.startsWith("insert into public.poker_actions")) {
          throw new Error("audit_insert_failed");
        }
        return [];
      }
    }),
    klog: (kind, payload) => logs.push({ kind, payload })
  });

  const result = await writer.writeMutation({
    tableId: "t_settled",
    expectedVersion: 4,
    nextState: {
      tableId: "t_settled",
      handId: "hand_settled",
      phase: "SETTLED",
      community: ["3H", "4H", "5H", "6H", "7H"],
      handSettlement: { handId: "hand_settled", settledAt: "2026-07-01T18:00:00.000Z", payouts: { u1: 10 } },
      showdown: { reason: "all_folded", winners: ["u1"], potsAwarded: [{ amount: 10, winners: ["u1"], eligibleUserIds: ["u1"] }] },
      holeCardsByUserId: { u1: ["AH", "AD"] }
    }
  });

  assert.deepEqual(result, { ok: true, newVersion: 5 });
  assert.equal(logs.some((entry) => entry.kind === "ws_hand_settlement_audit_failed"), true);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes("AH"), false);
  assert.equal(serializedLogs.includes("AD"), false);
});
