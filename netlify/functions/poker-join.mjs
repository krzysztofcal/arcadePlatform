import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";

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

const parseSeatNo = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
};

const parseBuyIn = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return null;
  return num;
};

const parseRequestId = (value) => {
  if (value == null) return { ok: true, value: null };
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

const parseSeats = (value) => (Array.isArray(value) ? value : []);

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

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
  if (!tableId) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const seatNo = parseSeatNo(payload?.seatNo);
  if (seatNo == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_seat_no" }) };
  }

  const buyIn = parseBuyIn(payload?.buyIn);
  if (buyIn == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_buy_in" }) };
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

  const idempotencyKey = requestIdParsed.value
    ? `poker:join:${requestIdParsed.value}`
    : `poker:join:${tableId}:${auth.userId}:${seatNo}:${buyIn}`;

  try {
    await beginSql(async (tx) => {
      const tableRows = await tx.unsafe(
        "select id, status from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const table = tableRows?.[0] || null;
      if (!table) {
        throw makeError(404, "table_not_found");
      }
      if (table.status !== "OPEN") {
        throw makeError(409, "table_not_open");
      }

      try {
        await tx.unsafe(
          "insert into public.poker_seats (table_id, user_id, seat_no, status) values ($1, $2, $3, 'SEATED');",
          [tableId, auth.userId, seatNo]
        );
      } catch (error) {
        const isUnique = error?.code === "23505";
        const details = `${error?.constraint || ""} ${error?.detail || ""}`.toLowerCase();
        if (isUnique && details.includes("seat_no")) {
          throw makeError(409, "seat_taken");
        }
        if (isUnique && details.includes("user_id")) {
          throw makeError(409, "already_seated");
        }
        throw error;
      }

      const escrowSystemKey = `POKER_TABLE:${tableId}`;
      const escrowRows = await tx.unsafe(
        "select id from public.chips_accounts where system_key = $1 limit 1;",
        [escrowSystemKey]
      );
      const escrowId = escrowRows?.[0]?.id || null;
      if (!escrowId) {
        throw new Error("poker_escrow_missing");
      }

      await postTransaction({
        userId: auth.userId,
        txType: "TABLE_BUY_IN",
        idempotencyKey,
        entries: [
          { accountType: "USER", amount: -buyIn },
          { accountType: "SYSTEM", systemKey: escrowSystemKey, amount: buyIn },
        ],
        createdBy: auth.userId,
      });

      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 limit 1;",
        [tableId]
      );
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) {
        throw new Error("poker_state_missing");
      }

      const currentState = normalizeState(stateRow.state);
      const seats = parseSeats(currentState.seats).filter((seat) => seat?.userId !== auth.userId);
      seats.push({ userId: auth.userId, seatNo });
      const stacks = { ...parseStacks(currentState.stacks), [auth.userId]: buyIn };

      const updatedState = {
        ...currentState,
        tableId: currentState.tableId || tableId,
        seats,
        stacks,
        pot: Number.isFinite(currentState.pot) ? currentState.pot : 0,
        phase: currentState.phase || "INIT",
      };

      await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1;",
        [tableId, JSON.stringify(updatedState)]
      );
    });
  } catch (error) {
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_join_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ ok: true, tableId, seatNo }),
  };
}
