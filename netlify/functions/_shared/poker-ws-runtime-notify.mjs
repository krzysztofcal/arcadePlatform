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

    let stakes = null;
    if (table.stakes !== null && table.stakes !== undefined) {
      const sb = normalizeProjectionInteger(table.stakes?.sb, { min: 1, nullable: false });
      const bb = normalizeProjectionInteger(table.stakes?.bb, { min: 1, nullable: false });
      if (sb === undefined || bb === undefined) return null;
      stakes = { sb, bb };
    }

    tables.push({
      tableId: table.tableId.trim(),
      status: table.status.trim(),
      seatNo,
      seatStatus: table.seatStatus === null ? null : table.seatStatus,
      stack,
      stakes,
      maxPlayers,
      stateVersion,
      handStatus: table.handStatus === null ? null : table.handStatus
    });
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
