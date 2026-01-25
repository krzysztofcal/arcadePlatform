import assert from "node:assert/strict";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { isPlainObject, isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";

const initState = {
  tableId,
  phase: "INIT",
  seats: [
    { userId: "user-1", seatNo: 1 },
    { userId: "user-2", seatNo: 2 },
  ],
  stacks: { "user-1": 100, "user-2": 100 },
  pot: 0,
  community: [],
  dealerSeatNo: 1,
  turnUserId: "user-1",
  handId: "hand-init",
  handSeed: "seed-init",
  communityDealt: 0,
  toCallByUserId: { "user-1": 0, "user-2": 0 },
  betThisRoundByUserId: { "user-1": 0, "user-2": 0 },
  actedThisRoundByUserId: { "user-1": false, "user-2": false },
  foldedByUserId: { "user-1": false, "user-2": false },
  lastAggressorUserId: null,
  lastActionRequestIdByUserId: {},
};

const makeHandler = (storedState, klogCalls) =>
  loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    isValidUuid: () => true,
    normalizeRequestId,
    isPlainObject,
    isStateStorageValid,
    normalizeJsonState,
    withoutPrivateState,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN" }];
          }
          if (text.includes("from public.poker_seats")) {
            const hasActive = text.includes("status = 'active'");
            const hasUserFilter = text.includes("user_id = $2");
            const okParams = Array.isArray(params) && params.length >= 2 && params[0] === tableId && params[1] === "user-1";
            if (hasActive && hasUserFilter && okParams) return [{ user_id: "user-1" }];
            if (hasActive) {
              return [
                { user_id: "user-1", seat_no: 1 },
                { user_id: "user-2", seat_no: 2 },
              ];
            }
            return [];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: storedState.version, state: JSON.parse(storedState.value) }];
          }
          return [];
        },
      }),
    klog: klogCalls ? (kind, data) => klogCalls.push({ kind, data }) : undefined,
  });

const run = async () => {
  const storedState = { value: JSON.stringify(initState), version: 1 };
  const klogCalls = [];
  const handler = makeHandler(storedState, klogCalls);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-init", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error, "hand_not_started");
  assert.ok(
    klogCalls.some((entry) => entry.kind === "poker_act_rejected" && entry.data?.reason === "hand_not_started")
  );
};

await run();
