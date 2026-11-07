import crypto from "node:crypto";
import { atomicRateLimitIncr, xpStoreUnavailableResponse } from "./_shared/store-upstash.mjs";
import { baseHeaders, corsHeaders, extractBearerToken, verifySupabaseJwt, klog } from "./_shared/supabase-admin.mjs";
import { blockUser, listBlocks, ugcSafetyEnabled, unblockUser } from "./_shared/ugc-safety.mjs";

// #1140 UGC phase B: the caller's own blocks. GET lists them, POST {targetHandle | targetUserId} blocks,
// DELETE ?userId=<uuid> unblocks. A block only filters the caller's view; it changes no game or chips state.
// Block and unblock share UGC_BLOCK_LIMIT_PER_HOUR changes per user and hour (default 60), failing closed.
const LIMIT_PER_HOUR = Math.max(1, Number(process.env.UGC_BLOCK_LIMIT_PER_HOUR || 60));

function json(statusCode, headers, body) {
  return { statusCode, headers: { ...headers, "cache-control": "no-store" }, body: JSON.stringify(body) };
}

async function allowChange(userId) {
  const hash = crypto.createHash("sha256").update(userId).digest("hex");
  const { count } = await atomicRateLimitIncr(`kcswh:ugc:block:${hash}:${Math.floor(Date.now() / 3600000)}`, 3600);
  return count <= LIMIT_PER_HOUR;
}

function createUserBlocksHandler(deps = {}) {
  const env = deps.env || process.env;
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const list = deps.listBlocks || listBlocks;
  const block = deps.blockUser || blockUser;
  const unblock = deps.unblockUser || unblockUser;
  const allow = deps.allowChange || allowChange;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin, { methods: "GET, POST, DELETE, OPTIONS" });
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (!["GET", "POST", "DELETE"].includes(event.httpMethod)) return json(405, cors, { error: "method_not_allowed" });
    try {
      const token = extractBearerToken(event.headers);
      if (!token) return json(401, cors, { error: "unauthorized" });
      const auth = await verifyJwt(token);
      if (!auth.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });
      if (!ugcSafetyEnabled(env)) return json(404, cors, { error: "not_found" });
      if (event.httpMethod === "GET") return json(200, cors, { blocks: await list(auth.userId) });
      let body = null;
      if (event.httpMethod === "POST") {
        try {
          body = JSON.parse(event.body || "null");
        } catch {
          return json(400, cors, { error: "invalid_json" });
        }
      }
      const unavailable = deps.allowChange ? null : xpStoreUnavailableResponse(cors);
      if (unavailable) return unavailable;
      let allowed;
      try {
        allowed = await allow(auth.userId);
      } catch (error) {
        klog("ugc_block_rate_limit_failed", { message: error?.message || "error" });
        return json(503, cors, { error: "rate_limit_unavailable" });
      }
      if (!allowed) return json(429, cors, { error: "rate_limit_exceeded" });
      if (event.httpMethod === "POST") {
        const result = await block(auth.userId, body);
        return json(result.status === "blocked" ? 201 : 200, cors, result);
      }
      return json(200, cors, await unblock(auth.userId, event.queryStringParameters?.userId));
    } catch (error) {
      if (error?.code === "account_not_active") return json(403, cors, { error: "account_not_active" });
      if (error?.status && error.status < 500) return json(error.status, cors, { error: error.code });
      klog("ugc_block_failed", { code: error?.code || "block_unavailable" });
      return json(500, cors, { error: "server_error" });
    }
  };
}

const handler = createUserBlocksHandler();

export { createUserBlocksHandler, handler };
