import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const REQUEST_PENDING_STALE_SEC = 30;

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

const parseRequestId = (value) => {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, value: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, value: null };
  return { ok: true, value: trimmed };
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

const isRequestPendingStale = (row) => {
  if (!row?.created_at) return false;
  const createdAtMs = Date.parse(row.created_at);
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs > REQUEST_PENDING_STALE_SEC * 1000;
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
          "select result_json, created_at from public.poker_requests where table_id = $1 and request_id = $2 limit 1;",
          [tableId, requestId]
        );
        const existingRow = requestRows?.[0];
        if (existingRow) {
          const stored = parseResultJson(existingRow.result_json);
          if (stored) return stored;
          if (isRequestPendingStale(existingRow)) {
            await tx.unsafe("delete from public.poker_requests where table_id = $1 and request_id = $2;", [
              tableId,
              requestId,
            ]);
          } else {
            return { ok: false, pending: true, requestId };
          }
        }
      }

      if (requestId) {
        const insertRequest = () =>
          tx.unsafe(
            `insert into public.poker_requests (table_id, user_id, request_id, kind)
           values ($1, $2, $3, 'HEARTBEAT')
           on conflict (table_id, request_id) do nothing
           returning request_id;`,
            [tableId, auth.userId, requestId]
          );
        let insertedRows = await insertRequest();
        const hasRequest = !!insertedRows?.[0]?.request_id;
        if (!hasRequest) {
          const existingRows = await tx.unsafe(
            "select result_json, created_at from public.poker_requests where table_id = $1 and request_id = $2 limit 1;",
            [tableId, requestId]
          );
          const existingConflict = existingRows?.[0];
          const stored = parseResultJson(existingConflict?.result_json);
          if (stored) return stored;
          if (existingConflict && isRequestPendingStale(existingConflict)) {
            await tx.unsafe("delete from public.poker_requests where table_id = $1 and request_id = $2;", [
              tableId,
              requestId,
            ]);
            insertedRows = await insertRequest();
            if (!insertedRows?.[0]?.request_id) {
              return { ok: false, pending: true, requestId };
            }
          } else {
            return { ok: false, pending: true, requestId };
          }
        }
      }

      const tableRows = await tx.unsafe("select status from public.poker_tables where id = $1 limit 1;", [tableId]);
      const tableStatus = tableRows?.[0]?.status;
      if (!tableStatus) {
        return { error: "table_not_found", statusCode: 404 };
      }

      const seatRows = await tx.unsafe(
        "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
        [tableId, auth.userId]
      );
      const seatNo = seatRows?.[0]?.seat_no;
      const isSeated = Number.isInteger(seatNo);

      if (tableStatus === "CLOSED") {
        const resultPayload = { ok: true, seated: isSeated, seatNo: isSeated ? seatNo : null };
        if (isSeated) {
          resultPayload.closed = true;
        }
        if (requestId) {
          await tx.unsafe(
            "update public.poker_requests set result_json = $3::jsonb where table_id = $1 and request_id = $2;",
            [tableId, requestId, JSON.stringify(resultPayload)]
          );
        }
        return resultPayload;
      }

      if (isSeated) {
        await tx.unsafe(
          "update public.poker_seats set status = 'ACTIVE', last_seen_at = now() where table_id = $1 and user_id = $2;",
          [tableId, auth.userId]
        );
        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );
      }

      const resultPayload = { ok: true, seated: isSeated, seatNo: isSeated ? seatNo : null };
      if (requestId) {
        await tx.unsafe(
          "update public.poker_requests set result_json = $3::jsonb where table_id = $1 and request_id = $2;",
          [tableId, requestId, JSON.stringify(resultPayload)]
        );
      }
      return resultPayload;
    });

    if (result?.error) {
      return {
        statusCode: result.statusCode || 400,
        headers: cors,
        body: JSON.stringify({ error: result.error }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(result),
    };
  } catch (error) {
    klog("poker_heartbeat_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
