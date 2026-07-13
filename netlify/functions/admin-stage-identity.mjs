import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { BUILD_DEPLOY_CONTEXT } from "./_generated/deploy-context.mjs";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseProjectRefFromSupabaseUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname || "";
    const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(host);
    return match ? match[1] : null;
  } catch (_error) {
    return null;
  }
}

function parseProjectRefFromDbUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username || "");
    const host = url.hostname || "";
    const hostMatch = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(host);
    if (hostMatch) return hostMatch[1];
    const isSupabasePooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(host);
    const userMatch = /^postgres\.([a-z0-9-]+)$/i.exec(username);
    if (isSupabasePooler && userMatch) return userMatch[1];
    return null;
  } catch (_error) {
    return null;
  }
}

function parseProjectRefFromSupabaseJwt(value) {
  const raw = normalizeString(value);
  if (raw === "") return null;
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const ref = normalizeString((payload && (payload.ref || payload.iss)) || "");
    return new RegExp("^[a-z0-9-]+" + String.fromCharCode(36), "i").test(ref) ? ref : null;
  } catch (_error) {
    return null;
  }
}

function resolveEnvironmentContext(env = process.env, buildDeployContext = BUILD_DEPLOY_CONTEXT) {
  const supportedContexts = ["production", "deploy-preview", "branch-deploy", "development"];
  const configuredTarget = normalizeString(env.ARCADE_DEPLOY_TARGET);
  if (supportedContexts.includes(configuredTarget)) {
    return configuredTarget;
  }
  const runtimeContext = normalizeString(env.CONTEXT || env.NETLIFY_CONTEXT);
  if (supportedContexts.includes(runtimeContext)) return runtimeContext;
  const embeddedContext = normalizeString(buildDeployContext);
  if (supportedContexts.includes(embeddedContext)) return embeddedContext;
  return env.NODE_ENV === "development" ? "development" : "unknown";
}

function resolveConfiguredProjectRef(env = process.env) {
  return parseProjectRefFromSupabaseUrl(env.SUPABASE_URL || env.SUPABASE_URL_V2)
    || parseProjectRefFromDbUrl(env.SUPABASE_DB_URL)
    || null;
}

function resolveExpectedStageProjectRef(env = process.env) {
  return normalizeString(
    env.SUPABASE_STAGE_PROJECT_REF
    || env.STAGE_SUPABASE_PROJECT_REF
    || env.EXPECTED_STAGE_SUPABASE_PROJECT_REF,
  ) || null;
}

function resolveDatabaseTarget({ environmentContext, projectRef, expectedStageProjectRef } = {}) {
  if (expectedStageProjectRef && projectRef && projectRef === expectedStageProjectRef) return "stage";
  if (environmentContext === "production") return "production";
  return "unknown";
}

function buildStageIdentity(env = process.env, options = {}) {
  const environmentContext = resolveEnvironmentContext(env, options.buildDeployContext);
  const supabaseUrlProjectRef = parseProjectRefFromSupabaseUrl(env.SUPABASE_URL || env.SUPABASE_URL_V2);
  const databaseProjectRef = parseProjectRefFromDbUrl(env.SUPABASE_DB_URL);
  const supabaseProjectRef = supabaseUrlProjectRef || databaseProjectRef || resolveConfiguredProjectRef(env);
  const expectedStageProjectRef = resolveExpectedStageProjectRef(env);
  const serviceRoleProjectRef = parseProjectRefFromSupabaseJwt(env.SUPABASE_SERVICE_ROLE_KEY);
  const stageProjectRefMatches = !!expectedStageProjectRef && !!supabaseProjectRef && expectedStageProjectRef === supabaseProjectRef;
  const databaseTarget = resolveDatabaseTarget({
    environmentContext,
    projectRef: supabaseProjectRef,
    expectedStageProjectRef,
  });

  return {
    environmentContext,
    supabaseProjectRef: supabaseProjectRef || null,
    supabaseUrlProjectRef: supabaseUrlProjectRef || null,
    databaseProjectRef: databaseProjectRef || null,
    databaseMatchesSupabaseProjectRef: !!supabaseUrlProjectRef && !!databaseProjectRef && supabaseUrlProjectRef === databaseProjectRef,
    expectedStageProjectRef,
    databaseTarget,
    chipsEnabled: env.CHIPS_ENABLED === "1",
    stageProjectRefConfigured: !!expectedStageProjectRef,
    stageProjectRefMatches,
    serviceRoleProjectRef: serviceRoleProjectRef || null,
    serviceRoleStageProjectRefMatches: !!expectedStageProjectRef && !!serviceRoleProjectRef && expectedStageProjectRef === serviceRoleProjectRef,
    config: {
      hasSupabaseUrl: !!normalizeString(env.SUPABASE_URL || env.SUPABASE_URL_V2),
      hasSupabaseDbUrl: !!normalizeString(env.SUPABASE_DB_URL),
      hasSupabaseJwtSecret: !!normalizeString(env.SUPABASE_JWT_SECRET || env.SUPABASE_JWT_SECRET_V2),
      hasSupabaseAnonKey: !!normalizeString(env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY_V2),
      hasSupabaseServiceRoleKey: !!normalizeString(env.SUPABASE_SERVICE_ROLE_KEY),
    },
  };
}

function createAdminStageIdentityHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const buildIdentity = deps.buildStageIdentity || (() => buildStageIdentity(env));
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
    }

    try {
      const admin = await requireAdmin(event, env);
      const identity = buildIdentity();
      klog("stage_identity_checked", {
        userId: admin.userId,
        environmentContext: identity.environmentContext,
        databaseTarget: identity.databaseTarget,
        stageProjectRefConfigured: identity.stageProjectRefConfigured,
        stageProjectRefMatches: identity.stageProjectRefMatches,
      });
      return { statusCode: 200, headers: cors, body: JSON.stringify(identity) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      klog("stage_identity_failed", { reason: error?.code || "server_error" });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminStageIdentityHandler();

export {
  buildStageIdentity,
  createAdminStageIdentityHandler,
  handler,
  parseProjectRefFromDbUrl,
  parseProjectRefFromSupabaseUrl,
  parseProjectRefFromSupabaseJwt,
  resolveDatabaseTarget,
};
