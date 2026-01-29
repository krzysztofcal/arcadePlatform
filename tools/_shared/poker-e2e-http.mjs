const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_TRIES = 5;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE"]);

const klog = (line) => {
  try {
    console.warn(line);
  } catch {}
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const snippet = (text, n = 240) => {
  if (!text) return "";
  const t = String(text);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const parseJson = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

const backoffDelay = (attempt, { baseDelayMs = 350, maxDelayMs = 3000 } = {}) => {
  const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 150);
  return backoff + jitter;
};

const retry = async (label, fn, { tries = DEFAULT_TRIES, baseDelayMs = 350, maxDelayMs = 3000 } = {}) => {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const attempt = i + 1;
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= tries) break;
      const delay = backoffDelay(attempt, { baseDelayMs, maxDelayMs });
      klog(`[retry] ${label} failed (try ${attempt}/${tries}): ${e?.message || e}. sleep=${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr || new Error(`retry_failed:${label}`);
};

const fetchJson = async (url, options = {}, { label, tries = DEFAULT_TRIES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  let lastErr = null;
  const safeLabel = label || url;

  for (let i = 0; i < tries; i++) {
    const attempt = i + 1;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      const json = parseJson(text);

      if (!res.ok && RETRY_STATUSES.has(res.status) && attempt < tries) {
        const delay = backoffDelay(attempt);
        klog(`[fetchJson] retry ${safeLabel} status=${res.status} try=${attempt}/${tries} sleep=${delay}ms`);
        await sleep(delay);
        continue;
      }

      return { res, text, json };
    } catch (e) {
      lastErr = e;
      if (e?.name === "AbortError") {
        throw new Error(`fetch_timeout:${timeoutMs}ms label=${safeLabel} url=${url}`);
      }
      const code = e?.cause?.code || e?.code;
      if (RETRY_ERROR_CODES.has(code) && attempt < tries) {
        const delay = backoffDelay(attempt);
        klog(`[fetchJson] retry ${safeLabel} err=${code || e?.message || e} try=${attempt}/${tries} sleep=${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastErr || new Error(`fetch_failed url=${url}`);
};

const api = async ({ base, origin, method, path, token, body, label, timeoutMs, tries } = {}) => {
  const url = new URL(path, base).toString();
  const headers = {
    origin,
  };
  if (typeof token === "string" && token.trim()) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  const out = await fetchJson(
    url,
    { method, headers, body: body ? JSON.stringify(body) : undefined },
    { label, timeoutMs, tries }
  );

  return { status: out.res.status, json: out.json, text: out.text };
};

const waitFor = async (label, predicate, { timeoutMs = 25000, pollMs = 600, minPollMs = 250, maxPollMs = 1500 } = {}) => {
  const started = Date.now();
  let attempt = 0;
  let lastErr = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const out = await predicate(attempt++);
      if (out) return out;
      lastErr = null;
    } catch (e) {
      lastErr = e;
    }
    const delay = Math.max(minPollMs, Math.min(maxPollMs, pollMs + attempt * 80));
    await sleep(delay);
  }

  throw new Error(`wait_timeout:${label} timeoutMs=${timeoutMs}${lastErr ? ` lastErr=${lastErr?.message || lastErr}` : ""}`);
};

export { api, fetchJson, parseJson, retry, sleep, snippet, waitFor };
