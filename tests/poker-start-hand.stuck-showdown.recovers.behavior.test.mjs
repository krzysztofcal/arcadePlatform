import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { advanceIfNeeded, applyAction, TURN_MS } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { getRng, isPlainObject, isStateStorageValid, normalizeJsonState, upgradeLegacyInitStateWithSeats, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { clearMissedTurns } from "../netlify/functions/_shared/poker-missed-turns.mjs";
import { normalizeSeatOrderFromState } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "0";

const makeState = () => ({
  tableId,
  phase: "SHOWDOWN",
  showdown: null,
  handId: "hand-stuck-1",
  handSeed: "seed-stuck-1",
  dealerSeatNo: 1,
  communityDealt: 5,
  community: ["As", "Kd", "7c", "3h", "2s"],
  pot: 20,
  stacks: { [userA]: 90, [userB]: 90 },
  bets: { [userA]: 10, [userB]: 10 },
  toCallByUserId: { [userA]: 0, [userB]: 0 },
  betThisRoundByUserId: { [userA]: 0, [userB]: 0 },
  actedThisRoundByUserId: { [userA]: true, [userB]: true },
  foldedByUserId: { [userA]: false, [userB]: false },
  leftTableByUserId: {},
  sitOutByUserId: {},
  handSeats: [
    { userId: userA, seatNo: 1 },
    { userId: userB, seatNo: 2 },
  ],
  seats: [
    { userId: userA, seatNo: 1 },
    { userId: userB, seatNo: 2 },
  ],
  turnUserId: null,
});

const run = async () => {
  const stateHolder = { version: 7, state: makeState() };
  const writtenStates = [];
  const logs = [];

  const handler = loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: userA }),
    isValidUuid: () => true,
    isPlainObject,
    normalizeJsonState,
    normalizeRequestId,
    upgradeLegacyInitStateWithSeats,
    computeLegalActions,
    buildActionConstraints,
    getRng,
    isStateStorageValid,
    withoutPrivateState,
    TURN_MS,
    applyAction,
    advanceIfNeeded,
    updatePokerStateOptimistic,
    resetTurnTimer,
    clearMissedTurns,
    normalizeSeatOrderFromState,
    klog: (event, payload) => logs.push({ event, payload }),
    parseStakes: () => ({ sb: 1, bb: 2 }),
    loadHoleCardsByUserId: async () => ({
      holeCardsByUserId: { [userA]: ["Ah", "Kh"], [userB]: ["Qd", "Qs"] },
    }),
    isHoleCardsTableMissing: () => false,
    ensurePokerRequest: async () => ({ status: "claimed" }),
    storePokerRequestResult: async () => {},
    deletePokerRequest: async () => {},
    startHandCore: async ({ currentState, expectedVersion }) => {
      assert.equal(currentState.phase, "INIT", "expected recovery to reset state before start-hand");
      return {
        newVersion: expectedVersion,
        updatedState: {
          ...currentState,
          phase: "PREFLOP",
          handId: "hand-new-2",
          handSeed: "seed-new-2",
          turnUserId: userA,
          community: [],
          communityDealt: 0,
          showdown: null,
          lastStartHandRequestId: "req-1",
          lastStartHandUserId: userA,
        },
        dealtHoleCards: { [userA]: ["Ah", "Kh"] },
        privateState: {
          ...currentState,
          phase: "PREFLOP",
          handId: "hand-new-2",
          handSeed: "seed-new-2",
          turnUserId: userA,
          community: [],
          communityDealt: 0,
          showdown: null,
          holeCardsByUserId: { [userA]: ["Ah", "Kh"], [userB]: ["Qd", "Qs"] },
          deck: [],
          lastStartHandRequestId: "req-1",
          lastStartHandUserId: userA,
        },
      };
    },
    beginSql: async (fn) => fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
        if (text.includes("from public.poker_state") && text.includes("version, state")) {
          return [{ version: stateHolder.version, state: stateHolder.state }];
        }
        if (text.includes("from public.poker_seats")) {
          return [
            { user_id: userA, seat_no: 1, stack: 100, is_bot: false },
            { user_id: userB, seat_no: 2, stack: 100, is_bot: true },
          ];
        }
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          const nextState = JSON.parse(params?.[2] || "{}");
          writtenStates.push(nextState);
          stateHolder.state = nextState;
          stateHolder.version += 1;
          return [{ version: stateHolder.version }];
        }
        if (text.includes("insert into public.poker_actions")) return [];
        if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now()")) return [];
        return [];
      },
    }),
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-1" }),
  });

  const payload = JSON.parse(response.body || "{}");
  if (response.statusCode === 409) {
    assert.equal(payload.error, "state_conflict", "recovery conflict must be retryable state_conflict");
    return;
  }

  if (response.statusCode !== 200) {
    const errorLog = logs.find((entry) => entry.event === "poker_start_hand_error");
    throw new Error(`unexpected status=${response.statusCode} body=${response.body || ""} log=${JSON.stringify(errorLog || null)}`);
  }
  assert.equal(payload.ok, true);
  assert.equal(payload.state?.state?.phase, "PREFLOP");
  assert.equal(payload.state?.state?.handId, "hand-new-2");
  assert.ok(
    writtenStates.every((state) => !(state?.phase === "SHOWDOWN" && state?.showdown == null)),
    "recovery writes must not persist stuck showdown state"
  );
  const initWrite = writtenStates.find((state) => state?.phase === "INIT");
  if (initWrite) {
    for (const userId of [userA, userB]) {
      assert.ok(Object.prototype.hasOwnProperty.call(initWrite.toCallByUserId || {}, userId));
      assert.ok(Object.prototype.hasOwnProperty.call(initWrite.betThisRoundByUserId || {}, userId));
      assert.ok(Object.prototype.hasOwnProperty.call(initWrite.actedThisRoundByUserId || {}, userId));
      assert.ok(Object.prototype.hasOwnProperty.call(initWrite.foldedByUserId || {}, userId));
    }
  }
};

run().then(() => console.log("poker-start-hand stuck-showdown recovery behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
