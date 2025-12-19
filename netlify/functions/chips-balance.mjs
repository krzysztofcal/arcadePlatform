import { corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { getUserBalance } from "./_shared/chips-ledger.mjs";

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return { statusCode: 403, body: JSON.stringify({ error: "forbidden_origin" }) };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    klog("chips_balance_auth_failed", { reason: auth.reason });
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const balance = await getUserBalance(auth.userId);
    klog("chips_balance_ok", { userId: auth.userId, balance: balance.balance });
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        userId: auth.userId,
        accountId: balance.accountId,
        balance: balance.balance,
        nextEntrySeq: balance.nextEntrySeq,
        status: balance.status,
      }),
    };
  } catch (error) {
    klog("chips_balance_error", { error: error.message });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
