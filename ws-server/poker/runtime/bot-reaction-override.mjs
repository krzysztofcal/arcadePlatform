export const DEFAULT_BOT_REACTION_MIN_MS = 2_000;
export const DEFAULT_BOT_REACTION_MAX_MS = 4_000;
export const BOT_REACTION_OVERRIDE_MIN_MS = 100;
export const BOT_REACTION_OVERRIDE_MAX_MS = 10_000;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseProjectRefFromSupabaseUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname || "");
    return match ? match[1] : null;
  } catch (_error) {
    return null;
  }
}

function parseProjectRefFromDbUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username || "");
    const host = url.hostname || "";
    const directMatch = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(host);
    if (directMatch) return directMatch[1];
    if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(host)) return null;
    const poolerMatch = /^postgres\.([a-z0-9-]+)$/i.exec(username);
    return poolerMatch ? poolerMatch[1] : null;
  } catch (_error) {
    return null;
  }
}

function resolveWsPreviewRuntimeIdentity(env = process.env) {
  const stageProjectRef = normalizeText(env?.SUPABASE_STAGE_PROJECT_REF);
  const supabaseProjectRef = parseProjectRefFromSupabaseUrl(env?.SUPABASE_URL || env?.SUPABASE_URL_V2);
  const databaseProjectRef = parseProjectRefFromDbUrl(env?.SUPABASE_DB_URL);
  const hasLegacyTimingOverride = normalizeText(env?.WS_BOT_REACTION_MIN_MS) !== ""
    || normalizeText(env?.WS_BOT_REACTION_MAX_MS) !== "";
  const ok = (
    normalizeText(env?.PORT) === "3001"
    && env?.WS_AUTHORITATIVE_JOIN_ENABLED === "1"
    && !!stageProjectRef
    && supabaseProjectRef === stageProjectRef
    && databaseProjectRef === stageProjectRef
    && !hasLegacyTimingOverride
  );
  return {
    ok,
    code: ok ? null : "preview_only"
  };
}

function previewOnlyError() {
  const error = new Error("preview_only");
  error.code = "preview_only";
  error.status = 403;
  return error;
}

function invalidRangeError() {
  const error = new Error("invalid_range");
  error.code = "invalid_range";
  error.status = 400;
  return error;
}

function normalizeOverrideRange(minMs, maxMs) {
  const min = Number(minMs);
  const max = Number(maxMs);
  if (
    !Number.isInteger(min)
    || !Number.isInteger(max)
    || min < BOT_REACTION_OVERRIDE_MIN_MS
    || max > BOT_REACTION_OVERRIDE_MAX_MS
    || min > max
  ) {
    throw invalidRangeError();
  }
  return { minMs: min, maxMs: max };
}

function normalizeUpdatedBy(value) {
  const updatedBy = normalizeText(value);
  if (!updatedBy || updatedBy.length > 128) {
    const error = new Error("invalid_updated_by");
    error.code = "invalid_updated_by";
    error.status = 400;
    throw error;
  }
  return updatedBy;
}

export function createBotReactionOverrideStore({ env = process.env, now = Date.now } = {}) {
  const runtimeIdentity = resolveWsPreviewRuntimeIdentity(env);
  let override = null;

  function requirePreviewRuntime() {
    if (!runtimeIdentity.ok) throw previewOnlyError();
  }

  function snapshot() {
    requirePreviewRuntime();
    const active = override
      ? { minMs: override.minMs, maxMs: override.maxMs }
      : { minMs: DEFAULT_BOT_REACTION_MIN_MS, maxMs: DEFAULT_BOT_REACTION_MAX_MS };
    return {
      ok: true,
      environment: "ws-preview",
      mode: override ? "override" : "default",
      defaults: { minMs: DEFAULT_BOT_REACTION_MIN_MS, maxMs: DEFAULT_BOT_REACTION_MAX_MS },
      active,
      override: override ? { ...override } : null
    };
  }

  return {
    read: snapshot,
    getOverrideRange() {
      return override ? { minMs: override.minMs, maxMs: override.maxMs } : null;
    },
    setOverride({ minMs, maxMs, updatedBy } = {}) {
      requirePreviewRuntime();
      const range = normalizeOverrideRange(minMs, maxMs);
      const timestampMs = typeof now === "function" ? Number(now()) : Date.now();
      const updatedAt = new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString();
      override = {
        ...range,
        updatedAt,
        updatedBy: normalizeUpdatedBy(updatedBy)
      };
      return snapshot();
    },
    clearOverride({ updatedBy } = {}) {
      requirePreviewRuntime();
      normalizeUpdatedBy(updatedBy);
      override = null;
      return snapshot();
    }
  };
}

export {
  normalizeOverrideRange,
  parseProjectRefFromDbUrl,
  parseProjectRefFromSupabaseUrl,
  resolveWsPreviewRuntimeIdentity
};
