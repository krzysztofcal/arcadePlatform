import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { initHand, normalizeSeatRows, normalizeState, toPublicState } from "./_shared/poker-engine.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";

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

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const normalizeSeatNo = (value) => {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
};

const normalizeVersion = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const isRequestIdUniqueViolation = (error) => {
  if (!error) return false;
  const constraint = (error?.constraint || "").toLowerCase();
  if (error?.code === "23505" && constraint === "poker_actions_request_id_unique") return true;
  const combined = `${error?.message || ""} ${error?.detail || ""} ${error?.details || ""}`.toLowerCase();
  return error?.code === "23505" && combined.includes("poker_actions_request_id_unique");
};

const buildStartHandPayload = async (tx, tableId, userId, row) => {
  const normalized = normalizeState(row?.state);
  const publicState = toPublicState(normalized, userId);
  const handId = publicState.handId || normalized.handId;
  if (!handId || typeof handId !== "string") {
    throw makeError(409, "state_invalid");
  }
  // SECURITY NOTE: hole cards are server-only (service role). Clients must never access this table directly.
  const holeRows = await tx.unsafe(
    "select cards from public.poker_hole_cards where table_id = $1 and hand_id = $2 and user_id = $3 limit 1;",
    [tableId, handId, userId]
  );
  const holeCards = holeRows?.[0]?.cards || null;
  if (holeCards) {
    publicState.hole = { [userId]: holeCards };
  }
  return {
    tableId,
    version: normalizeVersion(row?.version),
    handId,
    buttonSeatNo: normalizeSeatNo(publicState.dealerSeat ?? normalized.buttonSeatNo),
    nextToActSeatNo: normalizeSeatNo(publicState.actorSeat ?? normalized.nextToActSeatNo),
    publicState,
  };
};

const fetchLatestStartHandPayload = async (tableId, userId) =>
  beginSql(async (tx) => {
    const latestRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
    const latest = latestRows?.[0] || null;
    if (!latest) throw makeError(409, "state_invalid");
    const payload = await buildStartHandPayload(tx, tableId, userId, latest);
    if (payload.version == null) throw makeError(409, "state_invalid");
    return payload;
  });

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

  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok || !requestIdParsed.value) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      const tableRows = await tx.unsafe("select id, status, stakes from public.poker_tables where id = $1 limit 1;", [
        tableId,
      ]);
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
      const buildPayload = async (row) => buildStartHandPayload(tx, tableId, auth.userId, row);

      const authSeatRows = await tx.unsafe(
        "select user_id from public.poker_seats where table_id = $1 and user_id = $2 and status = 'ACTIVE' limit 1;",
        [tableId, auth.userId]
      );
      if (!authSeatRows?.[0]) {
        throw makeError(403, "not_allowed");
      }

      const markerRows = await tx.unsafe(
        "select version from public.poker_actions where table_id = $1 and user_id = $2 and request_id = $3 limit 1;",
        [tableId, auth.userId, requestIdParsed.value]
      );
      const existingVersion = markerRows?.[0]?.version ?? null;
      if (existingVersion != null) {
        const latestRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [
          tableId,
        ]);
        const latest = latestRows?.[0] || stateRow;
        return await buildPayload(latest);
      }

      // Idempotency does not bypass authorization.
      const sameRequest =
        currentState.lastStartHandRequestId === requestIdParsed.value && currentState.lastStartHandUserId === auth.userId;
      if (sameRequest) {
        return await buildPayload(stateRow);
      }

      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, stack from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
        [tableId]
      );
      const derivedSeats = normalizeSeatRows(seatRows);
      if (derivedSeats.length < 2) {
        throw makeError(409, "not_enough_players");
      }

      if (currentState.phase && currentState.phase !== "WAITING" && currentState.phase !== "INIT" && currentState.phase !== "SETTLED") {
        throw makeError(409, "already_in_hand");
      }

      const currentStacks = parseStacks(currentState.stacks);
      const nextStacks = derivedSeats.reduce((acc, seat) => {
        const stackValue = Number.isFinite(seat.stack) ? seat.stack : currentStacks?.[seat.userId] || 0;
        acc[seat.userId] = stackValue;
        return acc;
      }, {});

      const initResult = initHand({
        tableId,
        seats: derivedSeats,
        stacks: nextStacks,
        stakes: table.stakes || {},
        prevState: currentState,
      });
      if (!initResult.ok) {
        throw makeError(409, initResult.error || "cannot_start");
      }

      const updatedState = {
        ...initResult.state,
        lastStartHandRequestId: requestIdParsed.value || null,
        lastStartHandUserId: auth.userId,
        startedAt: new Date().toISOString(),
      };

      if (initResult.holeCards) {
        const inserts = Object.entries(initResult.holeCards);
        for (const [userId, cards] of inserts) {
          // Hole cards are server-only, relying on service-role access.
          // SECURITY NOTE: inserts are server-only; clients must never access poker_hole_cards.
          await tx.unsafe(
            "insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ($1, $2, $3, $4::jsonb) on conflict do nothing;",
            [tableId, updatedState.handId, userId, JSON.stringify(cards)]
          );
        }
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
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount, request_id) values ($1, $2, $3, $4, $5, $6);",
        [tableId, newVersion, auth.userId, "START_HAND", null, requestIdParsed.value]
      );

      const publicState = toPublicState(updatedState, auth.userId);
      if (initResult.holeCards && initResult.holeCards[auth.userId]) {
        publicState.hole = { [auth.userId]: initResult.holeCards[auth.userId] };
      }
      return { tableId, version: newVersion, handId: updatedState.handId, buttonSeatNo: updatedState.dealerSeat, nextToActSeatNo: updatedState.actorSeat, publicState };
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        tableId: result.tableId,
        version: result.version,
        handId: result.handId,
        buttonSeatNo: result.buttonSeatNo,
        nextToActSeatNo: result.nextToActSeatNo,
        state: result.publicState,
      }),
    };
  } catch (error) {
    if (isRequestIdUniqueViolation(error)) {
      try {
        const latest = await fetchLatestStartHandPayload(tableId, auth.userId);
        return {
          statusCode: 200,
          headers: cors,
          body: JSON.stringify({
            ok: true,
            tableId: latest.tableId,
            version: latest.version,
            handId: latest.handId,
            buttonSeatNo: latest.buttonSeatNo,
            nextToActSeatNo: latest.nextToActSeatNo,
            state: latest.publicState,
          }),
        };
      } catch (fetchError) {
        klog("poker_start_hand_unique_violation_error", { message: fetchError?.message || "unknown_error" });
      }
    }
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_start_hand_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
