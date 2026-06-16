import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function badRequest(code, message) {
  const error = new Error(message || code);
  error.status = 400;
  error.code = code;
  return error;
}

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (_error) {
    throw badRequest("invalid_json", "Body must be valid JSON");
  }
}

function parseAmount(value) {
  const normalized = typeof value === "string" ? value.trim() : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed === 0) {
    throw badRequest("invalid_amount", "Amount must be a non-zero integer");
  }
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    throw badRequest("invalid_amount", "Amount is too large");
  }
  return parsed;
}

function parseUserId(value) {
  const userId = typeof value === "string" ? value.trim() : "";
  if (!UUID_RE.test(userId)) {
    throw badRequest("invalid_user_id", "userId must be a UUID");
  }
  return userId;
}

function parseReason(value) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) {
    throw badRequest("missing_reason", "Reason is required");
  }
  if (reason.length > 240) {
    throw badRequest("reason_too_long", "Reason is too long");
  }
  return reason;
}

function parseIdempotencyKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) {
    throw badRequest("missing_idempotency_key", "Idempotency key is required");
  }
  if (key.length > 120) {
    throw badRequest("invalid_idempotency_key", "Idempotency key is too long");
  }
  return key;
}

function toScopedIdempotencyKey(adminUserId, targetUserId, key) {
  return `admin-adjust:${adminUserId}:${targetUserId}:${key}`;
}

function buildEntries(targetUserId, amount, metadata) {
  return [
    {
      accountType: "USER",
      userId: targetUserId,
      amount,
      metadata: { ...metadata, entry_role: "target_user" },
    },
    {
      accountType: "SYSTEM",
      systemKey: "TREASURY",
      amount: -amount,
      metadata: { ...metadata, entry_role: "treasury_offset" },
    },
  ];
}

function buildMetadata(adminUserId, targetUserId, amount, reason, clientKey, scopedKey) {
  return {
    source: "admin_page",
    admin_user_id: adminUserId,
    target_user_id: targetUserId,
    amount,
    reason,
    client_idempotency_key: clientKey,
    scoped_idempotency_key: scopedKey,
  };
}

function mapAdjustError(error) {
  const combined = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  const isInsufficient = /(^|\W)insufficient_funds(\W|$)/.test(combined);
  const status = error?.status || (isInsufficient ? 400 : 500);
  const safeCodes = new Set([
    "invalid_json",
    "invalid_amount",
    "invalid_user_id",
    "missing_reason",
    "reason_too_long",
    "missing_idempotency_key",
    "invalid_idempotency_key",
    "system_account_missing",
    "system_account_inactive",
  ]);
  if (status === 409) {
    return { statusCode: 409, body: { error: "idempotency_conflict" } };
  }
  if (isInsufficient) {
    return { statusCode: 400, body: { error: "insufficient_funds" } };
  }
  if (status === 400 && safeCodes.has(error?.code)) {
    return { statusCode: 400, body: { error: error.code } };
  }
  return { statusCode: status, body: { error: "server_error" } };
}

function createAdminLedgerAdjustHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const writeTransaction = deps.postTransaction || postTransaction;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    }

    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
    }

    let adminUserId = null;
    let targetUserId = null;
    let amount = null;
    let scopedKey = null;
    try {
      const admin = await requireAdmin(event, env);
      adminUserId = admin.userId;
      const payload = parseBody(event.body);
      targetUserId = parseUserId(payload.userId);
      amount = parseAmount(payload.amount);
      const reason = parseReason(payload.reason);
      const clientKey = parseIdempotencyKey(payload.idempotencyKey);
      scopedKey = toScopedIdempotencyKey(adminUserId, targetUserId, clientKey);
      const metadata = buildMetadata(adminUserId, targetUserId, amount, reason, clientKey, scopedKey);
      const entries = buildEntries(targetUserId, amount, metadata);
      const result = await writeTransaction({
        userId: targetUserId,
        txType: "ADMIN_ADJUST",
        idempotencyKey: scopedKey,
        reference: `admin_page:${adminUserId}:${targetUserId}`,
        description: reason,
        metadata,
        entries,
        createdBy: adminUserId,
      });
      klog("admin_ledger_adjust_ok", { adminUserId, targetUserId, amount, idempotencyKey: scopedKey });
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          adminUserId,
          targetUserId,
          amount,
          reason,
          idempotencyKey: scopedKey,
          transaction: result.transaction,
          entries: result.entries,
          account: result.account,
        }),
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      const mapped = mapAdjustError(error);
      klog("admin_ledger_adjust_error", {
        adminUserId,
        targetUserId,
        amount,
        idempotencyKey: scopedKey,
        message: error?.message || "error",
        status: mapped.statusCode,
      });
      return { statusCode: mapped.statusCode, headers: cors, body: JSON.stringify(mapped.body) };
    }
  };
}

const handler = createAdminLedgerAdjustHandler();

export {
  buildEntries,
  buildMetadata,
  createAdminLedgerAdjustHandler,
  handler,
};
