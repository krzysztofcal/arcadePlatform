import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { advanceIfNeeded, applyAction, TURN_MS } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import {
  getRng,
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  upgradeLegacyInitStateWithSeats,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { clearMissedTurns } from "../netlify/functions/_shared/poker-missed-turns.mjs";
import { normalizeSeatOrderFromState } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const botC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "0";

const makeState = () => ({
  tableId,
  phase: "SHOWDOWN",
  showdown: { winners: [botB], source: "settled" },
  handId: "hand-prod-repro-1",
  handSeed: "seed-prod-repro-1",
  dealerSeatNo: 2,
  communityDealt: 5,
  community: ["As", "Kd", "7c", "3h", "2s"],
  pot: 0,
  stacks: { [userA]: 95, [botB]: 110, [botC]: 95 },
  bets: { [userA]: 0, [botB]: 0, [botC]: 0 },
  toCallByUserId: { [userA]: 0, [botB]: 0, [botC]: 0 },
  betThisRoundByUserId: { [userA]: 0, [botB]: 0, [botC]: 0 },
  actedThisRoundByUserId: { [userA]: true, [botB]: true, [botC]: true },
  foldedByUserId: { [userA]: true, [botB]: false, [botC]: false },
  leftTableByUserId: { [userA]: false, [botB]: false, [botC]: false },
  sitOutByUserId: { [userA]: false, [botB]: false, [botC]: false },
  handSeats: [
    { userId: userA, seatNo: 1 },
    { userId: botB, seatNo: 2 },
    { userId: botC, seatNo: 3 },
  ],
  seats: [
    { userId: userA, seatNo: 1 },
    { userId: botB, seatNo: 2 },
    { userId: botC, seatNo: 3 },
  ],
  turnUserId: null,
});

const run = async () => {
  const stateHolder = { version: 15, state: makeState() };
  const recoveryWrites = [];
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
    parseStakes: () => ({ ok: true, value: { sb: 1, bb: 2 } }),
    loadHoleCardsByUserId: async () => ({
      holeCardsByUserId: { [botB]: ["Ah", "Kh"], [botC]: ["Qd", "Qs"] },
    }),
    isHoleCardsTableMissing: () => false,
    ensurePokerRequest: async () => ({ status: "claimed" }),
    storePokerRequestResult: async () => {},
    deletePokerRequest: async () => {},
    klog: (event, payload) => logs.push({ event, payload }),
    startHandCore: async ({ currentState, expectedVersion }) => {
      assert.equal(currentState.phase, "INIT", "repro recovery should normalize into a startable INIT state");
      assert.equal(currentState.leftTableByUserId?.[userA], false, "recovery must not resurrect left-table status for active seat");
      assert.equal(currentState.sitOutByUserId?.[userA], false, "recovery must not resurrect sit-out status for active seat");
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
          showdown: { winners: [botB], source: "settled" },
          lastStartHandRequestId: "req-repro-1",
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
          showdown: { winners: [botB], source: "settled" },
          holeCardsByUserId: { [userA]: ["Ah", "Kh"], [botB]: ["Qd", "Qs"], [botC]: ["Js", "Jd"] },
          deck: [],
          lastStartHandRequestId: "req-repro-1",
          lastStartHandUserId: userA,
        },
      };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_state") && text.includes("version, state")) {
            return [{ version: stateHolder.version, state: stateHolder.state }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: userA, seat_no: 1, stack: 95, is_bot: false },
              { user_id: botB, seat_no: 2, stack: 110, is_bot: true },
              { user_id: botC, seat_no: 3, stack: 95, is_bot: true },
            ];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            const nextState = JSON.parse(params?.[2] || "{}");
            recoveryWrites.push(nextState);
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
    body: JSON.stringify({ tableId, requestId: "req-repro-1" }),
  });

  const payload = JSON.parse(response.body || "{}");
  assert.notEqual(payload.error, "state_invalid", "prod repro path must never return state_invalid");
  if (response.statusCode !== 200) {
    throw new Error(`unexpected status=${response.statusCode} body=${response.body || ""} logs=${JSON.stringify(logs)}`);
  }
  assert.equal(payload.ok, true);
  assert.equal(payload.state?.state?.phase, "PREFLOP");
  assert.ok(
    recoveryWrites.every((next) => !(next?.phase === "SHOWDOWN" && next?.showdown == null)),
    "recovery write must not persist stuck showdown"
  );
};

run()
  .then(() => console.log("poker-start-hand leave-then-bots-finish can restart behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
