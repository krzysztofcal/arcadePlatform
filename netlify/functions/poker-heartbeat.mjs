import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./_shared/poker-idempotency.mjs";

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

const touchSeatPresence = async (tx, tableId, userId) => {
  const seatRows = await tx.unsafe(
    "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
    [tableId, userId]
  );
  const seatNo = seatRows?.[0]?.seat_no;
  const isSeated = Number.isInteger(seatNo);
  if (isSeated) {
    // Heartbeat intentionally updates seat presence only; sweep lifecycle uses poker_tables.last_activity_at
    // from real state/action mutations, not passive keep-alive traffic.
    await tx.unsafe(
      "update public.poker_seats set status = 'ACTIVE', last_seen_at = now() where table_id = $1 and user_id = $2;",
      [tableId, userId]
    );
  }
  return { isSeated, seatNo: isSeated ? seatNo : null };
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
  if (!requestIdParsed.ok) {
    const requestIdValue = payload?.requestId;
    const requestIdType = typeof requestIdValue;
    const requestIdTrimmed = typeof requestIdValue === "string" ? requestIdValue.trim() : "";
    const requestIdPreview = requestIdTrimmed ? requestIdTrimmed.slice(0, 50) : null;
    const requestIdPresent = requestIdTrimmed !== "";
    klog("poker_request_id_invalid", {
      fn: "heartbeat",
      tableId,
      requestIdType,
      requestIdPreview,
      requestIdPresent,
      reason: "normalize_failed",
    });
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
      let mutated = false;
      const requestInfo = await ensurePokerRequest(tx, {
        tableId,
        userId: auth.userId,
        requestId,
        kind: "HEARTBEAT",
        pendingStaleSec: REQUEST_PENDING_STALE_SEC,
      });
      if (requestInfo.status === "pending") return { ok: false, pending: true, requestId };
      if (requestInfo.status === "stored") {
        const replayResult = requestInfo.result;
        if (!replayResult?.closed) {
          const replayPresence = await touchSeatPresence(tx, tableId, auth.userId);
          if (replayPresence.isSeated) {
            mutated = true;
          }
        }
        return replayResult;
      }

      try {
        const tableRows = await tx.unsafe("select status from public.poker_tables where id = $1 limit 1;", [tableId]);
        const tableStatus = tableRows?.[0]?.status;
        if (!tableStatus) {
          return { error: "table_not_found", statusCode: 404 };
        }

        const presence = await touchSeatPresence(tx, tableId, auth.userId);
        const isSeated = presence.isSeated;
        const seatNo = presence.seatNo;
        if (isSeated) {
          mutated = true;
        }

        if (tableStatus === "CLOSED") {
          const resultPayload = { ok: true, seated: isSeated, seatNo: seatNo };
          if (isSeated) {
            resultPayload.closed = true;
          }
          await storePokerRequestResult(tx, {
            tableId,
            userId: auth.userId,
            requestId,
            kind: "HEARTBEAT",
            result: resultPayload,
          });
          return resultPayload;
        }

        const resultPayload = { ok: true, seated: isSeated, seatNo: seatNo };
        await storePokerRequestResult(tx, {
          tableId,
          userId: auth.userId,
          requestId,
          kind: "HEARTBEAT",
          result: resultPayload,
        });
        return resultPayload;
      } catch (error) {
        if (requestId && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: auth.userId, requestId, kind: "HEARTBEAT" });
        } else if (requestId && mutated) {
          klog("poker_heartbeat_request_retained", { tableId, userId: auth.userId, requestId });
        }
        throw error;
      }
    });

    if (result?.pending) {
      return {
        statusCode: 202,
        headers: cors,
        body: JSON.stringify({ error: "request_pending", requestId: result.requestId || requestId }),
      };
    }

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
