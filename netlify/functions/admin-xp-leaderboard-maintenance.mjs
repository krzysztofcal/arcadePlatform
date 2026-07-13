import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { buildStageIdentity } from "./admin-stage-identity.mjs";
import {
  parseMaintenanceRequest,
  runLeaderboardMaintenance,
  validateMaintenanceTarget,
} from "./_shared/xp-leaderboard-maintenance.mjs";

function createAdminXpLeaderboardMaintenanceHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const buildIdentity = deps.buildStageIdentity || (() => buildStageIdentity(env));
  const runMaintenance = deps.runLeaderboardMaintenance || runLeaderboardMaintenance;

  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };

    try {
      await requireAdmin(event, env);
      let payload;
      try {
        payload = event.body ? JSON.parse(event.body) : {};
      } catch {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "bad_json" }) };
      }
      const request = parseMaintenanceRequest(payload);
      const target = validateMaintenanceTarget({ identity: buildIdentity(), request });
      const result = await runMaintenance(request, { env });
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          target: {
            databaseTarget: target.databaseTarget,
            environmentContext: target.environmentContext,
            projectRef: target.projectRef,
            applyConfirmation: `apply:${target.databaseTarget}:${target.projectRef}`,
          },
          result,
        }),
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) return adminAuthErrorResponse(error, cors);
      const status = Number(error?.status) || 500;
      const code = status < 500 ? (error?.code || "invalid_request") : "server_error";
      klog("xp_leaderboard_maintenance_failed", { code: error?.code || "server_error", status });
      return { statusCode: status, headers: cors, body: JSON.stringify({ error: code }) };
    }
  };
}

const handler = createAdminXpLeaderboardMaintenanceHandler();

export { createAdminXpLeaderboardMaintenanceHandler, handler };
