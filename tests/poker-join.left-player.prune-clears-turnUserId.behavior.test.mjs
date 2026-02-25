import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { clearMissedTurns } from "../netlify/functions/_shared/poker-missed-turns.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-left";

const writes = [];

const initialState = {
  tableId,
  phase: "PREFLOP",
  seats: [
    { userId: "other-1", seatNo: 1 },
    { userId, seatNo: 3 },
  ],
  handSeats: [
    { userId: "other-1", seatNo: 1 },
    { userId, seatNo: 3 },
  ],
  leftTableByUserId: { [userId]: true, "other-1": false },
  sitOutByUserId: { [userId]: false, "other-1": false },
  foldedByUserId: { [userId]: false, "other-1": false },
  allInByUserId: { [userId]: false, "other-1": false },
  stacks: { [userId]: 200, "other-1": 250 },
  missedTurnsByUserId: { [userId]: 1 },
  pot: 10,
  turnUserId: userId,
};

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
  clearMissedTurns,
  isStateStorageValid,
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_requests")) return [];
        if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
        if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
        if (text.includes("delete from public.poker_requests")) return [];
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", max_players: 6 }];
        if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) {
          return [{ seat_no: 3 }];
        }
        if (text.includes("update public.poker_seats set status = 'active'")) return [];
        if (text.includes("from public.poker_state") && text.includes("for update")) {
          return [{ version: 7, state: JSON.stringify(initialState) }];
        }
        if (text.includes("update public.poker_state")) {
          writes.push(JSON.parse(params?.[1] || "{}"));
          return [{ version: 8, state: params?.[1] }];
        }
        if (text.includes("update public.poker_tables set last_activity_at = now()")) return [];
        return [];
      },
    }),
  klog: () => {},
  HEARTBEAT_INTERVAL_SEC: 15,
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, seatNo: 2, buyIn: 100, requestId: "join-left-turn-1" }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);

assert.ok(writes.length >= 1, "join should persist guarded state");
const latest = writes[writes.length - 1];
assert.equal(latest.leftTableByUserId?.[userId], true);
assert.equal((latest.handSeats || []).some((seat) => seat?.userId === userId), false);
assert.notEqual(latest.turnUserId, userId, "turnUserId must move off the pruned player");
assert.equal(latest.turnUserId, "other-1", "turn should move to next eligible hand participant");

console.log("poker-join left-player prune clears turnUserId behavior test passed");
