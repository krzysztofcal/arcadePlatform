import assert from "node:assert/strict";
import { loadPokerHandler, pokerTierPolicyRows } from "./helpers/poker-test-helpers.mjs";
import { isStateStorageValid, normalizeJsonState } from "../netlify/functions/_shared/poker-state-utils.mjs";

process.env.CHIPS_ENABLED = "1";

const userId = "user-quick";

const callQuickSeat = async (handler, body = {}) => {
  return handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
};

const makeHandler = ({ enabledBuyIns = [100, 500], poolSchema = true, pendingTables = 0, mode, queries, notifications = [], logs = [], events = [], balance = 110, balanceError = false, candidateBuyIn = 100, activeSeatNo = 2, effectiveClass = "NORMAL", checkWsBuyInCapability = async () => ({ ok: true }) }) =>
  loadPokerHandler("netlify/functions/poker-quick-seat.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    beginSql: async (fn) => {
      events.push("beginSql");
      return fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes(") pending_tables")) return [{ count: pendingTables }];
          if (text.includes("to_regclass")) return [{ available: poolSchema }];
          if (text.includes("from public.poker_bot_tier_policy")) return pokerTierPolicyRows(enabledBuyIns);
          if (text.includes("system_key = any")) return params[0].map((system_key) => ({ system_key }));
          if (!poolSchema) assert.doesNotMatch(text, /is_slow_only|poker_auto_class|poker_access_policy/);

          if (text.includes("pg_advisory_xact_lock")) return [];

          if (text.includes("select poker_auto_class, poker_access_override")) {
            return [{ poker_auto_class: effectiveClass === "RESTRICTED" ? "NORMAL" : effectiveClass, poker_access_override: effectiveClass === "RESTRICTED" ? "FORCE_RESTRICTED" : "AUTO", poker_access_revision: 1 }];
          }

          if (text.includes("join public.poker_seats s") && text.includes("s.user_id = $1")) {
            if (mode === "already_seated") return [{ id: "table-human", max_players: 6, buy_in: candidateBuyIn, stakes: { sb: candidateBuyIn / 100, bb: candidateBuyIn / 50 } }];
            return [];
          }

          if (text.includes("account_type = 'user'")) {
            if (balanceError) throw new Error("balance_read_failed");
            return [{ balance }];
          }

          if (
            text.includes("from public.poker_tables t") &&
            text.includes("where t.status = 'open'") &&
            text.includes("t.max_players = $1") &&
            text.includes("t.buy_in = any($4::int[])")
          ) {
            const requireHuman = params?.[1] === true;
            if (mode === "prefer_humans" || mode === "already_seated") {
              if (requireHuman) return [{ id: "table-human", max_players: 6, buy_in: candidateBuyIn, stakes: { sb: candidateBuyIn / 100, bb: candidateBuyIn / 50 } }];
              return [];
            }
            if (mode === "any_open") {
              if (requireHuman) return [];
              return [{ id: "table-any", max_players: 6, buy_in: candidateBuyIn, stakes: { sb: candidateBuyIn / 100, bb: candidateBuyIn / 50 } }];
            }
            return [];
          }

          if (text.includes("where table_id = $1 and user_id = $2") && text.includes("limit 1")) {
            if (mode === "already_seated") return [{ seat_no: activeSeatNo }];
            return [];
          }

          if (text.includes("where table_id = $1 order by seat_no asc")) {
            if (mode === "prefer_humans") return [{ seat_no: 1 }, { seat_no: 2 }];
            if (mode === "any_open") return [{ seat_no: 1 }];
            return [];
          }

          if (text.includes("insert into public.poker_tables")) {
            return [{ id: "table-new" }];
          }

          if (text.includes("insert into public.poker_state")) return [];
          if (text.includes("from public.chips_accounts")) return [{ id: "escrow-1" }];
          if (text.includes("update public.poker_tables")) return [];
          return [];
        },
      });
    },
    notifyWsLobbyMaterialize: async (payload) => {
      notifications.push(payload);
      return { ok: true };
    },
    checkWsBuyInCapability,
    klog: (kind, data) => { logs.push({ kind, data }); },
  });

