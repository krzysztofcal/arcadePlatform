import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { createDeck, dealHoleCards, shuffle } from "./_shared/poker-engine.mjs";
import { getRng, isPlainObject, isStateStorageValid, normalizeJsonState, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

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

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const normalizeVersion = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeRank = (rank) => {
  if (typeof rank === "string") return rank;
  const num = Number(rank);
  if (!Number.isFinite(num)) return "";
  if (num >= 2 && num <= 9) return String(num);
  if (num === 10) return "T";
  if (num === 11) return "J";
  if (num === 12) return "Q";
  if (num === 13) return "K";
  if (num === 14) return "A";
  return "";
};

const normalizeCard = (card) => ({
  r: normalizeRank(card?.r),
  s: typeof card?.s === "string" ? card.s : "",
});

const normalizeCardsArray = (cards) => (Array.isArray(cards) ? cards.map(normalizeCard) : []);

const normalizeHoleCardsByUserId = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [userId, cards]) => {
    acc[userId] = normalizeCardsArray(cards);
    return acc;
  }, {});
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });
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
    return { statusCode: 204, headers: mergeHeaders(cors), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: mergeHeaders(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const tableIdValue = payload?.tableId;
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const requestIdParsed = parseRequestId(payload?.requestId);
  if (!requestIdParsed.ok) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_request_id" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return {
      statusCode: 401,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ error: "unauthorized", reason: auth.reason }),
    };
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

      const currentState = normalizeJsonState(stateRow.state);

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

      const sameRequest =
        currentState.lastStartHandRequestId === requestIdParsed.value && currentState.lastStartHandUserId === auth.userId;
      if (sameRequest) {
        if (currentState.phase === "PREFLOP" && typeof currentState.handId === "string" && currentState.handId.trim()) {
          return {
            tableId,
            version: normalizeVersion(stateRow.version),
            state: withoutPrivateState(currentState),
            myHoleCards: currentState.holeCardsByUserId?.[auth.userId] || [],
          };
        }
        throw makeError(409, "state_invalid");
      }

      if (currentState.phase && currentState.phase !== "INIT" && currentState.phase !== "HAND_DONE") {
        throw makeError(409, "already_in_hand");
      }

      const dealerSeatNo = validSeats[0].seat_no;
      const turnUserId = validSeats[1]?.user_id || validSeats[0].user_id;

      const rng = getRng();
      const handId = `hand_${Date.now()}_${Math.floor(rng() * 1e6)}`;
      const derivedSeats = validSeats.map((seat) => ({ userId: seat.user_id, seatNo: seat.seat_no }));
      const activeUserIds = new Set(validSeats.map((seat) => seat.user_id));
      const currentStacks = parseStacks(currentState.stacks);
      const nextStacks = Object.entries(currentStacks).reduce((acc, [userId, amount]) => {
        if (activeUserIds.has(userId)) {
          acc[userId] = amount;
        }
        return acc;
      }, {});

      const deck = shuffle(createDeck(), rng);
      const dealResult = dealHoleCards(deck, validSeats.map((seat) => seat.user_id));
      const normalizedDeck = normalizeCardsArray(dealResult.deck);
      const normalizedHoleCards = normalizeHoleCardsByUserId(dealResult.holeCardsByUserId);

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
        holeCardsByUserId: normalizedHoleCards,
        deck: normalizedDeck,
        lastStartHandRequestId: requestIdParsed.value || null,
        lastStartHandUserId: auth.userId,
        startedAt: new Date().toISOString(),
      };

      if (!isStateStorageValid(updatedState, { requirePrivate: true })) {
        klog("poker_state_corrupt", { tableId, phase: updatedState.phase });
        throw makeError(409, "state_invalid");
      }

      const updateRows = await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1 returning version;",
        [tableId, JSON.stringify(updatedState)]
      );
      const newVersion = normalizeVersion(updateRows?.[0]?.version);
      if (newVersion == null) {
        throw makeError(409, "state_invalid");
      }

      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount) values ($1, $2, $3, $4, $5);",
        [tableId, newVersion, auth.userId, "START_HAND", null]
      );

      return {
        tableId,
        version: newVersion,
        state: withoutPrivateState(updatedState),
        myHoleCards: normalizedHoleCards[auth.userId] || [],
      };
    });

    return {
      statusCode: 200,
      headers: mergeHeaders(cors),
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
      return { statusCode: error.status, headers: mergeHeaders(cors), body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_start_hand_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
