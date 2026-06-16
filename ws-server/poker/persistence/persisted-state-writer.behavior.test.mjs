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
