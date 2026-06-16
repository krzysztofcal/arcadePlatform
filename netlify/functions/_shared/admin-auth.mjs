import { extractBearerToken, klog, verifySupabaseJwt } from "./supabase-admin.mjs";

function parseAdminUserIds(env = process.env) {
  const raw = typeof env?.ADMIN_USER_IDS === "string" ? env.ADMIN_USER_IDS : "";
  const values = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function isAdminUser(userId, env = process.env) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) return false;
  return parseAdminUserIds(env).includes(normalizedUserId);
}

async function requireAdminUser(event, env = process.env) {
  const token = extractBearerToken(event?.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    klog("admin_auth_denied", { reason: auth.reason || "unauthorized" });
    const error = new Error("unauthorized");
    error.status = 401;
    error.code = "unauthorized";
    error.reason = auth.reason || "unauthorized";
    throw error;
  }
  if (!isAdminUser(auth.userId, env)) {
    klog("admin_auth_denied", { userId: auth.userId, reason: "admin_required" });
    const error = new Error("admin_required");
    error.status = 403;
    error.code = "admin_required";
    throw error;
  }
  return { userId: auth.userId, auth };
}

function adminAuthErrorResponse(error, headers) {
  const status = Number(error?.status) || 500;
  const body = { error: error?.code || "server_error" };
  if (status === 401 && error?.reason) {
    body.reason = error.reason;
  }
  return { statusCode: status, headers, body: JSON.stringify(body) };
}

export {
  adminAuthErrorResponse,
  isAdminUser,
  parseAdminUserIds,
  requireAdminUser,
};
