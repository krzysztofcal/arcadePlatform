import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId = "leave-replay";

const stored = {
  version: 9,
  stateUpdates: 0,
  requests: new Map(),
  state: {
    tableId,
    phase: "PREFLOP",
    seats: [
      { userId: humanUserId, seatNo: 1 },
      { userId: botUserId, seatNo: 2 },
    ],
    stacks: { [humanUserId]: 100, [botUserId]: 100 },
    pot: 0,
    turnUserId: humanUserId,
    toCallByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    betThisRoundByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
    foldedByUserId: { [humanUserId]: false, [botUserId]: false },
    leftTableByUserId: { [humanUserId]: false, [botUserId]: false },
    sitOutByUserId: { [humanUserId]: false, [botUserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [humanUserId]: false, [botUserId]: false },
    contributionsByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    community: [],
    deck: [{ r: "A", s: "S" }, { r: "K", s: "H" }],
    currentBet: 0,
    lastRaiseSize: 0,
    dealerSeatNo: 1,
  },
};

const keyFor = (params) => `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
  isValidUuid: () => true,
  normalizeRequestId: (value) => ({ ok: true, value }),
  updatePokerStateOptimistic,
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) {
          return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        }
        if (text.includes("from public.poker_requests")) {
          const row = stored.requests.get(keyFor(params));
          return row ? [{ result_json: row.resultJson, created_at: row.createdAt }] : [];
        }
        if (text.includes("insert into public.poker_requests")) {
          const key = keyFor(params);
          if (!stored.requests.has(key)) stored.requests.set(key, { resultJson: null, createdAt: new Date().toISOString() });
          return [{ request_id: params?.[2] }];
        }
        if (text.includes("update public.poker_requests")) {
          const key = keyFor(params);
          const row = stored.requests.get(key) || { createdAt: new Date().toISOString() };
          row.resultJson = params?.[4] ?? null;
          stored.requests.set(key, row);
          return [{ request_id: params?.[2] }];
        }
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          stored.state = JSON.parse(params?.[2] || "{}");
          stored.version += 1;
          stored.stateUpdates += 1;
          return [{ version: stored.version }];
        }
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const event = {
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId }),
};

const first = await handler(event);
const second = await handler(event);

assert.equal(first.statusCode, 200);
assert.equal(second.statusCode, 200);
const firstBody = JSON.parse(first.body || "{}");
const secondBody = JSON.parse(second.body || "{}");
assert.equal(firstBody.ok, true);
assert.deepEqual(secondBody, firstBody);
assert.equal(stored.stateUpdates, 1);
assert.equal(firstBody.state?.state?.deck, undefined);
assert.equal(secondBody.state?.state?.deck, undefined);

console.log("poker-leave idempotent replay behavior test passed");
