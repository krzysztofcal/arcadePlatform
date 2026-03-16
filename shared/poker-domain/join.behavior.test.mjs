import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executePokerJoinAuthoritative } from "./join.mjs";

test("shared join module imports without Netlify adapter dependency at module load", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "join-import-"));
  const stagedDir = path.join(tempDir, "shared", "poker-domain");
  const stagedJoin = path.join(stagedDir, "join.mjs");
  try {
    await fs.mkdir(stagedDir, { recursive: true });
    await fs.copyFile("shared/poker-domain/join.mjs", stagedJoin);
    const module = await import(pathToFileURL(stagedJoin).href);
    assert.equal(typeof module.executePokerJoinAuthoritative, "function");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects malformed stringified state with state_invalid", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("status = 'ACTIVE'")) return [];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: "{bad" }];
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r1",
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true })
    }),
    (error) => error?.code === "state_invalid"
  );
});

test("returns canonical db seat number and persisted stack on rejoin", async () => {
  let reads = 0;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) {
          reads += 1;
          if (reads === 1) return [{ seat_no: 4 }];
          return [{ seat_no: 4, stack: 330 }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u1",
    requestId: "r2",
    buyIn: 120,
    postTransactionFn: async () => ({ ok: true })
  });

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.equal(result.rejoin, true);
  assert.equal(result.stack, 330);
});

test("maps unique insert conflicts to seat_taken", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("insert into public.poker_seats")) {
            const err = new Error("duplicate key");
            err.code = "23505";
            err.constraint = "poker_seats_table_id_seat_no_key";
            throw err;
          }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r3",
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true })
    }),
    (error) => error?.code === "seat_taken"
  );
});

test("authoritative join rejects when financial mutation fails", async () => {
  const writes = [];
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql, params) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("update public.poker_state set state")) { writes.push(params[1]); return [{ ok: true }]; }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r4",
      buyIn: 200,
      postTransactionFn: async () => {
        const err = new Error("insufficient_funds");
        err.code = "insufficient_funds";
        throw err;
      }
    }),
    (error) => error?.code === "insufficient_funds"
  );
  assert.equal(writes.length, 0);
});

test("authoritative join funds stack only after financial mutation succeeds", async () => {
  const sequence = [];
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
        if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [{ seat_no: 1 }];
        if (sql.includes("insert into public.poker_seats")) { sequence.push('insert_seat'); return [{ seat_no: 3 }]; }
        if (sql.includes("update public.poker_seats set stack")) { sequence.push('update_stack'); return [{ ok: true }]; }
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state set state")) { sequence.push('update_state'); return [{ ok: true }]; }
        return [];
      }
    }),
    tableId: "t1",
    userId: "u1",
    requestId: "r5",
    seatNo: 3,
    buyIn: 250,
    postTransactionFn: async () => { sequence.push('ledger_buyin'); return { ok: true }; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.stack, 250);
  assert.deepEqual(sequence, ['insert_seat', 'ledger_buyin', 'update_stack', 'update_state']);
});

test("authoritative auto-seat respects preferred seat and initializes stack from buyIn", async () => {
  const writes = [];
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
        if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [{ seat_no: 1 }, { seat_no: 2 }, { seat_no: 5 }];
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state set state")) { writes.push(JSON.parse(params[1])); return [{ ok: true }]; }
        return [];
      }
    }),
    tableId: "t1",
    userId: "u2",
    requestId: "r7",
    autoSeat: true,
    preferredSeatNo: 2,
    buyIn: 180,
    postTransactionFn: async () => ({ ok: true })
  });

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 3);
  assert.equal(result.stack, 180);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].stacks.u2, 180);
});


test("rejoin with invalid persisted stack fails closed and does not write state", async () => {
  const writes = { state: 0 };
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql, params) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2") && !sql.includes("seat_no, stack")) return [{ seat_no: 4 }];
          if (sql.includes("seat_no, stack")) return [{ seat_no: 4, stack: 0 }];
          if (sql.includes("update public.poker_state set state")) { writes.state += 1; return [{ ok: true }]; }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r8",
      buyIn: 999,
      postTransactionFn: async () => ({ ok: true })
    }),
    (error) => error?.code === "state_invalid"
  );
  assert.equal(writes.state, 0);
});

test("duplicate buyin idempotency without funded persisted stack fails closed", async () => {
  const writes = { state: 0, seatStackUpdate: 0 };
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2") && !sql.includes("seat_no, stack")) return [];
          if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("insert into public.poker_seats")) return [{ seat_no: 2 }];
          if (sql.includes("seat_no, stack")) return [{ seat_no: 2, stack: 0 }];
          if (sql.includes("update public.poker_seats set stack")) { writes.seatStackUpdate += 1; return [{ ok: true }]; }
          if (sql.includes("update public.poker_state set state")) { writes.state += 1; return [{ ok: true }]; }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u3",
      requestId: "r9",
      seatNo: 2,
      buyIn: 150,
      postTransactionFn: async () => {
        const err = new Error("duplicate idempotency");
        err.code = "23505";
        err.constraint = "chips_transactions_idempotency_key_unique";
        throw err;
      }
    }),
    (error) => error?.code === "state_invalid"
  );
  assert.equal(writes.seatStackUpdate, 0);
  assert.equal(writes.state, 0);
});
