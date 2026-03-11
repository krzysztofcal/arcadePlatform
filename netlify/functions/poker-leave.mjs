import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { executePokerLeave } from "../../shared/poker-domain/leave.mjs";

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };

  const parsed = parseBody(event.body);
  if (!parsed.ok) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_json" }) };
  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_payload" }) };

  const includeState = payload?.includeState === true;
  const tableIdValue = payload?.tableId;
  const tableIdRaw = typeof tableIdValue === "string" ? tableIdValue : "";
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };

  const requestIdValue = payload?.requestId;
  const requestIdTrimmed = typeof requestIdValue === "string" ? requestIdValue.trim() : "";
  const requestIdPresent = requestIdTrimmed !== "";
  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok) {
    klog("poker_request_id_invalid", { fn: "leave", tableId, requestIdType: typeof requestIdValue, requestIdPreview: requestIdTrimmed ? requestIdTrimmed.slice(0, 50) : null, requestIdPresent, reason: "normalize_failed" });
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const parsedRequestId = requestIdParsed.value;
  const normalizedRequestId = typeof parsedRequestId === "string" && parsedRequestId.trim() ? parsedRequestId.trim() : null;

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  const userId = auth.userId || null;
  klog("poker_leave_start", { tableId, tableIdRaw: tableIdRaw || null, userId, hasAuth: !!(auth.valid && auth.userId), requestIdPresent });
  if (!auth.valid || !auth.userId) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };

  try {
    const result = await executePokerLeave({ beginSql, tableId, userId: auth.userId, requestId: normalizedRequestId, nowMs: Date.now(), klog, includeState });
    if (result?.pending) return { statusCode: 202, headers: cors, body: JSON.stringify({ error: "request_pending", requestId: result.requestId || normalizedRequestId }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
  } catch (error) {
    if (error?.status && error?.code) {
      klog("poker_leave_error", { tableId, userId: auth.userId || null, code: error.code, message: error.message || null });
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_leave_error", { tableId, userId: auth?.userId || null, code: error?.code || "server_error", message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
