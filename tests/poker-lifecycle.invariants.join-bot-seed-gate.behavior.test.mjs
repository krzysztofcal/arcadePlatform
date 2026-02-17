import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondHumanId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const makeJoinHandler = ({ initialSeats = [], existingRequestStore = new Map(), validUuid = () => true } = {}) => {
  const seats = [...initialSeats];
  const botInserts = [];
  const requestStore = existingRequestStore;
  const stateHolder = { state: { tableId, seats: [], stacks: {}, pot: 0, phase: "INIT" }, version: 1 };

  const handler = loadPokerHandler("netlify/functions/poker-join.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: validUuid,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    loadPokerStateForUpdate,
    updatePokerStateLocked,
    patchLeftTableByUserId,
    patchSitOutByUserId,
    isStateStorageValid,
    parseStakes: () => ({ ok: true, value: { sb: 1, bb: 2 } }),
    getBotConfig: () => ({ enabled: true, maxPerTable: 2, defaultProfile: "TRIVIAL", buyInBB: 100, bankrollSystemKey: "TREASURY" }),
    makeBotUserId: (_tableId, seatNo) => `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb${String(seatNo).padStart(4, "0")}`,
    makeBotSystemKey: (_tableId, seatNo) => `POKER_BOT:${tableId}:${seatNo}`,
    computeTargetBotCount: ({ maxPlayers, humanCount, maxBots }) => {
      if (humanCount <= 0) return 0;
      const capacity = Math.max(0, (maxPlayers - humanCount) - 1);
      return Math.max(0, Math.min(maxBots, capacity));
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          const sqlNormalized = String(query).replace(/\s+/g, " ").trim().toLowerCase();
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key);
            return entry ? [{ result_json: entry.resultJson, created_at: entry.createdAt }] : [];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requestStore.has(key)) return [];
            requestStore.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            requestStore.set(key, { resultJson: params?.[4] ?? null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", max_players: 6, stakes: "1/2" }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) {
            const seat = seats.find((s) => s.user_id === userId);
            return seat ? [{ seat_no: seat.seat_no }] : [];
          }
          if (sqlNormalized.includes("insert into public.poker_seats") && sqlNormalized.includes("is_bot")) {
            const [, botUserId, botSeatNo, botProfile, botStack] = params;
            if (seats.some((seat) => seat.seat_no === botSeatNo || seat.user_id === botUserId)) return [];
            botInserts.push({ botUserId, botSeatNo });
            seats.push({ table_id: tableId, user_id: botUserId, seat_no: botSeatNo, status: "ACTIVE", is_bot: true, bot_profile: botProfile, stack: botStack });
            return [{ seat_no: botSeatNo }];
          }
          if (sqlNormalized.includes("insert into public.poker_seats")) {
            seats.push({ table_id: tableId, user_id: userId, seat_no: params?.[2], status: "ACTIVE", is_bot: false, stack: params?.[3] });
            return [];
          }
          if (sqlNormalized.includes("select count(*)::int as count from public.poker_seats") && sqlNormalized.includes("coalesce(is_bot, false) = false")) {
            return [{ count: seats.filter((seat) => seat.status === "ACTIVE" && !seat.is_bot).length }];
          }
          if (sqlNormalized.includes("select count(*)::int as count from public.poker_seats") && sqlNormalized.includes("coalesce(is_bot, false) = true")) {
            return [{ count: seats.filter((seat) => seat.status === "ACTIVE" && !!seat.is_bot).length }];
          }
          if (sqlNormalized.includes("select seat_no from public.poker_seats where table_id = $1 order by seat_no asc")) {
            return seats.map((seat) => ({ seat_no: seat.seat_no })).sort((a, b) => a.seat_no - b.seat_no);
          }
          if (text.includes("from public.chips_accounts")) return [{ id: "escrow-1" }];
          if (text.includes("from public.poker_state") && text.includes("for update")) {
            return [{ version: stateHolder.version, state: JSON.stringify(stateHolder.state) }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateHolder.state = JSON.parse(params?.[1]);
            stateHolder.version += 1;
            return [{ version: stateHolder.version }];
          }
          if (text.includes("update public.poker_tables")) return [];
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    klog: () => {},
    HEARTBEAT_INTERVAL_SEC: 15,
  });

  return { handler, botInserts, seats };
};

const callJoin = (handler, requestId, bodyOverride = {}) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 0, buyIn: 100, requestId, ...bodyOverride }),
  });

const run = async () => {
  {
    const ctx = makeJoinHandler({ validUuid: (value) => value === tableId || value === userId });
    const first = await callJoin(ctx.handler, "seed-once");
    assert.equal(first.statusCode, 200);
    assert.equal(ctx.botInserts.length, 2);

    const replay = await callJoin(ctx.handler, "seed-once");
    assert.equal(replay.statusCode, 200);
    assert.equal(ctx.botInserts.length, 2, "replay must not create extra bot seats");
  }

  {
    const ctx = makeJoinHandler({
      initialSeats: [{ table_id: tableId, user_id: secondHumanId, seat_no: 4, status: "ACTIVE", is_bot: false, stack: 100 }],
    });
    const res = await callJoin(ctx.handler, "human-two");
    assert.equal(res.statusCode, 200);
    assert.equal(ctx.botInserts.length, 0, "humanCount=2 must not seed bots");
  }

  {
    const ctx = makeJoinHandler({ validUuid: (value) => value === tableId || value === userId });
    const res = await callJoin(ctx.handler, "invalid-join", { tableId: "bad-id" });
    assert.equal(res.statusCode, 400);
    assert.equal(ctx.botInserts.length, 0, "4xx join paths must not seed bots");
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
