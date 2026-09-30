import { POKER_BUY_IN_MATERIALIZATION_CAPABILITY_VERSION } from "../../../shared/poker-domain/table-economy.mjs";

const DEFAULT_NOTIFY_TIMEOUT_MS = 4_000;
const BUY_IN_CAPABILITY_HEADER = "x-poker-buy-in-materialization";

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resolveBaseUrl(env) {
  return normalizeText(env?.POKER_WS_INTERNAL_BASE_URL);
}

function resolveToken(env) {
  return normalizeText(env?.POKER_WS_INTERNAL_TOKEN);
}

function resolveTimeoutMs(env) {
  const parsed = Number(env?.POKER_WS_INTERNAL_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed < 250) {
    return DEFAULT_NOTIFY_TIMEOUT_MS;
  }
  return Math.trunc(parsed);
}

function readHeader(response, name) {
  if (typeof response?.headers?.get === "function") {
    return response.headers.get(name);
  }
  if (response?.headers && typeof response.headers === "object") {
    return response.headers[name] ?? response.headers[name.toLowerCase()] ?? null;
  }
  return null;
}

function normalizeProjectionInteger(value, { min = 0, nullable = true } = {}) {
  if (value === null || value === undefined) return nullable ? null : undefined;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min) return undefined;
  return normalized;
}

export function normalizeAccountPokerProjection(payload, userId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.ok !== true || payload.userId !== userId) return null;
  const poker = payload.poker;
  if (!poker || typeof poker !== "object" || Array.isArray(poker) || typeof poker.inPoker !== "boolean" || !Array.isArray(poker.tables)) {
    return null;
  }

  const tables = [];
  for (const table of poker.tables) {
    if (!table || typeof table !== "object" || Array.isArray(table) || typeof table.tableId !== "string" || !table.tableId.trim()) {
      return null;
    }
    const seatNo = normalizeProjectionInteger(table.seatNo, { min: 1 });
    const stack = normalizeProjectionInteger(table.stack, { min: 0 });
    const maxPlayers = normalizeProjectionInteger(table.maxPlayers, { min: 1 });
    const stateVersion = normalizeProjectionInteger(table.stateVersion, { min: 0, nullable: false });
    if (seatNo === undefined || stack === undefined || maxPlayers === undefined || stateVersion === undefined) {
      return null;
    }
    if (typeof table.status !== "string" || !table.status.trim()) return null;
    if (table.seatStatus !== null && typeof table.seatStatus !== "string") return null;
    if (table.handStatus !== null && typeof table.handStatus !== "string") return null;
    if (table.leaving !== undefined && typeof table.leaving !== "boolean") return null;

    let stakes = null;
    if (table.stakes !== null && table.stakes !== undefined) {
      const sb = normalizeProjectionInteger(table.stakes?.sb, { min: 1, nullable: false });
      const bb = normalizeProjectionInteger(table.stakes?.bb, { min: 1, nullable: false });
      if (sb === undefined || bb === undefined) return null;
      stakes = { sb, bb };
    }

    const normalizedTable = {
      tableId: table.tableId.trim(),
      status: table.status.trim(),
      seatNo,
      seatStatus: table.seatStatus === null ? null : table.seatStatus,
      stack,
      stakes,
      maxPlayers,
      stateVersion,
      handStatus: table.handStatus === null ? null : table.handStatus
    };
    if (table.leaving === true) normalizedTable.leaving = true;
    tables.push(normalizedTable);
  }

  if (poker.inPoker !== (tables.length > 0)) return null;
  return { inPoker: poker.inPoker, tables };
}

