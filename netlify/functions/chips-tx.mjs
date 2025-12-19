import { corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { VALID_TX_TYPES, postTransaction } from "./_shared/chips-ledger.mjs";

const parseBody = (body) => {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return { statusCode: 403, body: JSON.stringify({ error: "forbidden_origin" }) };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    klog("chips_tx_auth_failed", { reason: auth.reason });
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  const payload = parseBody(event.body);
  const { txType, idempotencyKey, reference = null, description = null, metadata = {}, entries = [] } = payload;
  const safeMetadata = metadata && typeof metadata === "object" ? metadata : {};

  if (!VALID_TX_TYPES.has(txType)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_tx_type" }) };
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing_idempotency_key" }) };
  }

  try {
    const result = await postTransaction({
      userId: auth.userId,
      txType,
      idempotencyKey,
      reference,
      description,
      metadata: safeMetadata,
      entries,
      createdBy: auth.userId,
    });
    klog("chips_tx_ok", { userId: auth.userId, txType, idempotencyKey });
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        userId: auth.userId,
        transaction: result.transaction,
        entries: result.entries,
        account: result.account,
      }),
    };
  } catch (error) {
    const status = error.status || 500;
    klog("chips_tx_error", { error: error.message, status, idempotencyKey });
    const body = status === 409
      ? { error: "idempotency_conflict" }
      : { error: "server_error" };
    return { statusCode: status, headers: cors, body: JSON.stringify(body) };
  }
}