const findLockCall = (queries) =>
  queries.find((entry) => entry.query.toLowerCase().includes("pg_advisory_xact_lock(hashtext($1))"));

const findLockCalls = (queries) =>
  queries.filter((entry) => entry.query.toLowerCase().includes("pg_advisory_xact_lock(hashtext($1))"));

const assertCanonicalLockKey = (queries, expectedKey) => {
  const lockCall = findLockCall(queries);
  assert.ok(lockCall, "quick seat should issue advisory lock query");
  const lockCalls = findLockCalls(queries);
  const matchLock = lockCalls.find((entry) => entry?.params?.[0] === expectedKey);
  assert.ok(matchLock, "quick seat should issue its match lock");
  assert.match(String(lockCall?.params?.[0] || ""), /^poker-table-slots:v1:/);
  assert.ok(queries.indexOf(lockCall) < queries.indexOf(matchLock), "user slot lock must precede match lock");
};

const run = async () => {
  {
    const queries = [], notifications = [];
    const response = await callQuickSeat(makeHandler({ mode: "create", queries, notifications, pendingTables: 4, balance: 550 }), { buyIn: 100 });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(JSON.parse(response.body), { error: "pending_table_limit", limit: 4 });
    assert.equal(queries.some(({ query }) => query.includes("insert into public.poker_tables")), false);
    assert.equal(notifications.length, 0);
  }
  for (const effectiveClass of ["NORMAL", "SLOW", "RESTRICTED"]) {
    const queries = [];
    const response = await callQuickSeat(makeHandler({ mode: "any_open", queries, effectiveClass, balance: 550 }), { buyIn: 100 });
    assert.equal(response.statusCode, 200);
    assert.ok(queries.filter(({ query }) => query.includes("t.buy_in = any($4::int[])"))
      .every(({ params }) => params[4] === effectiveClass && JSON.stringify(params[3]) === "[100]"));
  }
  // Exact tier is an optional contract; legacy cases below stay unchanged.
  for (const mode of ["prefer_humans", "any_open", "create"]) {
    const queries = [], notifications = [];
    const handler = makeHandler({ mode, queries, notifications, balance: 550 });
    const response = await callQuickSeat(handler, { maxPlayers: 6, buyIn: 100 });
    assert.equal(response.statusCode, 200);
    assert.ok(queries.filter(({ query }) => query.includes("t.buy_in = any($4::int[])"))
      .every(({ params }) => JSON.stringify(params[3]) === "[100]"), "both searches must keep the selected tier");
    if (mode === "create") assert.equal(notifications[0].buyIn, 100, "fallback Create must not upgrade tier");
  }
  for (const buyIn of [null, "100", true, 0, -1, 100.5, Number.MAX_SAFE_INTEGER + 1]) {
    const queries = [];
    const response = await callQuickSeat(makeHandler({ mode: "create", queries }), { buyIn });
    assert.equal(response.statusCode, 400, "supplied buyIn must be a positive safe integer number");
    assert.equal(JSON.parse(response.body).error, "invalid_buy_in");
    assert.equal(queries.length, 0);
  }
  for (const settings of [{ balance: 99 }, { enabledBuyIns: [500], balance: 550 }, { enabledBuyIns: [100, 500, 1000], balance: 1100 }]) {
    const queries = [], notifications = [];
    const response = await callQuickSeat(makeHandler({ mode: "create", queries, notifications, ...settings }), { buyIn: 100 });
    assert.equal(response.statusCode, 409, "fresh policy/bankroll must revalidate the selected tier");
    assert.equal(JSON.parse(response.body).error, "buy_in_tier_locked");
    assert.equal(queries.some(({ query }) => query.includes("insert into public.poker_tables")), false);
    assert.equal(notifications.length, 0);
  }
  {
    const queries = [];
    const response = await callQuickSeat(makeHandler({ mode: "create", queries, effectiveClass: "UNKNOWN" }), { buyIn: 100 });
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).error, "poker_access_unavailable");
    assert.equal(queries.some(({ query }) => query.includes("insert into public.poker_tables")), false);
  }
  {
    const queries = [];
    const response = await callQuickSeat(makeHandler({ mode: "already_seated", queries, balance: 0, enabledBuyIns: [], candidateBuyIn: 500 }), { buyIn: 100 });
    assert.equal(response.statusCode, 200, "resume existing financed seat before tier revalidation");
    assert.equal(JSON.parse(response.body).tableId, "table-human");
    assert.equal(queries.some(({ query }) => /account_type = 'USER'|insert into public.poker_seats|chips_transactions|insert into public.poker_tables/.test(query)), false, "resume has no second funding or reseating");
  }
  {
    const queries = [], notifications = [];
    // Defensive mismatch guard also covers a stale/unexpected candidate projection.
    const response = await callQuickSeat(makeHandler({ mode: "prefer_humans", queries, notifications, balance: 550, candidateBuyIn: 500 }), { buyIn: 100 });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).tableId, "table-new");
    assert.equal(notifications[0].buyIn, 100);
  }
  for (const mode of ["prefer_humans", "create"]) {
    const queries = [], notifications = [];
    const handler = makeHandler({ mode, queries, notifications, balance: 1_000_000, candidateBuyIn: 500 });
    const response = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(response.statusCode, 200);
    const candidateQueries = queries.filter(({ query }) => query.includes("t.buy_in = any($4::int[])"));
    assert.ok(candidateQueries.length > 0);
    assert.ok(candidateQueries.every(({ params }) => JSON.stringify(params[3]) === "[500,100]"));
    if (mode === "create") {
      assert.equal(queries.find(({ query }) => query.includes("insert into public.poker_tables"))?.params[1], 500);
      assert.equal(notifications[0].buyIn, 500);
    } else assert.equal(JSON.parse(response.body).tableId, "table-human");
  }

  for (const balance of [1100, 1_000_000]) {
    for (const mode of ["prefer_humans", "create"]) {
      const queries = [];
      const handler = makeHandler({ mode, queries, balance, candidateBuyIn: 1000, enabledBuyIns: [100, 500, 1000] });
      const response = await callQuickSeat(handler, { maxPlayers: 6 });
      assert.equal(response.statusCode, 200);
      assert.ok(queries.filter(({ query }) => query.includes("t.buy_in = any($4::int[])"))
        .every(({ params }) => JSON.stringify(params[3]) === "[1000,500]"));
      if (mode === "create") assert.equal(queries.find(({ query }) => query.includes("insert into public.poker_tables"))?.params[1], 1000);
    }
  }

  for (const mode of ["prefer_humans", "already_seated", "create"]) {
    const queries = [];
    const handler = makeHandler({ poolSchema: false, mode, queries });
    const response = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(response.statusCode, mode === "already_seated" ? 200 : 409, `missing tier policy denies fresh play but permits rejoin: ${mode}`);
    assert.equal(queries.some(({ query }) => query.includes("pending_tables")), false);
  }

  {
    const queries = [];
    const handler = makeHandler({ mode: "any_open", queries, effectiveClass: "RESTRICTED" });
    const response = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(response.statusCode, 200);
    assert.ok(queries.some((entry) => entry.query.includes("$5::text = 'RESTRICTED'")), "restricted Quick Seat should use the bot-free candidate predicate");
    assert.equal(JSON.parse(response.body).kind, undefined);
  }
  {
    const queries = [];
    const notifications = [];
    const handler = makeHandler({ mode: "prefer_humans", queries, notifications, balance: 550, candidateBuyIn: 500 });
    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-human");
    assert.equal(body.seatNo, 3);
    assert.ok(body.seatNo >= 1 && body.seatNo <= 6);
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("coalesce(hs.is_bot, false) = false")),
      "quick seat should prefer tables with at least one human"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("last_seen_at") && entry.query.toLowerCase().includes("$3::timestamptz")),
      "quick seat should exclude tables with stale active human seats"
    );
    assertCanonicalLockKey(queries, "quickseat:6");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("where table_id = $1 order by seat_no asc")),
      "quick seat should read occupied seats to suggest a reusable seat"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when recommending"
    );
    assert.equal(notifications.length, 0, "quick seat should not materialize runtime for an existing table recommendation");
  }
  {
    const queries = [];
    let capabilityChecks = 0;
    const handler = makeHandler({
      mode: "prefer_humans",
      queries,
      balance: 550,
      candidateBuyIn: 500,
      checkWsBuyInCapability: async () => {
        capabilityChecks += 1;
        return { ok: false, reason: "buy_in_capability_unavailable" };
      }
    });
    const response = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "ws_buy_in_capability_unavailable" });
    assert.equal(capabilityChecks, 1);
  }
  {
    const queries = [];
    const notifications = [];
    const logs = [];
    const handler = makeHandler({ mode: "prefer_humans", queries, notifications, logs, balance: 99 });
    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(JSON.parse(res.body), { error: "buy_in_tier_locked", buyIn: 100, requiredBuyIn: 100, requiredBankroll: 100, balance: 99 });
    assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables")), false);
    assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables")), false);
    assert.equal(notifications.length, 0);
    const candidateCalls = queries.filter((entry) => entry.query.toLowerCase().includes("t.buy_in = any"));
    assert.equal(candidateCalls.length, 1, "insufficient result must not continue to another candidate");
    assert.equal(logs.some((entry) => entry.kind === "poker_quick_seat_selected"), false);
    assert.equal(logs.filter((entry) => entry.kind === "poker_quick_seat_buy_in_tier_locked").length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(logs.find((entry) => entry.kind === "poker_quick_seat_buy_in_tier_locked")?.data || {}, "userId"), false);
  }

  {
    const queries = [];
    const notifications = [];
    const handler = makeHandler({ mode: "already_seated", queries, notifications, balance: 0, activeSeatNo: 6 });
    const res = await callQuickSeat(handler, { maxPlayers: 2 });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).seatNo, 6);
    assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("account_type = 'user'")), false);
  }

  {
    const queries = [];
    const handler = makeHandler({ mode: "any_open", queries, balanceError: true });
    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, "server_error");
  }

  {
    const queries = [];
    const notifications = [];
    const handler = makeHandler({ mode: "any_open", queries, notifications });
    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-any");
    assert.equal(body.seatNo, 2);
    assert.ok(body.seatNo >= 1 && body.seatNo <= 6);
    assertCanonicalLockKey(queries, "quickseat:6");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("where table_id = $1 order by seat_no asc")),
      "quick seat should read occupied seats before returning a recommendation"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("state ->> 'phase'")),
      "quick seat should exclude bots-only live-hand tables from generic open-table fallback"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("stale_hs.last_seen_at") || entry.query.toLowerCase().includes("coalesce(stale_hs.last_seen_at")),
      "quick seat should filter out stale active humans before reusing a table"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("'settled'") && entry.query.toLowerCase().includes("'hand_done'")),
      "quick seat should also exclude terminal bots-only tables that still expose the previous hand result"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when recommending"
    );
    assert.equal(notifications.length, 0, "quick seat should not materialize runtime for an existing open table recommendation");
  }

  {
    const queries = [];
    const notifications = [];
    const handler = makeHandler({ mode: "already_seated", queries, notifications });
    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-human");
    assert.equal(body.seatNo, 2);
    assertCanonicalLockKey(queries, "quickseat:6");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("where table_id = $1 and user_id = $2 and status = 'active' limit 1")),
      "quick seat should check existing seat for idempotency"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when returning existing seat"
    );
    assert.equal(notifications.length, 0, "quick seat should not materialize runtime when returning an existing seat");
  }

  {
    const queries = [];
    const notifications = [];
    const handler = makeHandler({ mode: "create", queries, notifications });
    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.tableId, "table-new");
    assert.equal(body.seatNo, 1);
    assert.ok(body.seatNo >= 1 && body.seatNo <= 6);
    assertCanonicalLockKey(queries, "quickseat:6");
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables")),
      "quick seat should create a table when none is available"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_state")),
      "quick seat should initialize canonical poker_state when creating table"
    );
    assert.ok(
      queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")),
      "quick seat should bump table activity when creating"
    );
    const stateInsertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_state"));
    assert.ok(stateInsertCall, "quick seat create path should insert poker_state");
    const storedState = normalizeJsonState(stateInsertCall?.params?.[1]);
    assert.equal(isStateStorageValid(storedState), true, "quick seat create path should persist a storage-valid init state");
    assert.ok(
      !queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_seats")),
      "quick seat should not seat the user directly"
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.tableId, "table-new");
    assert.equal(notifications[0]?.maxPlayers, 6);
    assert.deepEqual(notifications[0]?.stakes, { sb: 1, bb: 2 });
  }
  {
    const queries = [];
    let resolveNotify;
    let notifyCalled = false;
    const pendingNotify = new Promise((resolve) => {
      resolveNotify = resolve;
    });
    const handler = loadPokerHandler("netlify/functions/poker-quick-seat.mjs", {
      baseHeaders: () => ({}),
      corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
      extractBearerToken: () => "token",
      verifySupabaseJwt: async () => ({ valid: true, userId }),
      beginSql: async (fn) => fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("to_regclass")) return [{ available: true }];
          if (text.includes("from public.poker_bot_tier_policy")) return pokerTierPolicyRows();
          if (text.includes("system_key = any")) return params[0].map((system_key) => ({ system_key }));
          if (text.includes("pg_advisory_xact_lock")) return [];
          if (text.includes("select poker_auto_class, poker_access_override")) {
            return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
          }
          if (text.includes("from public.poker_tables t")) return [];
          if (text.includes("account_type = 'user'")) return [{ balance: 110 }];
          if (text.includes("insert into public.poker_tables")) return [{ id: "table-slow-notify" }];
          if (text.includes("insert into public.poker_state")) return [];
          if (text.includes("from public.chips_accounts")) return [{ id: "escrow-1" }];
          if (text.includes("update public.poker_tables")) return [];
          return [];
        }
      }),
      notifyWsLobbyMaterialize: async () => {
        notifyCalled = true;
        return pendingNotify;
      },
      klog: () => {},
    });

    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.tableId, "table-slow-notify");
    assert.equal(notifyCalled, true, "quick seat should trigger runtime notify");
    resolveNotify({ ok: true });
  }
  {
    const queries = [];
    const notifications = [];
    const handler = makeHandler({ mode: "create", queries, notifications, balance: 550 });
    const res = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(res.statusCode, 200);
    const createCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables"));
    assert.equal(createCall?.params?.[1], 500);
    assert.deepEqual(JSON.parse(createCall?.params?.[0]), { sb: 5, bb: 10 });
    assert.equal(notifications[0]?.buyIn, 500);
    assert.deepEqual(notifications[0]?.stakes, { sb: 5, bb: 10 });
  }
  {
    const queries = [];
    const state = { created: false };
    const handler = loadPokerHandler("netlify/functions/poker-quick-seat.mjs", {
      baseHeaders: () => ({}),
      corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
      extractBearerToken: () => "token",
      verifySupabaseJwt: async () => ({ valid: true, userId }),
      beginSql: async (fn) => {
        return fn({
          unsafe: async (query, params) => {
            queries.push({ query: String(query), params });
            const text = String(query).toLowerCase();
          if (text.includes("to_regclass")) return [{ available: true }];
          if (text.includes("from public.poker_bot_tier_policy")) return pokerTierPolicyRows();
          if (text.includes("system_key = any")) return params[0].map((system_key) => ({ system_key }));

            if (text.includes("pg_advisory_xact_lock")) return [];
            if (text.includes("select poker_auto_class, poker_access_override")) {
              return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
            }
            if (text.includes("account_type = 'user'")) return [{ balance: 110 }];

            if (
              text.includes("from public.poker_tables t") &&
              text.includes("where t.status = 'open'") &&
              text.includes("t.max_players = $1") &&
              text.includes("t.buy_in = any($4::int[])")
            ) {
              if (state.created) return [{ id: "table-created", max_players: 6, buy_in: 100, stakes: { sb: 1, bb: 2 } }];
              return [];
            }

            if (text.includes("where table_id = $1 and user_id = $2 limit 1")) return [];
            if (text.includes("where table_id = $1 order by seat_no asc")) return [];
            if (text.includes("insert into public.poker_tables")) {
              state.created = true;
              return [{ id: "table-created" }];
            }
            if (text.includes("insert into public.poker_state")) return [];
            if (text.includes("from public.chips_accounts")) return [{ id: "escrow-1" }];
            if (text.includes("update public.poker_tables")) return [];
            return [];
          },
        });
      },
      klog: () => {},
    });

    const first = await callQuickSeat(handler, { maxPlayers: 6 });
    const firstBody = JSON.parse(first.body);
    assert.equal(first.statusCode, 200);
    assert.equal(firstBody.tableId, "table-created");

    const second = await callQuickSeat(handler, { maxPlayers: 6 });
    const secondBody = JSON.parse(second.body);
    assert.equal(second.statusCode, 200);
    assert.equal(secondBody.tableId, "table-created");

    const createCalls = queries.filter((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables"));
    assert.equal(createCalls.length, 1, "serialized matchmaking should avoid creating a second table when existing table is open");

    const lockCalls = queries.filter((entry) => entry.query.toLowerCase().includes("pg_advisory_xact_lock(hashtext($1))"));
    assert.equal(lockCalls.length, 4);
    assert.match(lockCalls[0]?.params?.[0] || "", /^poker-table-slots:v1:/);
    assert.equal(lockCalls[1]?.params?.[0], "quickseat:6");
    assert.match(lockCalls[2]?.params?.[0] || "", /^poker-table-slots:v1:/);
    assert.equal(lockCalls[3]?.params?.[0], "quickseat:6");
  }
  {
    const queries = [];
    const handler = makeHandler({ mode: "create", queries });
    process.env.CHIPS_ENABLED = "0";
    try {
      const response = await callQuickSeat(handler, { maxPlayers: 6 });
      assert.equal(response.statusCode, 404);
      assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
      assert.equal(queries.length, 0);
    } finally {
      process.env.CHIPS_ENABLED = "1";
    }
  }
  {
    const queries = [];
    let capabilityChecks = 0;
    const handler = makeHandler({
      mode: "create",
      queries,
      balance: 550,
      checkWsBuyInCapability: async () => {
        capabilityChecks += 1;
        return { ok: false, reason: "buy_in_capability_unavailable" };
      }
    });
    const response = await callQuickSeat(handler, { maxPlayers: 6 });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "ws_buy_in_capability_unavailable" });
    assert.equal(capabilityChecks, 1);
    assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables")), false);
  }
  {
    const queries = [];
    const events = [];
    let resolveCapability;
    const capabilityPending = new Promise((resolve) => { resolveCapability = resolve; });
    const handler = makeHandler({
      mode: "create",
      queries,
      events,
      balance: 550,
      checkWsBuyInCapability: async () => {
        events.push("capability");
        return capabilityPending;
      }
    });
    const pendingResponse = callQuickSeat(handler, { maxPlayers: 6 });
    await Promise.resolve();
    assert.deepEqual(events, ["capability"], "capability probe must complete before Quick Seat opens its DB transaction");
    assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("pg_advisory_xact_lock")), false);
    resolveCapability({ ok: false, reason: "buy_in_capability_unavailable" });
    const response = await pendingResponse;
    assert.equal(response.statusCode, 503);
    assert.equal(events.indexOf("capability") < events.indexOf("beginSql"), true);
  }

  // Single Player tests (#1077)
  {
    // 1. Single Player creates dedicated table with is_single_player: true and <= 1000 CH
    const queries = [], notifications = [];
    const handler = makeHandler({ mode: "create", queries, notifications, balance: 550 });
    const response = await callQuickSeat(handler, { mode: "single_player", maxPlayers: 6, buyIn: 500 });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.seatNo, 1);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].isSinglePlayer, true);
    assert.equal(notifications[0].buyIn, 500);
    const insertQuery = queries.find((q) => q.query.includes("insert into public.poker_tables"));
    assert.ok(insertQuery, "must insert into poker_tables");
    assert.match(insertQuery.query, /is_single_player/);
    assert.equal(insertQuery.params[3], userId, "created_by must match authenticated creator");
    assert.equal(insertQuery.params[7], true, "is_single_player must be true");
  }
  {
    // 2. Single Player buy-in > 1000 CH is rejected with 400 invalid_buy_in
    const queries = [];
    const handler = makeHandler({ mode: "create", queries, balance: 10000 });
    const response = await callQuickSeat(handler, { mode: "single_player", maxPlayers: 6, buyIn: 2500 });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: "invalid_buy_in" });
    assert.equal(queries.length, 0);
  }
  {
    // 3. Normal Poker Online candidate query explicitly filters coalesce(t.is_single_player, false) = false
    const queries = [];
    const handler = makeHandler({ mode: "any_open", queries, balance: 550 });
    const response = await callQuickSeat(handler, { maxPlayers: 6, buyIn: 100 });
    assert.equal(response.statusCode, 200);
    const activeSeatQuery = queries.find((q) => q.query.includes("join public.poker_seats s") && q.query.includes("coalesce(t.is_single_player, false) = $2"));
    assert.ok(activeSeatQuery, "must query active seat");
    assert.equal(activeSeatQuery.params[1], false, "active seat query must filter is_single_player false for online mode");

    const candidateQuery = queries.find((q) => q.query.includes("t.buy_in = any($4::int[])"));
    assert.ok(candidateQuery, "must query candidate tables");
    assert.match(candidateQuery.query, /coalesce\(t\.is_single_player,\s*false\)\s*=\s*false/i);
  }
  {
    // 4. Double-click / retry reuses recent pending Single Player table within 60s
    let checkedRecent = false;
    const queries = [];
    const handler = loadPokerHandler("netlify/functions/poker-quick-seat.mjs", {
      baseHeaders: () => ({}),
      corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
      extractBearerToken: () => "token",
      verifySupabaseJwt: async () => ({ valid: true, userId }),
      beginSql: async (fn) => fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("to_regclass")) return [{ available: true }];
          if (text.includes("poker_auto_class")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
          if (text.includes("join public.poker_seats s")) return [];
          if (text.includes("account_type = 'user'")) return [{ balance: 1000 }];
          if (text.includes("from public.poker_bot_tier_policy")) return pokerTierPolicyRows([100, 500, 1000]);
          if (text.includes("system_key = any")) return params[0].map((system_key) => ({ system_key }));
          if (text.includes("t.is_single_player = true") && text.includes("interval '60 seconds'")) {
            checkedRecent = true;
            return [{ id: "table-pending-existing", max_players: 6, buy_in: 500, stakes: { sb: 5, bb: 10 } }];
          }
          if (text.includes("where table_id = $1 order by seat_no asc")) return [];
          return [];
        }
      }),
      notifyWsLobbyMaterialize: async () => ({ ok: true }),
      checkWsBuyInCapability: async () => ({ ok: true }),
      klog: () => {}
    });
    const response = await callQuickSeat(handler, { mode: "single_player", maxPlayers: 6, buyIn: 500 });
    assert.equal(response.statusCode, 200);
    assert.equal(checkedRecent, true);
    assert.deepEqual(JSON.parse(response.body), { ok: true, tableId: "table-pending-existing", seatNo: 1 });
    assert.equal(queries.some((q) => q.query.includes("insert into public.poker_tables")), false, "must not create duplicate table on retry");
  }

};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
