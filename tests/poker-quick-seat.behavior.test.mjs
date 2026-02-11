import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isStateStorageValid, normalizeJsonState } from "../netlify/functions/_shared/poker-state-utils.mjs";

const userId = "user-quick";

const callQuickSeat = async (handler, body = {}) => {
  return handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
};

const makeHandler = ({ mode, queries }) =>
  loadPokerHandler("netlify/functions/poker-quick-seat.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    beginSql: async (fn) => {
      return fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();

          if (text.includes("pg_advisory_xact_lock")) return [];

          if (
            text.includes("from public.poker_tables t") &&
            text.includes("where t.status = 'open'") &&
            text.includes("t.max_players = $1") &&
            text.includes("t.stakes = $2::jsonb")
          ) {
            const requireHuman = params?.[2] === true;
            if (mode === "prefer_humans" || mode === "already_seated") {
              if (requireHuman) return [{ id: "table-human", max_players: 6 }];
              return [];
            }
            if (mode === "any_open") {
              if (requireHuman) return [];
              return [{ id: "table-any", max_players: 6 }];
            }
            return [];
          }

          if (text.includes("where table_id = $1 and user_id = $2 limit 1")) {
            if (mode === "already_seated") return [{ seat_no: 2 }];
            return [];
          }

          if (text.includes("where table_id = $1 and status = 'active' order by seat_no asc")) {
            if (mode === "prefer_humans") return [{ seat_no: 1 }, { seat_no: 2 }];
            if (mode === "any_open") return [{ seat_no: 1 }];
            return [];
          }

          if (text.includes("insert into public.poker_tables")) {
            return [{ id: "table-new" }];
          }

          if (text.includes("insert into public.poker_state")) return [];
          if (text.includes("from public.chips_accounts")) return [{ id: "escrow-1" }];
          if (text.includes("update public.poker_tables")) return [];
          return [];
        },
      });
    },
    klog: () => {},
  });

const findLockCall = (queries) =>
  queries.find((entry) => entry.query.toLowerCase().includes("pg_advisory_xact_lock(hashtext($1))"));

const assertCanonicalLockKey = (queries, expectedKey) => {
  const lockCall = findLockCall(queries);
  assert.ok(lockCall, "quick seat should issue advisory lock query");
  assert.equal(lockCall?.params?.[0], expectedKey);
};

const run = async () => {
  {
    const queries = [];
    const handler = makeHandler({ mode: "prefer_humans", queries });
    const res = await callQuickSeat(handler, { stakes: "1/2", maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-human");
    assert.equal(body.seatNo, 2);
    assert.ok(body.seatNo >= 0 && body.seatNo <= 5);
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("coalesce(hs.is_bot, false) = false")),
      "quick seat should prefer tables with at least one human"
    );
    assertCanonicalLockKey(queries, "quickseat:6:1:2");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("where table_id = $1 and status = 'active' order by seat_no asc")),
      "quick seat should read active seats to suggest a seat"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when recommending"
    );
  }

  {
    const queries = [];
    const handler = makeHandler({ mode: "any_open", queries });
    const res = await callQuickSeat(handler, { stakes: "1/2", maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-any");
    assert.equal(body.seatNo, 1);
    assert.ok(body.seatNo >= 0 && body.seatNo <= 5);
    assertCanonicalLockKey(queries, "quickseat:6:1:2");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("where table_id = $1 and status = 'active' order by seat_no asc")),
      "quick seat should read active seats before returning a recommendation"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when recommending"
    );
  }

  {
    const queries = [];
    const handler = makeHandler({ mode: "already_seated", queries });
    const res = await callQuickSeat(handler, { stakes: "1/2", maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-human");
    assert.equal(body.seatNo, 1);
    assertCanonicalLockKey(queries, "quickseat:6:1:2");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("where table_id = $1 and user_id = $2 limit 1")),
      "quick seat should check existing seat for idempotency"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when returning existing seat"
    );
  }

  {
    const queries = [];
    const handler = makeHandler({ mode: "create", queries });
    const res = await callQuickSeat(handler, { stakes: "1/2", maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-new");
    assert.equal(body.seatNo, 0);
    assert.ok(body.seatNo >= 0 && body.seatNo <= 5);
    assertCanonicalLockKey(queries, "quickseat:6:1:2");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables")),
      "quick seat should create a table when none is available"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_state")),
      "quick seat should initialize canonical poker_state when creating table"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when creating"
    );
    const stateInsertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_state"));
    assert.ok(stateInsertCall, "quick seat create path should insert poker_state");
    const storedState = normalizeJsonState(stateInsertCall?.params?.[1]);
    assert.equal(isStateStorageValid(storedState), true, "quick seat create path should persist a storage-valid init state");
    assert.ok(
      !queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_seats")),
      "quick seat should not seat the user directly"
    );
  }
  {
    const queries = [];
    const state = { created: false };
    const handler = loadPokerHandler("netlify/functions/poker-quick-seat.mjs", {
      baseHeaders: () => ({}),
      corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
      extractBearerToken: () => "token",
      verifySupabaseJwt: async () => ({ valid: true, userId }),
      beginSql: async (fn) => {
        return fn({
          unsafe: async (query, params) => {
            queries.push({ query: String(query), params });
            const text = String(query).toLowerCase();

            if (text.includes("pg_advisory_xact_lock")) return [];

            if (
              text.includes("from public.poker_tables t") &&
              text.includes("where t.status = 'open'") &&
              text.includes("t.max_players = $1") &&
              text.includes("t.stakes = $2::jsonb")
            ) {
              if (state.created) return [{ id: "table-created", max_players: 6 }];
              return [];
            }

            if (text.includes("where table_id = $1 and user_id = $2 limit 1")) return [];
            if (text.includes("where table_id = $1 and status = 'active' order by seat_no asc")) return [];
            if (text.includes("insert into public.poker_tables")) {
              state.created = true;
              return [{ id: "table-created" }];
            }
            if (text.includes("insert into public.poker_state")) return [];
            if (text.includes("from public.chips_accounts")) return [{ id: "escrow-1" }];
            if (text.includes("update public.poker_tables")) return [];
            return [];
          },
        });
      },
      klog: () => {},
    });

    const first = await callQuickSeat(handler, { stakes: { bb: 2, sb: 1 }, maxPlayers: 6 });
    const firstBody = JSON.parse(first.body);
    assert.equal(first.statusCode, 200);
    assert.equal(firstBody.tableId, "table-created");

    const second = await callQuickSeat(handler, { stakes: "1/2", maxPlayers: 6 });
    const secondBody = JSON.parse(second.body);
    assert.equal(second.statusCode, 200);
    assert.equal(secondBody.tableId, "table-created");

    const createCalls = queries.filter((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables"));
    assert.equal(createCalls.length, 1, "serialized matchmaking should avoid creating a second table when existing table is open");

    const lockCalls = queries.filter((entry) => entry.query.toLowerCase().includes("pg_advisory_xact_lock(hashtext($1))"));
    assert.equal(lockCalls.length, 2);
    assert.equal(lockCalls[0]?.params?.[0], "quickseat:6:1:2");
    assert.equal(lockCalls[1]?.params?.[0], "quickseat:6:1:2");
  }

};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
