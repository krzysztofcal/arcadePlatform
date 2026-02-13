import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const makeJoinHandler = ({
  tableMaxPlayers = 6,
  botEnabled = true,
  botMaxPerTable = 2,
  existingRequestStore = new Map(),
  existingSeatNo = null,
  stakesOk = true,
}) => {
  const queries = [];
  const ledgerCalls = [];
  const logs = [];
  const seats = [];
  const requestStore = existingRequestStore;
  const stateHolder = {
    state: {
      tableId,
      seats: [],
      stacks: {},
      pot: 0,
      phase: "INIT",
      leftTableByUserId: { [userId]: true },
      sitOutByUserId: { [userId]: true },
      missedTurnsByUserId: { [userId]: 1 },
    },
    version: 1,
  };

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
    parseStakes: () => (stakesOk ? { ok: true, value: { sb: 1, bb: 2 } } : { ok: false, error: "invalid_stakes" }),
    getBotConfig: () => ({ enabled: botEnabled, maxPerTable: botMaxPerTable, defaultProfile: "TRIVIAL", buyInBB: 100, bankrollSystemKey: "TREASURY" }),
    makeBotUserId: (_tableId, seatNo) => (seatNo === 2 ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : seatNo === 3 ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc" : "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
    makeBotSystemKey: (_tableId, seatNo) => `POKER_BOT:${tableId}:${seatNo}`,
    computeTargetBotCount: ({ maxPlayers, humanCount, maxBots }) => {
      if (humanCount <= 0) return 0;
      const capacity = Math.max(0, (maxPlayers - humanCount) - 1);
      return Math.max(0, Math.min(maxBots, capacity));
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          const sqlNormalized = String(query).replace(/\s+/g, " ").trim().toLowerCase();
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
          if (text.includes("delete from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            requestStore.delete(key);
            return [];
          }
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: tableMaxPlayers, stakes: "1/2" }];
          }
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) {
            if (Number.isInteger(existingSeatNo)) return [{ seat_no: existingSeatNo }];
            return [];
          }
          if (sqlNormalized.includes("insert into public.poker_seats") && sqlNormalized.includes("is_bot")) {
            const [, botUserId, botSeatNo, botProfile, botStack] = params;
            if (seats.some((seat) => seat.seat_no === botSeatNo || seat.user_id === botUserId)) return [];
            seats.push({
              table_id: tableId,
              user_id: botUserId,
              seat_no: botSeatNo,
              status: "ACTIVE",
              is_bot: true,
              bot_profile: botProfile,
              leave_after_hand: false,
              stack: botStack,
            });
            return [{ seat_no: botSeatNo }];
          }
          if (sqlNormalized.includes("insert into public.poker_seats")) {
            seats.push({ table_id: tableId, user_id: userId, seat_no: params?.[2], status: "ACTIVE", is_bot: false, stack: params?.[3] });
            return [];
          }
          if (sqlNormalized.includes("select count(*)::int as count from public.poker_seats") && sqlNormalized.includes("coalesce(is_bot, false) = false")) {
            const humans = seats.filter((seat) => seat.status === "ACTIVE" && !seat.is_bot).length;
            return [{ count: humans }];
          }
          if (sqlNormalized.includes("select count(*)::int as count from public.poker_seats") && sqlNormalized.includes("coalesce(is_bot, false) = true")) {
            const bots = seats.filter((seat) => seat.status === "ACTIVE" && !!seat.is_bot).length;
            return [{ count: bots }];
          }
          if (sqlNormalized.includes("select seat_no from public.poker_seats where table_id = $1 order by seat_no asc")) {
            return seats.map((seat) => ({ seat_no: seat.seat_no })).sort((a, b) => a.seat_no - b.seat_no);
          }
          if (text.includes("from public.chips_accounts")) {
            return [{ id: "escrow-1" }];
          }
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
    postTransaction: async (payload) => {
      ledgerCalls.push(payload);
      return { transaction: { id: `tx-${ledgerCalls.length}` } };
    },
    klog: (event, payload) => { logs.push({ event, payload }); },
    HEARTBEAT_INTERVAL_SEC: 15,
  });

  return { handler, seats, ledgerCalls, logs, stateHolder, queries };
};

const callJoin = (handler, requestId = "join-1") =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 0, buyIn: 100, requestId }),
  });

