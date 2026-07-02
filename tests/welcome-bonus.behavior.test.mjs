import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIdempotencyKey,
  claimWelcomeBonus,
  getWelcomeBonusStatus,
} from "../netlify/functions/_shared/welcome-bonus.mjs";
import { createWelcomeBonusHandler } from "../netlify/functions/welcome-bonus.mjs";

const START_AT = "2025-06-01T00:00:00Z";
const BEFORE_USER = "00000000-0000-4000-8000-000000000001";
const AT_USER = "00000000-0000-4000-8000-000000000002";
const AFTER_USER = "00000000-0000-4000-8000-000000000003";

function createDeps() {
  const users = new Map([
    [BEFORE_USER, "2025-05-31T23:59:59.000Z"],
    [AT_USER, START_AT],
    [AFTER_USER, "2025-06-02T12:00:00.000Z"],
  ]);
  const txByKey = new Map();
  const posts = [];
  const deps = {
    env: {
      WELCOME_BONUS_START_AT: START_AT,
      WELCOME_BONUS_CHIPS: "500",
    },
    async executeSql(query, params) {
      const text = String(query).toLowerCase().replace(/\s+/g, " ");
      if (text.includes("from auth.users")) {
        const createdAt = users.get(params[0]);
        return createdAt ? [{ created_at: createdAt }] : [];
      }
      if (text.includes("from public.chips_transactions")) {
        const row = txByKey.get(params[1]);
        return row && row.user_id === params[0] ? [row] : [];
      }
      throw new Error(`unexpected query: ${text}`);
    },
    async postTransaction(payload) {
      posts.push(payload);
      const existing = txByKey.get(payload.idempotencyKey);
      if (existing) {
        return { transaction: existing, entries: [], account: { balance: 500 } };
      }
      const transaction = {
        id: `tx-${posts.length}`,
        user_id: payload.userId,
        tx_type: payload.txType,
        idempotency_key: payload.idempotencyKey,
      };
      txByKey.set(payload.idempotencyKey, transaction);
      return { transaction, entries: payload.entries, account: { balance: 500 } };
    },
    posts,
    txByKey,
  };
  return deps;
}

test("account created before WELCOME_BONUS_START_AT is not eligible", async () => {
  const deps = createDeps();
  const status = await getWelcomeBonusStatus(BEFORE_USER, deps);

  assert.equal(status.eligible, false);
  assert.equal(status.alreadyClaimed, false);
  assert.equal(status.reason, "created_before_start");
});

test("account created at or after WELCOME_BONUS_START_AT is eligible if not claimed", async () => {
  const deps = createDeps();
  const atStatus = await getWelcomeBonusStatus(AT_USER, deps);
  const afterStatus = await getWelcomeBonusStatus(AFTER_USER, deps);

  assert.equal(atStatus.eligible, true);
  assert.equal(afterStatus.eligible, true);
  assert.equal(atStatus.amount, 500);
  assert.equal(atStatus.idempotencyKey, buildIdempotencyKey(AT_USER));
});

test("repeated POST does not grant a second welcome bonus", async () => {
  const deps = createDeps();

  const first = await claimWelcomeBonus(AFTER_USER, deps);
  const second = await claimWelcomeBonus(AFTER_USER, deps);

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.alreadyClaimed, true);
  assert.equal(deps.posts.length, 1);
  assert.equal(deps.posts[0].txType, "WELCOME_BONUS");
  assert.equal(deps.posts[0].idempotencyKey, `welcome-bonus:${AFTER_USER}`);
});

test("welcome bonus uses treasury ledger offset and never transfers guest chips", async () => {
  const deps = createDeps();
  const result = await claimWelcomeBonus(AFTER_USER, deps);
  const payload = deps.posts[0];

  assert.equal(result.claimed, true);
  assert.equal(payload.entries.length, 2);
  assert.deepEqual(
    payload.entries.map(entry => ({ accountType: entry.accountType, userId: entry.userId || null, systemKey: entry.systemKey || null, amount: entry.amount })),
    [
      { accountType: "USER", userId: AFTER_USER, systemKey: null, amount: 500 },
      { accountType: "SYSTEM", userId: null, systemKey: "TREASURY", amount: -500 },
    ],
  );
  assert.equal(JSON.stringify(payload).includes("guestChips"), false);
});

test("welcome bonus API exposes status and claim results for authenticated users", async () => {
  const calls = [];
  const handler = createWelcomeBonusHandler({
    env: { CHIPS_ENABLED: "1", WELCOME_BONUS_START_AT: START_AT, WELCOME_BONUS_CHIPS: "500" },
    verifySupabaseJwt: async (token) => ({ valid: !!token, userId: token || null, reason: token ? "ok" : "missing_token" }),
    getWelcomeBonusStatus: async (userId) => {
      calls.push(["GET", userId]);
      return { eligible: true, alreadyClaimed: false, amount: 500, reason: "eligible" };
    },
    claimWelcomeBonus: async (userId) => {
      calls.push(["POST", userId]);
      return {
        claimed: true,
        eligible: false,
        alreadyClaimed: true,
        amount: 500,
        reason: "claimed",
        transactionId: "tx-api",
      };
    },
  });

  const getRes = await handler({ httpMethod: "GET", headers: { authorization: `Bearer ${AFTER_USER}` } });
  const postRes = await handler({ httpMethod: "POST", headers: { authorization: `Bearer ${AFTER_USER}` } });

  assert.equal(getRes.statusCode, 200);
  assert.equal(JSON.parse(getRes.body).eligible, true);
  assert.equal(postRes.statusCode, 200);
  assert.equal(JSON.parse(postRes.body).claimed, true);
  assert.deepEqual(calls, [["GET", AFTER_USER], ["POST", AFTER_USER]]);
});
