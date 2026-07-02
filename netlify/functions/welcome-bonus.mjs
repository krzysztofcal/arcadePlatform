import { claimWelcomeBonus, getWelcomeBonusStatus } from "./_shared/welcome-bonus.mjs";
import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";

function json(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function mapClaimError(error) {
  const safeCodes = new Set([
    "idempotency_conflict",
    "invalid_tx_type",
    "missing_idempotency_key",
    "system_account_missing",
    "system_account_inactive",
    "insufficient_funds",
  ]);
  if (error?.status === 409) return { statusCode: 409, error: "idempotency_conflict" };
  if (error?.status === 400 && safeCodes.has(error?.code)) return { statusCode: 400, error: error.code };
  return { statusCode: error?.status || 500, error: "server_error" };
}

function createWelcomeBonusHandler(deps = {}) {
  const env = deps.env || process.env;
  const getStatus = deps.getWelcomeBonusStatus || getWelcomeBonusStatus;
  const claimBonus = deps.claimWelcomeBonus || claimWelcomeBonus;
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;

  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return json(404, baseHeaders(), { error: "not_found" });
    }

    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return json(403, baseHeaders(), { error: "forbidden_origin" });
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(405, cors, { error: "method_not_allowed" });
    }

    const token = extractBearerToken(event.headers);
    const auth = await verifyJwt(token);
    if (!auth.valid || !auth.userId) {
      klog("welcome_bonus_failed", { userId: null, reason: auth.reason || "unauthorized" });
      return json(401, cors, { error: "unauthorized", reason: auth.reason });
    }

    try {
      if (event.httpMethod === "GET") {
        const status = await getStatus(auth.userId, { env });
        return json(200, cors, {
          eligible: status.eligible,
          alreadyClaimed: status.alreadyClaimed,
          amount: status.amount,
          reason: status.reason,
          transactionId: status.transactionId || null,
        });
      }

      const result = await claimBonus(auth.userId, { env });
      return json(200, cors, {
        claimed: result.claimed,
        eligible: result.eligible,
        alreadyClaimed: result.alreadyClaimed,
        amount: result.amount,
        reason: result.reason,
        transactionId: result.transactionId || null,
        transaction: result.transaction || null,
        account: result.account || null,
      });
    } catch (error) {
      const mapped = mapClaimError(error);
      klog("welcome_bonus_failed", {
        userId: auth.userId,
        reason: mapped.error,
        transactionId: null,
      });
      return json(mapped.statusCode, cors, { error: mapped.error });
    }
  };
}

const handler = createWelcomeBonusHandler();

export {
  createWelcomeBonusHandler,
  handler,
};
