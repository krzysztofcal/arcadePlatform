import assert from "node:assert/strict";
import test from "node:test";

const {
  createAdminPokerAuditHandler,
  loadPokerAudit,
  parseMeta
} = await import("../netlify/functions/admin-poker-audit.mjs");

function createEvent(queryStringParameters = {}) {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters,
  };
}

const rows = [
  {
    id: 1,
    table_id: "00000000-0000-4000-8000-000000000111",
    version: 7,
    user_id: "00000000-0000-4000-8000-0000000000a1",
    action_type: "CALL",
    amount: 4,
    hand_id: "hand-audit-1",
    request_id: "req-call",
    phase_from: "PREFLOP",
    phase_to: "FLOP",
    created_at: "2026-07-01T10:00:00.000Z",
    meta: {
      source: "human",
      potTotalBefore: 8,
      potTotalAfter: 12,
      actorStackBefore: 98,
      actorStackAfter: 94,
      holeCardsByUserId: { "00000000-0000-4000-8000-0000000000a1": ["AS", "AD"] },
      deck: ["2C"]
    }
  },
  {
    id: 2,
    table_id: "00000000-0000-4000-8000-000000000111",
    version: 8,
    user_id: null,
    action_type: "HAND_SETTLED",
    amount: null,
    hand_id: "hand-audit-1",
    request_id: "audit:settlement",
    phase_from: null,
    phase_to: "SETTLED",
    created_at: "2026-07-01T10:01:00.000Z",
    meta: JSON.stringify({
      reason: "computed",
      settledAt: "2026-07-01T10:01:00.000Z",
      communityCards: ["6C", "4S", "4C", "9D", "TD"],
      winners: ["00000000-0000-4000-8000-0000000000a1"],
      payoutByUserId: { "00000000-0000-4000-8000-0000000000a1": 44 },
      potsAwarded: [{ amount: 44, eligibleUserIds: ["00000000-0000-4000-8000-0000000000a1"], winners: ["00000000-0000-4000-8000-0000000000a1"] }],
      evaluatedHands: [{ userId: "00000000-0000-4000-8000-0000000000a1", name: "Pair", category: 1, ranks: [10, 9], bestFiveCards: ["TD", "TC", "9D", "6C", "4S"] }],
      deck: ["3H"]
    })
  },
  {
    id: 3,
    table_id: "00000000-0000-4000-8000-000000000222",
    version: 3,
    user_id: "00000000-0000-4000-8000-0000000000b1",
    action_type: "CHECK",
    amount: null,
    hand_id: "hand-audit-2",
    request_id: "req-check",
    phase_from: "FLOP",
    phase_to: "TURN",
    created_at: "2026-07-01T09:00:00.000Z",
    meta: { source: "bot_autoplay", potTotalAfter: 10 }
  }
];

test("admin-poker-audit rejects unauthorized callers", async () => {
  const handler = createAdminPokerAuditHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => {
      const error = new Error("forbidden");
      error.status = 403;
      error.code = "forbidden";
      throw error;
    },
    loadPokerAudit: async () => ({ ok: true, hands: [] }),
  });
  const response = await handler(createEvent({ handId: "hand-audit-1", revealPrivateCards: "1" }));
  assert.equal(response.statusCode, 403);
});

