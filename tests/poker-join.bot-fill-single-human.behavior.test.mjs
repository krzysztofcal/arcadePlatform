import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const maxPlayers = 6;
const botBuyInBb = 100;
const bigBlind = 2;
const minBotStack = botBuyInBb * bigBlind;

const findBotInsertPayload = (params, seats) => {
  const list = Array.isArray(params) ? params : [];
  const botUserId = list.find((value) => typeof value === "string" && value.startsWith("bot-"));
  const seatNo = list.find(
    (value) =>
      Number.isInteger(value) &&
      value >= 1 &&
      value <= maxPlayers &&
      !seats.some((seat) => seat.seat_no === value || seat.user_id === botUserId)
  );
  const stack = list.find((value) => Number.isInteger(value) && value >= minBotStack && value !== seatNo);
  if (!botUserId || !Number.isInteger(seatNo) || !Number.isInteger(stack) || stack < minBotStack) return null;
  return { botUserId, seatNo, stack };
};

const makeCtx = () => {
  const seats = [];
  const requestStore = new Map();
  const botInsertCalls = [];

  const handler = loadPokerHandler("netlify/functions/poker-join.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    loadPokerStateForUpdate,
    updatePokerStateLocked,
    patchLeftTableByUserId,
    patchSitOutByUserId,
    isStateStorageValid,
    parseStakes: () => ({ ok: true, value: { sb: 1, bb: bigBlind } }),
    getBotConfig: () => ({ enabled: true, maxPerTable: 2, defaultProfile: "TRIVIAL", buyInBB: 100, bankrollSystemKey: "TREASURY" }),
    makeBotUserId: (_tableId, seatNo) => `bot-${seatNo}`,
    makeBotSystemKey: (_tableId, seatNo) => `POKER_BOT:${_tableId}:${seatNo}`,
    computeTargetBotCount: ({ maxPlayers: totalSeats, humanCount, maxBots }) => {
      if (humanCount <= 0) return 0;
      const capacity = Math.max(0, (totalSeats - humanCount) - 1);
      return Math.max(0, Math.min(maxBots, capacity));
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          const normalized = String(query).replace(/\s+/g, " ").trim().toLowerCase();
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key);
            if (!entry) return [];
            return [{ result_json: entry.resultJson, created_at: entry.createdAt }];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requestStore.has(key)) return [];
            requestStore.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key) || { createdAt: new Date().toISOString() };
            entry.resultJson = params?.[4] ?? null;
            requestStore.set(key, entry);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", max_players: maxPlayers, stakes: "1/2" }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) return [];
          if (normalized.includes("insert into public.poker_seats") && normalized.includes("is_bot")) {
            const payload = findBotInsertPayload(params, seats);
            if (!payload) return [];
            const { botUserId, seatNo, stack } = payload;
            if (seats.some((seat) => seat.user_id === botUserId || seat.seat_no === seatNo)) return [];
            seats.push({ table_id: tableId, user_id: botUserId, seat_no: seatNo, status: "ACTIVE", is_bot: true, stack });
            botInsertCalls.push({ botUserId, seatNo, stack });
            return [{ seat_no: seatNo }];
          }
          if (normalized.includes("insert into public.poker_seats")) {
            seats.push({ table_id: tableId, user_id: userId, seat_no: params?.[2], status: "ACTIVE", is_bot: false, stack: params?.[3] });
            return [];
          }
          if (normalized.includes("coalesce(is_bot, false) = false")) {
            return [{ count: seats.filter((seat) => seat.status === "ACTIVE" && !seat.is_bot).length }];
          }
          if (normalized.includes("coalesce(is_bot, false) = true")) {
            return [{ count: seats.filter((seat) => seat.status === "ACTIVE" && seat.is_bot).length }];
          }
          if (normalized.includes("select seat_no from public.poker_seats where table_id = $1 order by seat_no asc")) {
            return seats.map((seat) => ({ seat_no: seat.seat_no })).sort((a, b) => a.seat_no - b.seat_no);
          }
          if (text.includes("from public.chips_accounts")) return [{ id: "escrow-1" }];
          if (text.includes("from public.poker_state") && text.includes("for update")) {
            return [{ version: 1, state: JSON.stringify({ tableId, seats: [], stacks: {}, phase: "INIT", pot: 0 }) }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) return [{ version: 2 }];
          if (text.includes("update public.poker_tables set last_activity_at = now()")) return [];
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    klog: () => {},
    HEARTBEAT_INTERVAL_SEC: 15,
  });

  return { handler, seats, botInsertCalls };
};

const run = async () => {
  const ctx = makeCtx();
  const first = await ctx.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 0, buyIn: 100, requestId: "join-1" }),
  });
  assert.equal(first.statusCode, 200);
  assert.equal(ctx.seats.filter((seat) => !seat.is_bot && seat.status === "ACTIVE").length, 1);
  assert.equal(ctx.seats.filter((seat) => seat.is_bot && seat.status === "ACTIVE").length, 2);
  assert.equal(ctx.botInsertCalls.length, 2);

  for (const call of ctx.botInsertCalls) {
    assert.equal(call.seatNo >= 1 && call.seatNo <= maxPlayers, true);
    assert.equal(call.stack >= minBotStack, true);
    assert.equal(call.stack === call.seatNo, false);
  }

  const second = await ctx.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 0, buyIn: 100, requestId: "join-1" }),
  });
  assert.equal(second.statusCode, 200);
  assert.equal(ctx.botInsertCalls.length, 2);
  assert.equal(ctx.seats.filter((seat) => seat.is_bot).length, 2);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
