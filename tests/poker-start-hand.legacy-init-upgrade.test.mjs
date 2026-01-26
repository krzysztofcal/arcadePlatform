import assert from "node:assert/strict";
import { dealHoleCards } from "../netlify/functions/_shared/poker-engine.mjs";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import {
  getRng,
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  upgradeLegacyInitState,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "u1";

const legacyInitState = {
  tableId,
  seats: [
    { userId: "u2", seatNo: 1 },
    { userId: "u1", seatNo: 0 },
  ],
  stacks: { u1: 100, u2: 100 },
  pot: 0,
  phase: "INIT",
};

const makeHandler = (storedState, updates) =>
  loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    deriveDeck,
    dealHoleCards,
    extractBearerToken: () => "token",
    getRng,
    isPlainObject,
    isStateStorageValid,
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    upgradeLegacyInitState,
    withoutPrivateState,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN" }];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 1, state: JSON.parse(storedState.value) }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: "u1", seat_no: 0, status: "ACTIVE" },
              { user_id: "u2", seat_no: 1, status: "ACTIVE" },
            ];
          }
          if (text.includes("update public.poker_state")) {
            storedState.value = params?.[1] || null;
            const parsedState = storedState.value ? JSON.parse(storedState.value) : null;
            updates.push({ query: String(query), params, state: parsedState });
            if (text.includes("version = version + 1")) {
              return [{ version: 2, state: storedState.value }];
            }
            return [];
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            return [];
          }
          if (text.includes("insert into public.poker_actions")) {
            return [];
          }
          return [];
        },
      }),
    klog: () => {},
  });

const run = async () => {
  const storedState = { value: JSON.stringify(legacyInitState) };
  const updates = [];
  const handler = makeHandler(storedState, updates);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-legacy" }),
  });

  const payload = JSON.parse(response.body);
  assert.notEqual(payload?.error, "state_invalid");
  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);

  const upgradeUpdate = updates.find((entry) => entry.state?.phase === "INIT");
  assert.ok(upgradeUpdate, "expected INIT upgrade update");
  const upgradedState = upgradeUpdate.state;
  assert.ok(Array.isArray(upgradedState.community));
  assert.equal(upgradedState.toCallByUserId.u1, 0);
  assert.equal(upgradedState.toCallByUserId.u2, 0);
  assert.equal(upgradedState.dealerSeatNo, 0);
  assert.equal(upgradedState.turnUserId, "u1");
  assert.deepEqual(Object.keys(upgradedState.toCallByUserId).sort(), ["u1", "u2"]);
};

await run();
