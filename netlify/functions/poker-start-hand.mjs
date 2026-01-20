import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { createDeck, dealHoleCards, shuffle } from "./_shared/poker-engine.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const makeError = (status, code) => {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
};

const parseRequestId = (value) => {
  if (value == null) return { ok: false, value: null };
  if (typeof value !== "string") return { ok: false, value: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, value: null };
  return { ok: true, value: trimmed };
};

const normalizeState = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
};

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const normalizeVersion = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getRng = () => {
  const testRng = globalThis.__TEST_RNG__;
  return typeof testRng === "function" ? testRng : Math.random;
};

const withoutHoleCards = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  if (!Object.prototype.hasOwnProperty.call(state, "holeCardsByUserId")) return state;
  const { holeCardsByUserId, ...rest } = state;
  return rest;
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    const headers = {
      ...baseHeaders(),
      "access-control-allow-origin": "null",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const tableIdValue = payload?.tableId;
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const requestIdParsed = parseRequestId(payload?.requestId);
  if (!requestIdParsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      const tableRows = await tx.unsafe("select id, status from public.poker_tables where id = $1 limit 1;", [tableId]);
      const table = tableRows?.[0] || null;
      if (!table) {
        throw makeError(404, "table_not_found");
      }
      if (table.status !== "OPEN") {
        throw makeError(409, "table_not_open");
      }

      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 for update;",
        [tableId]
      );
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) {
        throw new Error("poker_state_missing");
      }

      const currentState = normalizeState(stateRow.state);

      const seatRows = await tx.unsafe(
        "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
        [tableId]
      );
      const seats = Array.isArray(seatRows) ? seatRows : [];
      const validSeats = seats.filter((seat) => Number.isInteger(seat?.seat_no) && seat?.user_id);
      if (validSeats.length < 2) {
        throw makeError(400, "not_enough_players");
      }
      if (!validSeats.some((seat) => seat.user_id === auth.userId)) {
        throw makeError(403, "not_allowed");
      }

      if (currentState.phase && currentState.phase !== "INIT" && currentState.phase !== "HAND_DONE") {
        throw makeError(409, "already_in_hand");
      }

      const dealerSeatNo = validSeats[0].seat_no;
      const turnUserId = validSeats[1]?.user_id || validSeats[0].user_id;

      const handId = `hand_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const derivedSeats = validSeats.map((seat) => ({ userId: seat.user_id, seatNo: seat.seat_no }));
      const activeUserIds = new Set(validSeats.map((seat) => seat.user_id));
      const currentStacks = parseStacks(currentState.stacks);
      const nextStacks = Object.entries(currentStacks).reduce((acc, [userId, amount]) => {
        if (activeUserIds.has(userId)) {
          acc[userId] = amount;
        }
        return acc;
      }, {});

      const deck = shuffle(createDeck(), getRng());
      const dealResult = dealHoleCards(deck, validSeats.map((seat) => seat.user_id));

      const updatedState = {
        ...currentState,
        tableId: currentState.tableId || tableId,
        handId,
        phase: "PREFLOP",
        pot: 0,
        community: [],
        seats: derivedSeats,
        stacks: nextStacks,
        dealerSeatNo,
        turnUserId,
        holeCardsByUserId: dealResult.holeCardsByUserId,
        lastStartHandRequestId: requestIdParsed.value || null,
        lastStartHandUserId: auth.userId,
        startedAt: new Date().toISOString(),
      };

      const updateRows = await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1 returning version;",
        [tableId, JSON.stringify(updatedState)]
      );
      const newVersion = normalizeVersion(updateRows?.[0]?.version);
      if (newVersion == null) {
        throw makeError(409, "state_invalid");
      }

      return {
        tableId,
        version: newVersion,
        state: withoutHoleCards(updatedState),
        myHoleCards: dealResult.holeCardsByUserId[auth.userId] || [],
      };
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        tableId: result.tableId,
        state: {
          version: result.version,
          state: result.state,
        },
        myHoleCards: result.myHoleCards,
      }),
    };
  } catch (error) {
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_start_hand_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