export async function loadWsAccountPokerProjection({
  userId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  klog = () => {}
} = {}) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    return null;
  }

  const baseUrl = resolveBaseUrl(env);
  if (!baseUrl) {
    klog("poker_ws_account_projection_unavailable", { reason: "ws_internal_base_url_missing" });
    return null;
  }
  if (typeof fetchImpl !== "function") {
    klog("poker_ws_account_projection_unavailable", { reason: "fetch_unavailable" });
    return null;
  }

  const timeoutMs = resolveTimeoutMs(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  const headers = { Accept: "application/json" };
  const token = resolveToken(env);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetchImpl(
      `${baseUrl.replace(/\/$/, "")}/internal/account/poker?userId=${encodeURIComponent(normalizedUserId)}`,
      { method: "GET", headers, signal: controller.signal }
    );
    if (response?.ok !== true) {
      klog("poker_ws_account_projection_unavailable", {
        reason: "request_failed",
        status: Number.isInteger(response?.status) ? response.status : null
      });
      return null;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      klog("poker_ws_account_projection_unavailable", { reason: "invalid_json" });
      return null;
    }
    const projection = normalizeAccountPokerProjection(payload, normalizedUserId);
    if (!projection) {
      klog("poker_ws_account_projection_unavailable", { reason: "invalid_projection" });
      return null;
    }
    return projection;
  } catch (error) {
    klog("poker_ws_account_projection_error", {
      reason: error?.name === "AbortError" ? "timeout" : "request_failed"
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkWsBuyInCapability({
  env = process.env,
  fetchImpl = globalThis.fetch,
  klog = () => {}
} = {}) {
  const baseUrl = resolveBaseUrl(env);
  if (!baseUrl) {
    return { ok: false, skipped: true, reason: "ws_internal_base_url_missing" };
  }

  if (typeof fetchImpl !== "function") {
    klog("poker_ws_buy_in_capability_unavailable", { reason: "fetch_unavailable" });
    return { ok: false, skipped: false, reason: "fetch_unavailable" };
  }

  const timeoutMs = resolveTimeoutMs(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  const headers = {};
  const token = resolveToken(env);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/healthz`, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const supported = response.ok
      && readHeader(response, BUY_IN_CAPABILITY_HEADER) === POKER_BUY_IN_MATERIALIZATION_CAPABILITY_VERSION;
    if (!supported) {
      klog("poker_ws_buy_in_capability_unavailable", {
        status: response.status,
        advertised: readHeader(response, BUY_IN_CAPABILITY_HEADER)
      });
      return { ok: false, skipped: false, reason: "buy_in_capability_unavailable", status: response.status };
    }
    return { ok: true, skipped: false };
  } catch (error) {
    klog("poker_ws_buy_in_capability_error", {
      message: error?.message || "unknown_error"
    });
    return { ok: false, skipped: false, reason: error?.name === "AbortError" ? "timeout" : "request_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyWsLobbyMaterialize({
  tableId,
  maxPlayers,
  stakes,
  buyIn,
  env = process.env,
  fetchImpl = globalThis.fetch,
  klog = () => {}
} = {}) {
  const normalizedTableId = normalizeText(tableId);
  if (!normalizedTableId) {
    return { ok: false, skipped: true, reason: "invalid_table_id" };
  }

  const baseUrl = resolveBaseUrl(env);
  if (!baseUrl) {
    return { ok: false, skipped: true, reason: "ws_internal_base_url_missing" };
  }

  if (typeof fetchImpl !== "function") {
    klog("poker_ws_runtime_notify_unavailable", {
      tableId: normalizedTableId,
      reason: "fetch_unavailable"
    });
    return { ok: false, skipped: false, reason: "fetch_unavailable" };
  }

  const timeoutMs = resolveTimeoutMs(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  const headers = { "content-type": "application/json" };
  const token = resolveToken(env);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/internal/lobby/materialize-table`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tableId: normalizedTableId, maxPlayers, stakes, buyIn }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      klog("poker_ws_runtime_notify_failed", {
        tableId: normalizedTableId,
        status: response.status,
        body: body || null
      });
      return { ok: false, skipped: false, reason: "notify_failed", status: response.status };
    }
    return { ok: true, skipped: false };
  } catch (error) {
    klog("poker_ws_runtime_notify_error", {
      tableId: normalizedTableId,
      message: error?.message || "unknown_error"
    });
    return { ok: false, skipped: false, reason: error?.name === "AbortError" ? "timeout" : "request_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyWsPokerAccessMutation({
  userId,
  override = null,
  expectedRevision = null,
  actorId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  klog = () => {}
} = {}) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return { ok: false, skipped: true, reason: "invalid_user_id" };
  const baseUrl = resolveBaseUrl(env);
  if (!baseUrl) return { ok: false, skipped: true, reason: "ws_internal_base_url_missing" };
  if (typeof fetchImpl !== "function") {
    klog("poker_ws_access_mutation_notify_unavailable", { userId: normalizedUserId, reason: "fetch_unavailable" });
    return { ok: false, skipped: false, reason: "fetch_unavailable" };
  }
  const timeoutMs = Math.min(resolveTimeoutMs(env), DEFAULT_NOTIFY_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer?.unref === "function") timer.unref();
  const headers = { "content-type": "application/json", accept: "application/json" };
  const token = resolveToken(env);
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/internal/admin/poker-access-refresh`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        userId: normalizedUserId,
        action: "mutate",
        phase: "mutate",
        override: typeof override === "string" ? override.trim().toUpperCase() : null,
        expectedRevision: Number(expectedRevision),
        actorId: typeof actorId === "string" && actorId.trim() ? actorId.trim() : (actorId ?? null)
      }),
      signal: controller.signal
    });
    if (!response?.ok) {
      let errorPayload = null;
      try { errorPayload = await response.json(); } catch { errorPayload = null; }
      const reason = typeof errorPayload?.reason === "string"
        ? errorPayload.reason
        : (typeof errorPayload?.error === "string" ? errorPayload.error : "notify_failed");
      klog("poker_ws_access_mutation_notify_failed", {
        userId: normalizedUserId,
        status: response?.status ?? null,
        reason
      });
      return {
        ok: false,
        skipped: false,
        status: response?.status ?? null,
        reason,
        failClosed: typeof errorPayload?.failClosed === "boolean" ? errorPayload.failClosed : false
      };
    }
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }

    const requestedOverrideCanonical = typeof override === "string" ? override.trim().toUpperCase() : null;
    const expectedTargetRevision = Number(expectedRevision) + 1;
    const isExactAck = payload?.ok === true
      && payload?.userId === normalizedUserId
      && Number(payload?.revision) === expectedTargetRevision
      && payload?.override === requestedOverrideCanonical
      && payload?.failClosed === false;

    if (!isExactAck) {
      klog("poker_ws_access_mutation_confirmation_mismatch", {
        userId: normalizedUserId,
        status: response.status,
        expectedRevision: expectedTargetRevision,
        actualRevision: payload?.revision,
        expectedOverride: requestedOverrideCanonical,
        actualOverride: payload?.override,
        failClosed: payload?.failClosed
      });
      return {
        ok: false,
        skipped: false,
        status: 503,
        reason: "poker_access_confirmation_mismatch",
        failClosed: typeof payload?.failClosed === "boolean" ? payload.failClosed : false
      };
    }

    return {
      ok: true,
      skipped: false,
      status: 200,
      userId: payload.userId,
      revision: payload.revision,
      override: payload.override,
      automaticClass: typeof payload?.automaticClass === "string" ? payload.automaticClass : null,
      effectiveClass: typeof payload?.effectiveClass === "string" ? payload.effectiveClass : null,
      failClosed: false,
      access: payload?.access || null,
      slowOnlyTableIds: Array.isArray(payload?.slowOnlyTableIds) ? payload.slowOnlyTableIds : []
    };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : "request_failed";
    klog("poker_ws_access_mutation_notify_error", {
      userId: normalizedUserId,
      reason
    });
    return { ok: false, skipped: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
