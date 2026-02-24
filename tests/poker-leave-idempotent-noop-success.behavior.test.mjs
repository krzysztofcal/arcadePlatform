import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const storedRequests = new Map();
const queryLog = [];
const keyFor = (params) => `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: (value) => ({ ok: true, value }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        queryLog.push(text);
        if (text.includes("from public.poker_requests")) {
          const row = storedRequests.get(keyFor(params));
          return row ? [{ result_json: row.resultJson, created_at: row.createdAt }] : [];
        }
        if (text.includes("insert into public.poker_requests")) {
          const key = keyFor(params);
          if (!storedRequests.has(key)) storedRequests.set(key, { resultJson: null, createdAt: new Date().toISOString() });
          return [{ request_id: params?.[2] }];
        }
        if (text.includes("update public.poker_requests")) {
          const key = keyFor(params);
          const row = storedRequests.get(key) || { createdAt: new Date().toISOString() };
          row.resultJson = params?.[4] ?? null;
          storedRequests.set(key, row);
          return [{ request_id: params?.[2] }];
        }
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) {
          return [{ version: 5, state: { tableId, phase: "INIT", seats: [], stacks: {}, pot: 0, deck: [{ r: "A", s: "S" }], holeCardsByUserId: { [userId]: [{ r: "K", s: "H" }, { r: "Q", s: "D" }] } } }];
        }
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [];
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          throw new Error("unexpected state mutation");
        }
        if (text.includes("insert into public.poker_actions")) {
          throw new Error("unexpected action mutation");
        }
        return [];
      },
    }),
  klog: () => {},
});

const makeEvent = (requestId) => ({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId, includeState: true }),
});

const first = await handler(makeEvent("leave-1"));
const replay = await handler(makeEvent("leave-1"));
const secondRequest = await handler(makeEvent("leave-2"));

assert.equal(first.statusCode, 200);
assert.equal(replay.statusCode, 200);
assert.equal(secondRequest.statusCode, 200);

const firstBody = JSON.parse(first.body || "{}");
const replayBody = JSON.parse(replay.body || "{}");
const secondBody = JSON.parse(secondRequest.body || "{}");

assert.equal(firstBody.ok, true);
assert.equal(firstBody.status, "already_left");
assert.deepEqual(replayBody, firstBody);
assert.equal(secondBody.ok, true);
assert.equal(secondBody.status, "already_left");

const stateMutations = queryLog.filter((q) => q.includes("update public.poker_state") && q.includes("version = version + 1"));
const actionMutations = queryLog.filter((q) => q.includes("insert into public.poker_actions"));
assert.equal(stateMutations.length, 0);
assert.equal(actionMutations.length, 0);
assert.equal(firstBody.state?.state?.deck, undefined);
assert.equal(firstBody.state?.state?.holeCardsByUserId, undefined);

console.log("poker-leave idempotent noop success behavior test passed");
