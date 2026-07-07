import { claimBonusCampaign, listBonusCampaignStatuses } from "./_shared/bonus-campaigns.mjs";
import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";

function json(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (_error) {
    const error = new Error("invalid_json");
    error.status = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function parseCampaignCode(value) {
  const code = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(code)) {
    const error = new Error("invalid_campaign_code");
    error.status = 400;
    error.code = "invalid_campaign_code";
    throw error;
  }
  return code;
}

function publicClaimableItem(item) {
  return {
    code: item.code,
    title: item.title,
    description: item.description || "",
    campaignType: item.campaignType,
    claimPolicy: item.claimPolicy,
    amount: item.amount,
    eligible: item.eligible,
    alreadyClaimed: item.alreadyClaimed,
    reason: item.reason,
  };
}

function mapClaimError(error) {
  const safeCodes = new Set([
    "invalid_json",
    "invalid_campaign_code",
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

function createBonusCampaignsHandler(deps = {}) {
  const env = deps.env || process.env;
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const listStatuses = deps.listBonusCampaignStatuses || listBonusCampaignStatuses;
  const claimCampaign = deps.claimBonusCampaign || claimBonusCampaign;

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
      klog("bonus_campaign_failed", { userId: null, reason: auth.reason || "unauthorized" });
      return json(401, cors, { error: "unauthorized", reason: auth.reason });
    }

    try {
      if (event.httpMethod === "GET") {
        const statusList = await listStatuses(auth.userId, { env });
        const items = (Array.isArray(statusList?.items) ? statusList.items : [])
          .filter((item) => item && item.eligible && !item.alreadyClaimed)
          .map(publicClaimableItem);
        return json(200, cors, { items });
      }

      const payload = parseBody(event.body);
      const code = parseCampaignCode(payload.code);
      const result = await claimCampaign(auth.userId, code, { env });
      return json(200, cors, {
        claimed: result.claimed,
        eligible: result.eligible,
        alreadyClaimed: result.alreadyClaimed,
        reason: result.reason,
        code: result.campaign?.code || code,
        title: result.campaign?.title || null,
        amount: result.campaign?.amount || null,
        transactionId: result.transactionId || null,
        transaction: result.transaction || null,
        account: result.account || null,
      });
    } catch (error) {
      const mapped = mapClaimError(error);
      klog("bonus_campaign_failed", {
        userId: auth.userId,
        reason: mapped.error,
        transactionId: null,
      });
      return json(mapped.statusCode, cors, { error: mapped.error });
    }
  };
}

const handler = createBonusCampaignsHandler();

export {
  createBonusCampaignsHandler,
  handler,
};
