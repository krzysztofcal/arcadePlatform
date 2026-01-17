import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
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

const parseRequestId = (value) => {
  if (value == null || value === "") return { ok: true, value: null };
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

const parseStackValue = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return null;
  return num;
};

const parseResultJson = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
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
  const requestId = requestIdParsed.value;

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      if (requestId) {
        const requestRows = await tx.unsafe(
          "select result_json from public.poker_requests where request_id = $1 limit 1;",
          [requestId]
        );
        if (requestRows?.[0]) {
          const stored = parseResultJson(requestRows[0].result_json);
          if (stored) return stored;
        }

        const insertedRows = await tx.unsafe(
          `insert into public.poker_requests (table_id, user_id, request_id, kind)
           values ($1, $2, $3, 'LEAVE')
           on conflict (request_id) do nothing
           returning request_id;`,
          [tableId, auth.userId, requestId]
        );
        const hasRequest = !!insertedRows?.[0]?.request_id;
        if (!hasRequest) {
          const existingRows = await tx.unsafe(
            "select result_json from public.poker_requests where request_id = $1 limit 1;",
            [requestId]
          );
          const stored = parseResultJson(existingRows?.[0]?.result_json);
          if (stored) return stored;
          return { ok: false, pending: true, requestId };
        }
      }

      try {
        const tableRows = await tx.unsafe("select id, status from public.poker_tables where id = $1 limit 1;", [tableId]);
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }

        const seatRows = await tx.unsafe(
          "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
          [tableId, auth.userId]
        );
        const seatNo = seatRows?.[0]?.seat_no;
        if (!Number.isInteger(seatNo)) {
          throw makeError(409, "not_seated");
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
        const stacks = parseStacks(currentState.stacks);
        const stackValue = parseStackValue(stacks?.[auth.userId]);
        if (!stackValue) {
          throw makeError(409, "nothing_to_cash_out");
        }

        if (stackValue) {
          const escrowSystemKey = `POKER_TABLE:${tableId}`;
          const idempotencyKey = requestId
            ? `poker:leave:${requestId}`
            : `poker:leave:${tableId}:${auth.userId}:${stackValue}`;

          await postTransaction({
            userId: auth.userId,
            txType: "TABLE_CASH_OUT",
            idempotencyKey,
            entries: [
              { accountType: "ESCROW", systemKey: escrowSystemKey, amount: -stackValue },
              { accountType: "USER", amount: stackValue },
            ],
            createdBy: auth.userId,
            tx,
          });
        }

        const seats = parseSeats(currentState.seats).filter((seatItem) => seatItem?.userId !== auth.userId);
        const updatedStacks = { ...stacks };
        delete updatedStacks[auth.userId];

        const updatedState = {
          ...currentState,
          tableId: currentState.tableId || tableId,
          seats,
          stacks: updatedStacks,
          pot: Number.isFinite(currentState.pot) ? currentState.pot : 0,
          phase: currentState.phase || "INIT",
        };

        await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [tableId, auth.userId]);
        await tx.unsafe(
          "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1;",
          [tableId, JSON.stringify(updatedState)]
        );

        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );

        const resultPayload = { ok: true, tableId, cashedOut: stackValue || 0, seatNo: seatNo ?? null };
        if (requestId) {
          await tx.unsafe(
            "update public.poker_requests set result_json = $2::jsonb where request_id = $1;",
            [requestId, JSON.stringify(resultPayload)]
          );
        }
        klog("poker_leave_ok", { tableId, userId: auth.userId, seatNo: seatNo ?? null });
        return resultPayload;
      } catch (error) {
        if (requestId) {
          await tx.unsafe("delete from public.poker_requests where request_id = $1;", [requestId]);
        }
        throw error;
      }
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(result),
    };
  } catch (error) {
    if (error?.status && error?.code) {
      klog("poker_leave_fail", { tableId, userId: auth.userId, reason: error.code });
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_leave_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
