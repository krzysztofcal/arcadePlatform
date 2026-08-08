import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { readPokerProgression } from "../../shared/poker-domain/poker-progression.mjs";

const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });

export async function handler(event) {
  if (process.env.CHIPS_ENABLED !== "1") {
    return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
  }
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: mergeHeaders(cors), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: mergeHeaders(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: mergeHeaders(cors), body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const progression = await beginSql((tx) => readPokerProgression(tx, { userId: auth.userId }));
    return {
      statusCode: 200,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ userId: auth.userId, ...progression })
    };
  } catch (error) {
    const code = error?.code === "poker_buy_in_tiers_config_invalid"
      ? "poker_buy_in_config_invalid"
      : "server_error";
    klog("poker_progression_error", { code });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: code }) };
  }
}
