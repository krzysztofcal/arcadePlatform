import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-rejoin";
const logs = [];
const queries = [];

const handler = loadPokerHandler("netlify/functions/poker-join.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
  loadPokerStateForUpdate,
  updatePokerStateLocked,
  patchLeftTableByUserId,
  patchSitOutByUserId,
  isStateStorageValid,
  getBotConfig: () => ({ enabled: false }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        queries.push({ query: String(query), params });
        const text = String(query).toLowerCase();
        const sqlNormalized = String(query).replace(/\s+/g, " ").trim().toLowerCase();
        if (text.includes("from public.poker_requests")) return [];
        if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
        if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
        if (text.includes("delete from public.poker_requests")) return [];
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", max_players: 6, stakes: null }];
        if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) return [{ seat_no: 3 }];
        if (sqlNormalized.includes("update public.poker_seats set status = 'active'")) return [];
        if (text.includes("from public.poker_state") && text.includes("for update")) {
          return [{ version: 1, state: JSON.stringify({ tableId, seats: [], stacks: {}, pot: 0, phase: "INIT", leftTableByUserId: {}, sitOutByUserId: {} }) }];
        }
        if (sqlNormalized.includes("update public.poker_state") && sqlNormalized.includes("version = version + 1")) return [{ version: 2 }];
        if (text.includes("update public.poker_tables")) return [];
        throw new Error(`unhandled_sql: ${sqlNormalized}`);
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-rejoin" } }),
  klog: (event, payload) => logs.push({ event, payload }),
  HEARTBEAT_INTERVAL_SEC: 15,
});

const run = async () => {
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 0, buyIn: 100, requestId: "rejoin-log" }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).seatNo, 2);

  const stackLog = logs.find((entry) => entry?.event === "poker_join_stack_persisted");
  assert.ok(stackLog, "rejoin should emit poker_join_stack_persisted");
  assert.equal(stackLog.payload?.seatNoUi, 2);

  const okLog = logs.find((entry) => entry?.event === "poker_join_ok");
  assert.ok(okLog, "rejoin should emit poker_join_ok");
  assert.equal(okLog.payload?.seatNoUi, 2);

  const seatLogs = logs.filter((entry) => entry?.event === "poker_join_stack_persisted" || entry?.event === "poker_join_ok");
  assert.equal(seatLogs.some((entry) => entry?.payload?.seatNoUi === 0), false, "rejoin seat logs should not use request seat number");

  const insertAttempts = queries.filter((entry) => String(entry.query).toLowerCase().includes("insert into public.poker_seats")).length;
  assert.equal(insertAttempts, 0, "rejoin should not insert a new seat row");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
