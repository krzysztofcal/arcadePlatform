import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const makeHandler = ({ mode }) => {
  const marks = [];
  const handler = loadPokerHandler("netlify/functions/poker-join.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase().replace(/\s+/g, " ").trim();
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_tables") && text.includes("limit 1;") && !text.includes("for update")) {
            return [{ id: tableId, status: "OPEN", max_players: 2, stakes: '{"sb":1,"bb":2}' }];
          }
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) return [];
          if (text.includes("insert into public.poker_seats")) {
            const err = new Error("seat_taken");
            err.code = "23505";
            err.constraint = "poker_seats_table_id_seat_no_key";
            throw err;
          }
          if (text.includes("from public.poker_tables") && text.includes("for update")) return [{ id: tableId }];
          if (text.includes("with candidate as") && text.includes("set leave_after_hand = true")) {
            if (mode === "eligible") {
              marks.push({ userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", seatNo: 2 });
              return [{ user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", seat_no: 2 }];
            }
            return [];
          }
          if (text.includes("coalesce(leave_after_hand, false) = true")) {
            if (mode === "already_marked") return [{ user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", seat_no: 2 }];
            return [];
          }
          if (text.includes("status = 'active'") && text.includes("order by seat_no asc")) {
            if (mode === "seat_taken_not_full") return [{ seat_no: 1 }];
            return [{ seat_no: 1 }, { seat_no: 2 }];
          }
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    loadPokerStateForUpdate: async () => ({ ok: true, state: { tableId, seats: [], stacks: {}, pot: 0, phase: "INIT" } }),
    updatePokerStateLocked: async () => ({ ok: true, newVersion: 2 }),
    patchLeftTableByUserId: (state) => ({ changed: false, nextState: state }),
    patchSitOutByUserId: (state) => ({ changed: false, nextState: state }),
    clearMissedTurns: (state) => ({ changed: false, nextState: state }),
    isStateStorageValid: () => true,
    getBotConfig: () => ({ enabled: false }),
    klog: () => {},
    HEARTBEAT_INTERVAL_SEC: 15,
  });
  return { handler, marks };
};

const callJoin = (handler, requestId, overrides) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 0, autoSeat: true, preferredSeatNo: 0, buyIn: 100, requestId, ...(overrides || {}) }),
  });

const run = async () => {
  const eligible = makeHandler({ mode: "eligible" });
  const resEligible = await callJoin(eligible.handler, "join-eligible");
  assert.equal(resEligible.statusCode, 409);
  assert.equal(JSON.parse(resEligible.body || "{}").error, "table_full_bot_leaving");
  assert.equal(eligible.marks.length, 1);


  const nonAutoSeatTakenNotFull = makeHandler({ mode: "seat_taken_not_full" });
  const resNonAuto = await callJoin(nonAutoSeatTakenNotFull.handler, "join-non-auto-seat-taken-not-full", { autoSeat: false, seatNo: 1 });
  assert.equal(resNonAuto.statusCode, 409);
  assert.equal(JSON.parse(resNonAuto.body || "{}").error, "seat_taken");
  assert.equal(nonAutoSeatTakenNotFull.marks.length, 0);

  const noBots = makeHandler({ mode: "none" });
  const resNoBots = await callJoin(noBots.handler, "join-no-bot");
  assert.equal(resNoBots.statusCode, 409);
  assert.equal(JSON.parse(resNoBots.body || "{}").error, "table_full");

  const alreadyMarked = makeHandler({ mode: "already_marked" });
  const resAlready = await callJoin(alreadyMarked.handler, "join-already-marked");
  assert.equal(resAlready.statusCode, 409);
  assert.equal(JSON.parse(resAlready.body || "{}").error, "table_full_bot_leaving");
  assert.equal(alreadyMarked.marks.length, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
