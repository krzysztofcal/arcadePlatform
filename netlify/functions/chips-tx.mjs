import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";

const parseBody = (body) => {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
};

const ALLOWED_TX_TYPES = new Set(["BUY_IN", "CASH_OUT"]);

function buildEntries(txType, amount) {
  const value = Number(amount);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  switch (txType) {
    case "BUY_IN":
      return [
        { accountType: "USER", amount: value },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -value },
      ];
    case "CASH_OUT":
      return [
        { accountType: "USER", amount: -value },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: value },
      ];
    default:
      return null;
  }
}

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

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    klog("chips_tx_auth_failed", { reason: auth.reason });
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  const payload = parseBody(event.body);
  const { txType, idempotencyKey, amount, reference = null, description = null, metadata = {} } = payload;
  const safeMetadata = metadata && typeof metadata === "object" ? metadata : {};

  if (!ALLOWED_TX_TYPES.has(txType)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_tx_type" }) };
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing_idempotency_key" }) };
  }

  const entries = buildEntries(txType, amount);
  if (!entries) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_amount" }) };
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
    const combined = `${error.message || ""} ${error.details || ""}`.toLowerCase();
    const isInsufficient = combined.includes("insufficient_funds");
    const status = isInsufficient ? 400 : error.status || 500;
    klog("chips_tx_error", { error: error.message, status, idempotencyKey });
    const body = status === 409
      ? { error: "idempotency_conflict" }
      : status === 400 && error.code
        ? { error: error.code }
        : isInsufficient
          ? { error: "insufficient_funds" }
          : { error: "server_error" };
    return { statusCode: status, headers: cors, body: JSON.stringify(body) };
  }
}
