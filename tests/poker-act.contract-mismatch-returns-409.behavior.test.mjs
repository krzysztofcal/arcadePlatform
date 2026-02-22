import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const run = async () => {
  const logs = [];
  let stateUpdates = 0;
  const stateRow = {
    version: 5,
    state: {
      tableId,
      phase: "FLOP",
      seats: [{ userId, seatNo: 1 }, { userId: otherId, seatNo: 2 }],
      stacks: { [userId]: 100, [otherId]: 100 },
      pot: 10,
      community: [{ r: "2", s: "C" }, { r: "3", s: "D" }, { r: "4", s: "H" }],
      dealerSeatNo: 1,
      turnUserId: userId,
      handId: "h-1",
      handSeed: "s-1",
      communityDealt: 3,
      toCallByUserId: { [userId]: 0, [otherId]: 0 },
      betThisRoundByUserId: { [userId]: 0, [otherId]: 0 },
      actedThisRoundByUserId: { [userId]: false, [otherId]: false },
      foldedByUserId: { [userId]: true, [otherId]: false },
      leftTableByUserId: {},
      sitOutByUserId: {},
      lastActionRequestIdByUserId: { [userId]: "contract-mismatch-1" },
    },
  };

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
    TURN_MS,
    advanceIfNeeded,
    applyAction,
    computeLegalActions: ({ userId: actionUserId }) => ({ actions: actionUserId === userId ? [] : [{ type: "CHECK" }], minRaiseTo: null, maxRaiseTo: null }),
    buildActionConstraints,
    isStateStorageValid,
    normalizeJsonState,
    withoutPrivateState,
    resetTurnTimer,
    updatePokerStateOptimistic,
    deriveCommunityCards: () => stateRow.state.community,
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    loadHoleCardsByUserId: async () => ({
      holeCardsByUserId: { [userId]: [{ r: "A", s: "S" }, { r: "K", s: "S" }], [otherId]: [{ r: "Q", s: "S" }, { r: "J", s: "S" }] },
      holeCardsStatusByUserId: {},
    }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: userId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [{ user_id: userId, seat_no: 1, is_bot: false }, { user_id: otherId, seat_no: 2, is_bot: true }];
          }
          if (text.includes("from public.poker_state")) return [{ version: stateRow.version, state: stateRow.state }];
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateUpdates += 1;
            return [{ version: stateRow.version + 1 }];
          }
          return [];
        },
      }),
    klog: (event, payload) => logs.push({ event, payload }),
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "contract-mismatch-1", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body || "{}"), { error: "contract_mismatch_empty_legal_actions" });
  assert.equal(stateUpdates, 0);
  assert.equal(logs.some((entry) => entry.event === "poker_contract_empty_legal_actions"), true);
};

run().then(() => console.log("poker-act contract mismatch 409 behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
