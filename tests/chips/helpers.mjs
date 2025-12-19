const REQUIRED_ENV = ["CHIPS_TEST_BASE_URL", "CHIPS_TEST_USER_JWT"];

function findMissingEnv() {
  return REQUIRED_ENV.filter((name) => !process.env[name]);
}

function loadConfig() {
  const missing = findMissingEnv();
  if (missing.length) {
    return { missing };
  }
  const base = process.env.CHIPS_TEST_BASE_URL;
  const baseUrl = base.endsWith("/") ? base : `${base}/`;
  const parsed = new URL(baseUrl);
  const origin = process.env.CHIPS_TEST_ORIGIN || `${parsed.origin}`;
  return {
    baseUrl,
    origin,
    jwt: process.env.CHIPS_TEST_USER_JWT,
  };
}

function authHeaders(config) {
  return {
    Authorization: `Bearer ${config.jwt}`,
    Origin: config.origin,
  };
}

async function apiFetch(config, path, { method = "GET", headers = {}, body } = {}) {
  const url = new URL(path, config.baseUrl);
  const init = {
    method,
    headers: { ...authHeaders(config), ...headers },
  };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await fetch(url, init);
  return response;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function getBalance(config) {
  const response = await apiFetch(config, "/.netlify/functions/chips-balance");
  const body = await readJson(response);
  return { status: response.status, body };
}

async function postTx(config, payload) {
  const response = await apiFetch(config, "/.netlify/functions/chips-tx", { method: "POST", body: payload });
  const body = await readJson(response);
  return { status: response.status, body };
}

async function getLedger(config, { after, limit } = {}) {
  const params = new URLSearchParams();
  if (after !== undefined && after !== null) params.set("after", String(after));
  if (limit !== undefined && limit !== null) params.set("limit", String(limit));
  const path = params.toString()
    ? `/.netlify/functions/chips-ledger?${params.toString()}`
    : "/.netlify/functions/chips-ledger";
  const response = await apiFetch(config, path);
  const body = await readJson(response);
  return { status: response.status, body };
}

function uniqueKey(prefix) {
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now()}-${rand}`;
}

function formatResponse({ status, body }) {
  return `status=${status} body=${JSON.stringify(body)}`;
}

export {
  REQUIRED_ENV,
  findMissingEnv,
  loadConfig,
  authHeaders,
  apiFetch,
  readJson,
  getBalance,
  postTx,
  getLedger,
  uniqueKey,
  formatResponse,
};
