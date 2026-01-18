import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { applyAction, ensureAutoStart, normalizeSeatRows, normalizeState, toPublicState } from "./_shared/poker-engine.mjs";

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

const parseActionType = (value) => {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if (!upper) return null;
  return upper;
};

const parseAmount = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
};

const mapHoleCards = (rows) =>
  Array.isArray(rows)
    ? rows.reduce((acc, row) => {
        if (row?.user_id && row?.cards) {
          acc[row.user_id] = row.cards;
        }
        return acc;
      }, {})
    : {};

const loadHoleCardsForHand = async (tx, tableId, handId) => {
  if (!handId) return {};
  const rows = await tx.unsafe(
    "select user_id, cards from public.poker_hole_cards where table_id = $1 and hand_id = $2;",
    [tableId, handId]
  );
  return mapHoleCards(rows);
};

const loadHoleCardsForUser = async (tx, tableId, handId, userId) => {
  if (!handId || !userId) return null;
  const rows = await tx.unsafe(
    "select cards from public.poker_hole_cards where table_id = $1 and hand_id = $2 and user_id = $3 limit 1;",
    [tableId, handId, userId]
  );
  return rows?.[0]?.cards || null;
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
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

  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok || !requestIdParsed.value) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const requestId = requestIdParsed.value;

  const actionType = parseActionType(payload?.actionType);
  if (!actionType) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_action_type" }) };
  }
  const amount = parseAmount(payload?.amount);

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      const tableRows = await tx.unsafe(
        "select id, status, stakes from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const table = tableRows?.[0] || null;
      if (!table) throw makeError(404, "table_not_found");
      if (table.status !== "OPEN") throw makeError(409, "table_not_open");

      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, stack from public.poker_seats where table_id = $1 order by seat_no asc;",
        [tableId]
      );
      const seats = normalizeSeatRows(seatRows);
      const authSeat = seats.find((seat) => seat.userId === auth.userId);
      if (!authSeat) throw makeError(403, "not_seated");

      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 for update;",
        [tableId]
      );
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) throw new Error("poker_state_missing");
      const currentState = normalizeState(stateRow.state);

      const requestMarker = `REQUEST:${requestId}`;
      const existingRows = await tx.unsafe(
        "select id, version from public.poker_actions where table_id = $1 and user_id = $2 and action_type = $3 limit 1;",
        [tableId, auth.userId, requestMarker]
      );
      const existing = existingRows?.[0];
      if (existing?.version != null) {
        const latestRows = await tx.unsafe(
          "select version, state from public.poker_state where table_id = $1 limit 1;",
          [tableId]
        );
        const latest = latestRows?.[0] || stateRow;
        const latestState = normalizeState(latest?.state);
        const publicState = toPublicState(latestState, auth.userId);
        const userHoleCards = await loadHoleCardsForUser(tx, tableId, latestState?.handId, auth.userId);
        if (userHoleCards) {
          publicState.hole = { [auth.userId]: userHoleCards };
        }
        return { ok: true, state: publicState, version: Number(latest?.version) };
      }

      const stakes = table.stakes || {};
      const stacks = seats.reduce((acc, seat) => {
        const stackValue = Number.isFinite(seat.stack) ? seat.stack : 0;
        acc[seat.userId] = stackValue;
        return acc;
      }, {});

      const autoStarted = ensureAutoStart({ state: currentState, tableId, seats, stacks, stakes });
      if (!autoStarted.ok) throw makeError(409, autoStarted.error || "cannot_start");
      const baseState = autoStarted.state || currentState;
      const handId = baseState.handId;
      let holeCards = {};
      if (autoStarted.holeCards) {
        const inserts = Object.entries(autoStarted.holeCards);
        for (const [userId, cards] of inserts) {
          await tx.unsafe(
            "insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ($1, $2, $3, $4::jsonb) on conflict do nothing;",
            [tableId, handId, userId, JSON.stringify(cards)]
          );
        }
        holeCards = autoStarted.holeCards;
      } else {
        holeCards = await loadHoleCardsForHand(tx, tableId, handId);
      }

      const actionResult = applyAction({
        currentState: baseState,
        actionType,
        amount,
        userId: auth.userId,
        stakes,
        holeCards,
      });
      if (!actionResult.ok) throw makeError(409, actionResult.error || "action_invalid");
      const nextState = actionResult.state;

      const updateRows = await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1 returning version;",
        [tableId, JSON.stringify(nextState)]
      );
      const newVersion = Number(updateRows?.[0]?.version);
      if (!Number.isFinite(newVersion)) throw makeError(409, "state_invalid");

      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount) values ($1, $2, $3, $4, $5);",
        [tableId, newVersion, auth.userId, actionType, amount ?? null]
      );
      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount) values ($1, $2, $3, $4, $5);",
        [tableId, newVersion, auth.userId, requestMarker, null]
      );

      const nextSeats = Array.isArray(nextState.public?.seats) ? nextState.public.seats : [];
      for (const seat of nextSeats) {
        if (!seat.userId) continue;
        const stackValue = Number.isFinite(seat.stack) ? seat.stack : 0;
        await tx.unsafe(
          "update public.poker_seats set stack = $3 where table_id = $1 and user_id = $2;",
          [tableId, seat.userId, stackValue]
        );
      }

      const publicState = toPublicState(nextState, auth.userId);
      const userHoleCards = autoStarted.holeCards
        ? autoStarted.holeCards[auth.userId]
        : await loadHoleCardsForUser(tx, tableId, handId, auth.userId);
      if (userHoleCards) {
        publicState.hole = { [auth.userId]: userHoleCards };
      }
      return { ok: true, state: publicState, version: newVersion };
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
  } catch (error) {
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_act_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
