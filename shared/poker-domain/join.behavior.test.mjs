import test from "node:test";
import assert from "node:assert/strict";
import { executePokerJoinAuthoritative } from "./join.mjs";

test("rejects malformed stringified state with state_invalid", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("status = 'ACTIVE'")) return [];
          if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2")) return [];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: "{bad" }];
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r1"
    }),
    (error) => error?.code === "state_invalid"
  );
});

test("returns canonical db seat number without conversion", async () => {
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [{ seat_no: 4 }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u1",
    requestId: "r2"
  });

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.equal(result.rejoin, true);
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
      requestId: "r3"
    }),
    (error) => error?.code === "seat_taken"
  );
});

test("does not remap non-conflict insert failures to seat_taken", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("insert into public.poker_seats")) {
            const err = new Error("db_down");
            err.code = "57P01";
            throw err;
          }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r4"
    }),
    (error) => error?.code === "57P01"
  );
});

test("inactive historical seat does not trigger rejoin shortcut", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("insert into public.poker_seats")) return [];
          if (sql.includes("select version, state from public.poker_state")) return [];
          return [];
        }
      }),
      tableId: "t1",
      userId: "historical_user",
      requestId: "r5"
    }),
    (error) => error?.code === "state_missing"
  );
});
