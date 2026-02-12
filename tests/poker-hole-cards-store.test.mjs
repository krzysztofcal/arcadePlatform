import assert from "node:assert/strict";
import test from "node:test";
import { loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const handId = "hand-1";

test("default legacy mode uses active users as required and throws on invalid/missing", async () => {
  const txInvalid = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, cards")) {
        return [{ user_id: "user-1", cards: [{ r: "A", s: "S" }] }];
      }
      throw new Error("unexpected_query");
    },
  };

  await assert.rejects(
    loadHoleCardsByUserId(txInvalid, {
      tableId,
      handId,
      activeUserIds: ["user-1"],
    }),
    /state_invalid/
  );

  const txValid = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, cards")) {
        return [{ user_id: "user-1", cards: [{ r: "A", s: "S" }, { r: "K", s: "S" }] }];
      }
      throw new Error("unexpected_query");
    },
  };

  const out = await loadHoleCardsByUserId(txValid, {
    tableId,
    handId,
    activeUserIds: ["user-1"],
  });
  assert.deepEqual(out.holeCardsByUserId["user-1"], [{ r: "A", s: "S" }, { r: "K", s: "S" }]);
});

test("soft mode never throws and returns statuses", async () => {
  const tx = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, cards")) {
        return [{ user_id: "user-1", cards: [{ r: "A", s: "S" }] }];
      }
      throw new Error("unexpected_query");
    },
  };

  const out = await loadHoleCardsByUserId(tx, {
    tableId,
    handId,
    activeUserIds: ["user-1"],
    requiredUserIds: ["user-1"],
    mode: "soft",
  });
  assert.equal(out.holeCardsStatusByUserId["user-1"], "INVALID");
  assert.equal(Object.prototype.hasOwnProperty.call(out.holeCardsByUserId, "user-1"), false);
});


test("strict mode requires explicit required users", async () => {
  const tx = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, cards")) {
        return [{ user_id: "user-1", cards: [{ r: "A", s: "S" }, { r: "K", s: "S" }] }];
      }
      throw new Error("unexpected_query");
    },
  };

  await assert.rejects(
    loadHoleCardsByUserId(tx, {
      tableId,
      handId,
      activeUserIds: ["user-1"],
      mode: "strict",
    }),
    /state_invalid/
  );
});


test("strict mode only validates required users", async () => {
  const tx = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, cards")) {
        return [
          { user_id: "user-1", cards: [{ r: "A", s: "S" }, { r: "K", s: "S" }] },
          { user_id: "user-2", cards: [] },
        ];
      }
      throw new Error("unexpected_query");
    },
  };

  const out = await loadHoleCardsByUserId(tx, {
    tableId,
    handId,
    activeUserIds: ["user-1", "user-2"],
    requiredUserIds: ["user-1"],
    mode: "strict",
  });

  assert.equal(out.holeCardsStatusByUserId["user-1"], undefined);
  assert.equal(out.holeCardsStatusByUserId["user-2"], "INVALID");
  assert.equal(Object.prototype.hasOwnProperty.call(out.holeCardsByUserId, "user-2"), true);
});

test("selfHealInvalid deletes only required invalid users and scrubs map", async () => {
  const deletes = [];
  const tx = {
    unsafe: async (query, params) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, cards")) {
        return [
          { user_id: "user-1", cards: [{ r: "A", s: "S" }] },
          { user_id: "user-2", cards: [{ r: "Q", s: "H" }, { r: "J", s: "H" }] },
          { user_id: "user-3", cards: [{ r: "9", s: "D" }] },
        ];
      }
      if (text.includes("delete from public.poker_hole_cards")) {
        deletes.push(params?.[2] || []);
        return [];
      }
      throw new Error("unexpected_query");
    },
  };

  const out = await loadHoleCardsByUserId(tx, {
    tableId,
    handId,
    activeUserIds: ["user-1", "user-2", "user-3"],
    requiredUserIds: ["user-1"],
    mode: "soft",
    selfHealInvalid: true,
  });

  assert.deepEqual(deletes, [["user-1"]]);
  assert.equal(out.holeCardsStatusByUserId["user-1"], "INVALID");
  assert.equal(Object.prototype.hasOwnProperty.call(out.holeCardsByUserId, "user-1"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out.holeCardsByUserId, "user-2"), true);
  assert.equal(out.holeCardsStatusByUserId["user-3"], "INVALID");
  assert.equal(Object.prototype.hasOwnProperty.call(out.holeCardsByUserId, "user-3"), true);
});


test("strict mode throws when required set includes invalid user", async () => {
  const tx = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, cards")) {
        return [
          { user_id: "user-1", cards: [{ r: "A", s: "S" }, { r: "K", s: "S" }] },
          { user_id: "user-2", cards: [] },
        ];
      }
      throw new Error("unexpected_query");
    },
  };

  await assert.rejects(
    loadHoleCardsByUserId(tx, {
      tableId,
      handId,
      activeUserIds: ["user-1", "user-2", "user-3"],
      requiredUserIds: ["user-1", "user-2"],
      mode: "strict",
    }),
    /state_invalid/
  );
});
