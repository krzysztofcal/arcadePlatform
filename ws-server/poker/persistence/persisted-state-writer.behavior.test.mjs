import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPersistedStateWriter } from "./persisted-state-writer.mjs";

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
