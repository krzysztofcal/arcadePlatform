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

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

const ALLOWED_TX_TYPES = new Set(["BUY_IN", "CASH_OUT"]);

const CHIPS_ENABLED = process.env.CHIPS_ENABLED === "1";

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
  const { txType, idempotencyKey, amount, entries, reference = null, description = null, metadata = {} } = payload;
  const safeMetadata = isPlainObject(metadata) ? metadata : {};

  if (!ALLOWED_TX_TYPES.has(txType)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_tx_type" }) };
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing_idempotency_key" }) };
  }

  let entriesToPost;
  if (entries != null) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing_entries" }) };
    }
    for (const entry of entries) {
      const accountType = entry?.accountType;
      if (accountType !== "USER" && accountType !== "SYSTEM") {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "unsupported_account_type" }) };
      }
      const entryAmount = entry?.amount;
      if (!Number.isInteger(entryAmount) || entryAmount === 0) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_entry_amount" }) };
      }
      if (accountType === "SYSTEM" && !entry?.systemKey) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing_system_key" }) };
      }
    }
    entriesToPost = entries;
  } else {
    entriesToPost = buildEntries(txType, amount);
    if (!entriesToPost) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_amount" }) };
    }
  }

  try {
    const result = await postTransaction({
      userId: auth.userId,
      txType,
      idempotencyKey,
      reference,
      description,
      metadata: safeMetadata,
      entries: entriesToPost,
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
    const isInsufficient = /(^|\W)insufficient_funds(\W|$)/.test(combined);
    const isP0001 = error.code === "P0001";
    const safeP0001 = /system_account_missing|system_account_inactive/.test(combined);
    const status = error.status || (isInsufficient || (isP0001 && safeP0001) ? 400 : 500);
    klog("chips_tx_error", { error: error.message, status, idempotencyKey });
    const safeCodes = new Set([
      "invalid_tx_type",
      "missing_idempotency_key",
      "invalid_amount",
      "system_account_missing",
      "system_account_inactive",
      "missing_entries",
      "invalid_entry_amount",
      "unsupported_account_type",
      "missing_system_key",
      "missing_user_entry",
    ]);
    const derivedError = (() => {
      if (isInsufficient) return "insufficient_funds";
      if (isP0001) {
        if (combined.includes("system_account_missing")) return "system_account_missing";
        if (combined.includes("system_account_inactive")) return "system_account_inactive";
      }
      if (status === 400 && error.code && safeCodes.has(error.code)) return error.code;
      return null;
    })();
    const body = status === 409
      ? { error: "idempotency_conflict" }
      : derivedError
        ? { error: derivedError }
        : { error: "server_error" };
    return { statusCode: status, headers: cors, body: JSON.stringify(body) };
  }
}
