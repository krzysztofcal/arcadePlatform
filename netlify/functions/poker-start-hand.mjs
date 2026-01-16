import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";

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

const isValidUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeSeatNo = (value) => {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
};

const normalizeVersion = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
      const authSeatRows = await tx.unsafe(
        "select user_id from public.poker_seats where table_id = $1 and user_id = $2 and status = 'SEATED' limit 1;",
        [tableId, auth.userId]
      );
      if (!authSeatRows?.[0]) {
        throw makeError(403, "not_allowed");
      }

      // Idempotency does not bypass authorization.
      const sameRequest =
        currentState.lastStartHandRequestId === requestIdParsed.value && currentState.lastStartHandUserId === auth.userId;
      if (sameRequest) {
        if (typeof currentState.handId === "string" && currentState.handId.trim()) {
          return {
            tableId,
            version: normalizeVersion(stateRow.version),
            handId: currentState.handId,
            buttonSeatNo: normalizeSeatNo(currentState.buttonSeatNo),
            nextToActSeatNo: normalizeSeatNo(currentState.nextToActSeatNo),
          };
        }
        throw makeError(409, "state_invalid");
      }

      const seatRows = await tx.unsafe(
        "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'SEATED' order by seat_no asc;",
        [tableId]
      );
      const seats = Array.isArray(seatRows) ? seatRows : [];
      const validSeats = seats.filter((seat) => Number.isInteger(seat?.seat_no));
      if (validSeats.length < 2) {
        throw makeError(409, "not_enough_players");
      }

      if (currentState.phase && currentState.phase !== "INIT" && currentState.phase !== "HAND_DONE") {
        throw makeError(409, "already_in_hand");
      }

      const seatNos = validSeats.map((seat) => seat.seat_no);
      const prevButton = normalizeSeatNo(currentState.buttonSeatNo);
      const prevIndex = prevButton != null ? seatNos.indexOf(prevButton) : -1;
      const buttonSeatNo = prevIndex >= 0 ? seatNos[(prevIndex + 1) % seatNos.length] : seatNos[0];
      const buttonIndex = seatNos.indexOf(buttonSeatNo);
      const nextToActSeatNo = seatNos[(buttonIndex + 1) % seatNos.length];

      const handId = `hand_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const derivedSeats = validSeats.map((seat) => ({ userId: seat.user_id, seatNo: seat.seat_no }));

      const updatedState = {
        ...currentState,
        tableId: currentState.tableId || tableId,
        handId,
        phase: "HAND_ACTIVE",
        pot: 0,
        seats: derivedSeats,
        stacks: parseStacks(currentState.stacks),
        buttonSeatNo,
        nextToActSeatNo,
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

      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount) values ($1, $2, $3, $4, $5);",
        [tableId, newVersion, auth.userId, "START_HAND", null]
      );

      return { tableId, version: newVersion, handId, buttonSeatNo, nextToActSeatNo };
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