const run = async () => {
  {
    const ctx = makeJoinHandler({ botEnabled: true, botMaxPerTable: 2, tableMaxPlayers: 6 });
    const res = await callJoin(ctx.handler, "seed-once");
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);

    const humanSeats = ctx.seats.filter((seat) => !seat.is_bot);
    const botSeats = ctx.seats.filter((seat) => seat.is_bot);
    assert.equal(humanSeats.length, 1);
    assert.equal(botSeats.length, 2);
    for (const bot of botSeats) {
      assert.equal(bot.bot_profile, "TRIVIAL");
      assert.equal(bot.leave_after_hand, false);
      assert.equal(bot.stack, 200);
    }

    const stackMap = ctx.stateHolder.state?.stacks || {};
    assert.equal(stackMap[botSeats[0].user_id], botSeats[0].stack);
    assert.equal(stackMap[botSeats[1].user_id], botSeats[1].stack);
    assert.equal(ctx.ledgerCalls.filter((entry) => entry.txType === "TABLE_BUY_IN").length, 3);
    const botSeedLedger = ctx.ledgerCalls.filter((entry) => entry.metadata?.reason === "BOT_SEED_BUY_IN");
    assert.equal(botSeedLedger.length, 2);
    for (const ledgerCall of botSeedLedger) {
      assert.equal(ledgerCall.userId, null);
      assert.equal(Array.isArray(ledgerCall.entries), true);
      assert.equal(ledgerCall.entries.length, 2);
      assert.equal(ledgerCall.entries.filter((entry) => entry.accountType === "USER").length, 0);
      assert.equal(
        ledgerCall.entries.some((entry) => entry.accountType === "SYSTEM" && String(entry.systemKey || "").startsWith("POKER_BOT:")),
        false
      );
      assert.equal(
        ledgerCall.entries.some((entry) => entry.accountType === "SYSTEM" && entry.systemKey === "TREASURY" && entry.amount === -200),
        true
      );
      assert.equal(
        ledgerCall.entries.some((entry) => entry.accountType === "ESCROW" && entry.systemKey === `POKER_TABLE:${tableId}` && entry.amount === 200),
        true
      );
    }
    assert.equal(ctx.logs.some((entry) => entry.event === "poker_join_bot_seed_failed"), false);
  }

  {
    const ctx = makeJoinHandler({ botEnabled: false, tableMaxPlayers: 6 });
    const res = await callJoin(ctx.handler, "seed-disabled");
    assert.equal(res.statusCode, 200);
    assert.equal(ctx.seats.filter((seat) => seat.is_bot).length, 0);
    assert.equal(ctx.ledgerCalls.filter((entry) => entry.metadata?.reason === "BOT_SEED_BUY_IN").length, 0);
  }

  {
    const ctx = makeJoinHandler({ botEnabled: true, botMaxPerTable: 2, tableMaxPlayers: 2 });
    const res = await callJoin(ctx.handler, "reserve-seat");
    assert.equal(res.statusCode, 200);
    assert.equal(ctx.seats.filter((seat) => seat.is_bot).length, 0);
  }

  {
    const ctx = makeJoinHandler({ botEnabled: true, botMaxPerTable: 2, tableMaxPlayers: 6, stakesOk: false });
    const res = await callJoin(ctx.handler, "invalid-stakes");
    assert.equal(res.statusCode, 200);
    assert.equal(ctx.seats.filter((seat) => seat.is_bot).length, 0);
    assert.equal(ctx.seats.filter((seat) => !seat.is_bot).length, 1);
    assert.equal(ctx.ledgerCalls.filter((entry) => entry.metadata?.reason === "BOT_SEED_BUY_IN").length, 0);
    assert.equal(ctx.ledgerCalls.filter((entry) => entry.txType === "TABLE_BUY_IN").length, 1);
  }

  {
    const ctx = makeJoinHandler({ botEnabled: true, botMaxPerTable: 2, tableMaxPlayers: 6 });
    ctx.seats.push({
      table_id: tableId,
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      seat_no: 2,
      status: "ACTIVE",
      is_bot: true,
      bot_profile: "TRIVIAL",
      leave_after_hand: false,
      stack: 200,
    });

    const res = await callJoin(ctx.handler, "seed-delta");
    assert.equal(res.statusCode, 200);
    assert.equal(ctx.seats.filter((seat) => seat.is_bot).length, 2);

    const botSeedLedger = ctx.ledgerCalls.filter((entry) => entry.metadata?.reason === "BOT_SEED_BUY_IN");
    assert.equal(botSeedLedger.length, 1);
    assert.equal(botSeedLedger[0].idempotencyKey, `bot-seed-buyin:${tableId}:3`);
  }

  {
    const requestStore = new Map();
    const ctx = makeJoinHandler({ botEnabled: true, botMaxPerTable: 2, tableMaxPlayers: 6, existingRequestStore: requestStore });
    const first = await callJoin(ctx.handler, "idem-seed");
    assert.equal(first.statusCode, 200);
    const second = await callJoin(ctx.handler, "idem-seed");
    assert.equal(second.statusCode, 200);
    assert.equal(ctx.seats.filter((seat) => seat.is_bot).length, 2);
    const botLedger = ctx.ledgerCalls.filter((entry) => entry.metadata?.reason === "BOT_SEED_BUY_IN");
    assert.equal(botLedger.length, 2);
    const keys = botLedger.map((entry) => entry.idempotencyKey).sort();
    assert.deepEqual(keys, [
      `bot-seed-buyin:${tableId}:2`,
      `bot-seed-buyin:${tableId}:3`,
    ]);
  }
};

await run();
