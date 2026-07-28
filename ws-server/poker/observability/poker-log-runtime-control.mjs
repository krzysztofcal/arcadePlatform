import { POKER_LOG_CATEGORIES, resolvePokerLogPolicy } from "./poker-log-policy.mjs";

const LEVELS = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 });
const TTL_MIN_MS = 60_000;
const TTL_DEFAULT_MS = 15 * 60_000;
const TTL_MAX_MS = 60 * 60_000;
const TABLE_OVERRIDE_LIMIT = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_TABLE_RE = /^guest_[a-z0-9_-]{1,120}$/i;

function normalizeLevel(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return Object.prototype.hasOwnProperty.call(LEVELS, normalized) ? normalized : null;
}

function normalizeCategory(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return POKER_LOG_CATEGORIES.includes(normalized) ? normalized : null;
}

function normalizeTableId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return UUID_RE.test(normalized) || GUEST_TABLE_RE.test(normalized) ? normalized : null;
}

function makeError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeTtlMs(value) {
  const ttlMs = Number(value);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < TTL_MIN_MS || ttlMs > TTL_MAX_MS) {
    throw makeError("invalid_ttl");
  }
  return ttlMs;
}

function publicOverride(entry) {
  return {
    scope: entry.scope,
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.tableId ? { tableId: entry.tableId } : {}),
    expiresAt: new Date(entry.expiresAtMs).toISOString()
  };
}

