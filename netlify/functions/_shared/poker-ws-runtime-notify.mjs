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
