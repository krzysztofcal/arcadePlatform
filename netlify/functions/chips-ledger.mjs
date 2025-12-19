import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { listUserLedger } from "./_shared/chips-ledger.mjs";

const asInt = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const CHIPS_ENABLED = process.env.CHIPS_ENABLED === "1";

export async function handler(event) {
  if (!CHIPS_ENABLED) {
    return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
  }

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
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    klog("chips_ledger_auth_failed", { reason: auth.reason });
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  const afterSeq = event.queryStringParameters?.after ? asInt(event.queryStringParameters.after, null) : null;
  const limitRaw = event.queryStringParameters?.limit ? asInt(event.queryStringParameters.limit, 50) : 50;
  const limit = Number.isInteger(limitRaw) ? limitRaw : 50;

  try {
    const ledger = await listUserLedger(auth.userId, { afterSeq, limit });
    klog("chips_ledger_ok", { userId: auth.userId, count: ledger.entries.length });
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        userId: auth.userId,
        entries: ledger.entries,
        sequenceOk: ledger.sequenceOk,
        nextExpectedSeq: ledger.nextExpectedSeq,
      }),
    };
  } catch (error) {
    klog("chips_ledger_error", { error: error.message });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
