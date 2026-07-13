import { extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import {
  allowLeaderboardRead,
  baseHeaders,
  configuredRateLimit,
  errorResponse,
  json,
  leaderboardCors,
  leaderboardEnabled,
} from "./_shared/xp-leaderboard-http.mjs";
import { parseLeaderboardQuery, readLeaderboardMe } from "./_shared/xp-leaderboard-read.mjs";

function createXpLeaderboardMeHandler(deps = {}) {
  const env = deps.env || process.env;
  const enabled = deps.leaderboardEnabled || leaderboardEnabled;
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const allowRead = deps.allowLeaderboardRead || ((event) => allowLeaderboardRead(event, {
    scope: "me",
    limit: configuredRateLimit(env.XP_LEADERBOARD_ME_RATE_LIMIT_IP_PER_MIN),
  }));
  const readMe = deps.readLeaderboardMe || readLeaderboardMe;
  return async function handler(event) {
    const startedAt = Date.now();
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = leaderboardCors(origin);
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "GET") return json(405, cors, { error: "method_not_allowed" });
    if (!enabled(env, event)) return json(404, cors, { error: "not_found" });
    const auth = await verifyJwt(extractBearerToken(event.headers));
    if (!auth.valid || !auth.userId) return json(401, { ...cors, "cache-control": "no-store" }, { error: "unauthorized" });
    if (!await allowRead(event)) {
      return json(429, { ...cors, "cache-control": "no-store", "retry-after": "60" }, { error: "rate_limit_exceeded" });
    }
    let options;
    try {
      options = parseLeaderboardQuery(event.queryStringParameters || {}, { me: true });
      const result = await readMe(options, auth.userId);
      klog("xp_leaderboard_me_read", {
        period: options.period,
        status: 200,
        found: !!result.response.me,
        missingProfiles: result.diagnostics.missingProfiles,
        totalMs: Date.now() - startedAt,
      });
      return json(200, { ...cors, "cache-control": "private, no-store" }, result.response);
    } catch (error) {
      const response = errorResponse(error, cors);
      klog("xp_leaderboard_me_read", {
        period: options?.period || null,
        status: response.statusCode,
        code: error?.code || "leaderboard_unavailable",
        totalMs: Date.now() - startedAt,
      });
      return response;
    }
  };
}

const handler = createXpLeaderboardMeHandler();

export { createXpLeaderboardMeHandler, handler };