test("search by tableId returns grouped hands", async () => {
  const payload = await loadPokerAudit({
    tableId: "000000000111",
    executeSqlFn: async (_query, params) => {
      assert.equal(params[0], "%000000000111%");
      assert.equal(params[1], 20);
      return rows.filter((row) => row.table_id.endsWith("000000000111"));
    }
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.hands.length, 1);
  assert.equal(payload.hands[0].handId, "hand-audit-1");
  assert.equal(payload.hands[0].actionCount, 1);
  assert.equal(payload.hands[0].hasSettlement, true);
  assert.deepEqual(payload.hands[0].winnerUserIds, ["00000000-0000-4000-8000-0000000000a1"]);
});

test("search by handId returns selected hand and parses action plus settlement meta", async () => {
  const payload = await loadPokerAudit({
    handId: "hand-audit-1",
    executeSqlFn: async (_query, params) => {
      assert.equal(params[0], "hand-audit-1");
      assert.equal(params[1], 20);
      return rows.filter((row) => row.hand_id === "hand-audit-1");
    }
  });

  assert.equal(payload.selectedHand.handId, "hand-audit-1");
  assert.equal(payload.selectedHand.actions.length, 1);
  assert.equal(payload.selectedHand.timeline.length, 2);
  assert.equal(payload.selectedHand.timeline[1].actionType, "HAND_SETTLED");
  assert.equal(payload.selectedHand.timeline[1].source, "system");
  assert.equal(payload.selectedHand.actions[0].actionType, "CALL");
  assert.equal(payload.selectedHand.actions[0].source, "human");
  assert.equal(payload.selectedHand.actions[0].potTotalBefore, 8);
  assert.equal(payload.selectedHand.settlement.reason, "computed");
  assert.deepEqual(payload.selectedHand.settlement.communityCards, ["6C", "4S", "4C", "9D", "TD"]);
  assert.equal(payload.selectedHand.settlement.payoutByUserId["00000000-0000-4000-8000-0000000000a1"], 44);
  assert.equal(payload.selectedHand.settlement.evaluatedHands[0].name, "Pair");
  assert.equal(Object.prototype.hasOwnProperty.call(payload.selectedHand, "privateCardsByUserId"), false);
});

test("revealPrivateCards includes selected hand private cards only when requested", async () => {
  let calls = 0;
  const payload = await loadPokerAudit({
    handId: "hand-audit-1",
    revealPrivateCards: true,
    executeSqlFn: async (query) => {
      calls += 1;
      if (String(query).includes("public.poker_hole_cards")) {
        return [
          { user_id: "00000000-0000-4000-8000-0000000000a1", cards: JSON.stringify(["AS", "KD"]) },
          { user_id: "unrelated-user", cards: JSON.stringify(["2C", "3D"]) }
        ];
      }
      return rows.filter((row) => row.hand_id === "hand-audit-1");
    }
  });

  assert.equal(calls, 2);
  assert.deepEqual(payload.selectedHand.privateCardsByUserId, {
    "00000000-0000-4000-8000-0000000000a1": ["AS", "KD"]
  });
  assert.equal(payload.selectedHand.privateCardsAvailable, true);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("2C"), false);
  assert.equal(serialized.includes('"deck"'), false);
});

test("older hands without stored private cards reveal empty mapping gracefully", async () => {
  const payload = await loadPokerAudit({
    handId: "hand-audit-1",
    revealPrivateCards: true,
    executeSqlFn: async (query) => {
      if (String(query).includes("public.poker_hole_cards")) return [];
      return rows.filter((row) => row.hand_id === "hand-audit-1");
    }
  });

  assert.deepEqual(payload.selectedHand.privateCardsByUserId, {});
  assert.equal(payload.selectedHand.privateCardsAvailable, false);
});

test("response does not expose raw hole cards or deck keys", async () => {
  const payload = await loadPokerAudit({
    handId: "hand-audit-1",
    executeSqlFn: async () => rows.filter((row) => row.hand_id === "hand-audit-1")
  });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("holeCardsByUserId"), false);
  assert.equal(serialized.includes('"deck"'), false);
  assert.equal(serialized.includes("AS"), false);
  assert.equal(serialized.includes("AD"), false);
  assert.equal(serialized.includes("3H"), false);
});

test("parseMeta defensively handles json strings and strips hidden state keys", () => {
  assert.deepEqual(parseMeta(JSON.stringify({ source: "timeout", deck: ["AS"], nested: { holeCardsByUserId: { u1: ["KD"] }, ok: true } })), {
    source: "timeout",
    nested: { ok: true }
  });
});
