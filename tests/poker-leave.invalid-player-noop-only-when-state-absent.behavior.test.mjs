import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const buildHandler = ({ state, seatNo = 4, seatStack = 0, withSeatRow = true }) => {
  let stateUpdateCount = 0;
  let seatDeleteCount = 0;
  let postTransactionCalls = 0;

  const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value || null }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) return [{ version: 7, state }];
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return withSeatRow ? [{ seat_no: seatNo, status: "ACTIVE", stack: seatStack }] : [];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateUpdateCount += 1;
            return [{ version: 8 }];
          }
          if (text.includes("delete from public.poker_seats")) {
            seatDeleteCount += 1;
            return [];
          }
          return [];
        },
      }),
    postTransaction: async () => {
      postTransactionCalls += 1;
      return { transaction: { id: "unexpected" } };
    },
    applyLeaveTable: () => {
      const err = new Error("invalid_player");
      err.code = "invalid_player";
      throw err;
    },
    klog: () => {},
  });

  return { handler, counters: () => ({ stateUpdateCount, seatDeleteCount, postTransactionCalls }) };
};

const run = async () => {
  const absentState = { tableId, phase: "INIT", seats: [], stacks: {}, pot: 0 };
  const absent = buildHandler({ state: absentState, withSeatRow: true });
  const absentResponse = await absent.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true }),
  });

  assert.equal(absentResponse.statusCode, 200);
  const absentBody = JSON.parse(absentResponse.body || "{}");
  assert.equal(absentBody.ok, true);
  assert.equal(absentBody.status, "already_left");
  assert.equal(absentBody.cashedOut, 0);
  const absentViewState = absentBody.viewState || absentBody.state?.state || null;
  if (absentViewState) {
    const absentSeats = Array.isArray(absentViewState.seats) ? absentViewState.seats : [];
    const absentStacks = absentViewState.stacks && typeof absentViewState.stacks === "object" ? absentViewState.stacks : {};
    assert.equal(absentSeats.some((seat) => seat?.userId === userId), false);
    assert.equal(Object.prototype.hasOwnProperty.call(absentStacks, userId), false);
  }
  assert.equal(absent.counters().postTransactionCalls, 0);
  assert.equal(absent.counters().stateUpdateCount, 0);
  assert.equal(absent.counters().seatDeleteCount, 1);

  const presentState = { tableId, phase: "INIT", seats: [{ userId, seatNo: 4 }], stacks: { [userId]: 50 }, pot: 0 };
  const present = buildHandler({ state: presentState, withSeatRow: true, seatStack: 50 });
  const presentResponse = await present.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });

  assert.equal(presentResponse.statusCode, 200);
  const presentBody = JSON.parse(presentResponse.body || "{}");
  assert.equal(presentBody.ok, true);
  assert.equal(presentBody.status, "already_left");
  assert.equal(present.counters().postTransactionCalls, 0);
  assert.equal(present.counters().stateUpdateCount, 0);
  assert.equal(present.counters().seatDeleteCount, 1);
};

run()
  .then(() => console.log("poker-leave invalid_player noop only when state absent test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