export function createPokerLogRuntimeControl({
  env = process.env,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  tableOverrideLimit = TABLE_OVERRIDE_LIMIT,
  audit = () => {}
} = {}) {
  const configuredLevel = normalizeLevel(env?.WS_POKER_LOG_LEVEL);
  const defaultLevel = configuredLevel || "INFO";
  const invalidConfiguredLevel = env?.WS_POKER_LOG_LEVEL != null && !configuredLevel;
  const legacyPokerDebug = env?.WS_POKER_VERBOSE_LOGS === "1";
  const legacyAutoplayDebug = env?.WS_BOT_AUTOPLAY_VERBOSE_LOGS === "1";
  let globalOverride = null;
  const categoryOverrides = new Map();
  const tableOverrides = new Map();
  let expiryTimer = null;

  function allOverrides() {
    return [
      ...(globalOverride ? [globalOverride] : []),
      ...categoryOverrides.values(),
      ...tableOverrides.values()
    ];
  }

  function scheduleExpiry() {
    if (expiryTimer) clearTimer(expiryTimer);
    expiryTimer = null;
    const nextExpiry = Math.min(...allOverrides().map((entry) => entry.expiresAtMs));
    if (!Number.isFinite(nextExpiry)) return;
    expiryTimer = setTimer(() => {
      expiryTimer = null;
      pruneExpired("timer");
    }, Math.max(0, nextExpiry - now()));
    expiryTimer?.unref?.();
  }

  function pruneExpired(trigger = "read") {
    const current = now();
    const expired = [];
    if (globalOverride && globalOverride.expiresAtMs <= current) {
      expired.push(globalOverride);
      globalOverride = null;
    }
    for (const [category, entry] of categoryOverrides) {
      if (entry.expiresAtMs <= current) {
        expired.push(entry);
        categoryOverrides.delete(category);
      }
    }
    for (const [tableId, entry] of tableOverrides) {
      if (entry.expiresAtMs <= current) {
        expired.push(entry);
        tableOverrides.delete(tableId);
      }
    }
    for (const entry of expired) {
      audit("ws_poker_debug_override_expired", { ...publicOverride(entry), trigger });
    }
    if (expired.length > 0 || !expiryTimer) scheduleExpiry();
    return expired.length;
  }

  function debugEnabled({ category, tableId } = {}) {
    pruneExpired();
    if (defaultLevel === "DEBUG") return true;
    if (legacyAutoplayDebug && category === "autoplay") return true;
    if (legacyPokerDebug && category !== "autoplay") return true;
    if (globalOverride) return true;
    if (category && categoryOverrides.has(category)) return true;
    return Boolean(tableId && tableOverrides.has(tableId));
  }

  function shouldEmit(eventName, data = null) {
    try {
      const policy = resolvePokerLogPolicy(eventName, data);
      if (!policy.classified) return true;
      if (policy.severity === "ERROR") return true;
      if (policy.severity === "DEBUG") {
        return debugEnabled({
          category: policy.category,
          tableId: normalizeTableId(data?.tableId)
        });
      }
      return LEVELS[policy.severity] >= LEVELS[defaultLevel];
    } catch {
      return true;
    }
  }

  function mayBuildDebugPayload(eventName) {
    const policy = eventName === "ws_table_janitor_result"
      ? { severity: "DEBUG", category: "janitor", classified: true }
      : resolvePokerLogPolicy(eventName);
    if (policy.severity !== "DEBUG") return shouldEmit(eventName);
    pruneExpired();
    return defaultLevel === "DEBUG"
      || globalOverride !== null
      || categoryOverrides.has(policy.category)
      || tableOverrides.size > 0
      || (legacyAutoplayDebug && policy.category === "autoplay")
      || (legacyPokerDebug && policy.category !== "autoplay");
  }

  function enable({ scope, category = null, tableId = null, ttlMs, adminUserId = null }) {
    const normalizedScope = typeof scope === "string" ? scope.trim().toLowerCase() : "";
    const normalizedTtlMs = normalizeTtlMs(ttlMs);
    const entry = {
      scope: normalizedScope,
      expiresAtMs: now() + normalizedTtlMs
    };
    let updated = false;
    if (normalizedScope === "global") {
      updated = Boolean(globalOverride);
      globalOverride = entry;
    } else if (normalizedScope === "category") {
      const normalizedCategory = normalizeCategory(category);
      if (!normalizedCategory) throw makeError("invalid_category");
      entry.category = normalizedCategory;
      updated = categoryOverrides.has(normalizedCategory);
      categoryOverrides.set(normalizedCategory, entry);
    } else if (normalizedScope === "table") {
      const normalizedTableId = normalizeTableId(tableId);
      if (!normalizedTableId) throw makeError("invalid_table_id");
      if (!tableOverrides.has(normalizedTableId) && tableOverrides.size >= tableOverrideLimit) {
        throw makeError("table_override_capacity", 409);
      }
      entry.tableId = normalizedTableId;
      updated = tableOverrides.has(normalizedTableId);
      tableOverrides.set(normalizedTableId, entry);
    } else {
      throw makeError("invalid_scope");
    }
    scheduleExpiry();
    audit("ws_poker_debug_override_enabled", { ...publicOverride(entry), updated, adminUserId });
    return snapshot();
  }

  function disable({ scope, category = null, tableId = null, adminUserId = null }) {
    const normalizedScope = typeof scope === "string" ? scope.trim().toLowerCase() : "";
    let removed = false;
    let identity = { scope: normalizedScope };
    if (normalizedScope === "global") {
      removed = Boolean(globalOverride);
      globalOverride = null;
    } else if (normalizedScope === "category") {
      const normalizedCategory = normalizeCategory(category);
      if (!normalizedCategory) throw makeError("invalid_category");
      identity.category = normalizedCategory;
      removed = categoryOverrides.delete(normalizedCategory);
    } else if (normalizedScope === "table") {
      const normalizedTableId = normalizeTableId(tableId);
      if (!normalizedTableId) throw makeError("invalid_table_id");
      identity.tableId = normalizedTableId;
      removed = tableOverrides.delete(normalizedTableId);
    } else {
      throw makeError("invalid_scope");
    }
    scheduleExpiry();
    audit("ws_poker_debug_override_disabled", { ...identity, removed, adminUserId });
    return snapshot();
  }

  function snapshot() {
    pruneExpired();
    return {
      defaultLevel,
      serverNow: new Date(now()).toISOString(),
      ttl: {
        minMs: TTL_MIN_MS,
        defaultMs: TTL_DEFAULT_MS,
        maxMs: TTL_MAX_MS,
        presetsMs: [15 * 60_000, 30 * 60_000, 60 * 60_000]
      },
      overrides: allOverrides()
        .sort((left, right) => left.expiresAtMs - right.expiresAtMs)
        .map(publicOverride)
    };
  }

  return {
    defaultLevel,
    invalidConfiguredLevel,
    shouldEmit,
    mayBuildDebugPayload,
    enable,
    disable,
    snapshot,
    pruneExpired
  };
}

let auditLogger = () => {};
export const pokerLogRuntimeControl = createPokerLogRuntimeControl({
  audit: (...args) => auditLogger(...args)
});

export function setPokerLogRuntimeAuditLogger(logger) {
  auditLogger = typeof logger === "function" ? logger : () => {};
}
