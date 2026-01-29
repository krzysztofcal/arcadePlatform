/* tools/poker-e2e-smoke.mjs (example) */

const REQUIRED_ENV = [
  "BASE",
  "ORIGIN",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "U1_EMAIL",
  "U1_PASS",
  "U2_EMAIL",
  "U2_PASS",
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 30000;

const base = process.env.BASE;
const origin = process.env.ORIGIN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const allowProd = process.env.POKER_SMOKE_ALLOW_PROD === "1";

let baseHost = null;
try {
  baseHost = new URL(base).hostname;
} catch {
  console.error(`Invalid BASE url: ${base}`);
  process.exit(1);
}

if (baseHost === "play.kcswh.pl" && !allowProd) {
  console.error("Refusing to run smoke test against production. Set POKER_SMOKE_ALLOW_PROD=1 to proceed.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const requestId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const buildUrl = (path) => new URL(path, base).toString();

const parseJson = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const snippet = (text, n = 240) => {
  if (!text) return "";
  return text.length > n ? `${text.slice(0, n)}…` : text;
};

const fetchJson = async (url, options) => {
  const maxAttempts = 3;

  const shouldRetryStatus = (status) =>
    status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;

  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      const json = parseJson(text);

      if (!response.ok && shouldRetryStatus(response.status) && attempt < maxAttempts) {
        const backoff = attempt === 1 ? 300 : attempt === 2 ? 800 : 1500;
        console.warn(
          `[fetchJson] retrying ${url} status=${response.status} attempt=${attempt}/${maxAttempts} backoff=${backoff}ms body=${snippet(
            text
          )}`
        );
        await sleep(backoff);
        continue;
      }

      return { response, text, json };
    } catch (err) {
      lastErr = err;

      const isAbort = err?.name === "AbortError";
      if (isAbort && attempt < maxAttempts) {
        const backoff = attempt === 1 ? 300 : attempt === 2 ? 800 : 1500;
        console.warn(
          `[fetchJson] timeout retrying ${url} attempt=${attempt}/${maxAttempts} backoff=${backoff}ms timeout=${FETCH_TIMEOUT_MS}ms`
        );
        await sleep(backoff);
        continue;
      }

      if (isAbort) {
        throw new Error(`fetch_timeout:${FETCH_TIMEOUT_MS}ms url=${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastErr || new Error(`fetch_failed url=${url}`);
};

const decodeUserId = (token) => {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
};

const getSupabaseToken = async (email, password) => {
  const tokenUrl = new URL("/auth/v1/token", supabaseUrl);
  tokenUrl.searchParams.set("grant_type", "password");

  const { response, json, text } = await fetchJson(tokenUrl.toString(), {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = json?.error_description || json?.error || text || response.statusText;
    throw new Error(`supabase_auth_failed:${response.status}:${snippet(message, 400)}`);
  }
  if (!json?.access_token) {
    throw new Error("supabase_auth_missing_token");
  }
  return json.access_token;
};

const callJson = async ({ path, method, token, body }) => {
  const url = buildUrl(path);
  const headers = {
    origin,
    authorization: `Bearer ${token}`,
  };
  if (body) headers["content-type"] = "application/json";

  return fetchJson(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
};

const assertOk = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertResponse = (response, text, expectedStatus, label) => {
  if (response.status !== expectedStatus) {
    throw new Error(`${label} status=${response.status} body=${snippet(text)}`.trim());
  }
};

const run = async () => {
  const u1Token = await getSupabaseToken(process.env.U1_EMAIL, process.env.U1_PASS);
  const u2Token = await getSupabaseToken(process.env.U2_EMAIL, process.env.U2_PASS);

  const u1UserId = decodeUserId(u1Token);
  const u2UserId = decodeUserId(u2Token);
  assertOk(u1UserId && u2UserId, "unable to decode user ids from auth tokens");

  let heartbeatError = null;
  const heartbeatTimers = [];

  const heartbeatOnce = async (label, token, tableId) => {
    try {
      const hb = await callJson({
        path: "/.netlify/functions/poker-heartbeat",
        method: "POST",
        token,
        body: { tableId, requestId: requestId(`hb-${label}`) },
      });

      if (hb.response.status !== 200) {
        heartbeatError = new Error(
          `poker-heartbeat ${label} status=${hb.response.status} body=${snippet(hb.text)}`
        );
      }
    } catch (err) {
      heartbeatError = err;
    }
  };

  try {
    const create = await callJson({
      path: "/.netlify/functions/poker-create-table",
      method: "POST",
      token: u1Token,
      body: {
        requestId: requestId("create"),
        stakes: { sb: 1, bb: 2 },
        maxPlayers: 6,
      },
    });
    assertResponse(create.response, create.text, 200, "poker-create-table");
    const tableId = create.json?.tableId;
    assertOk(typeof tableId === "string" && tableId.length > 0, "poker-create-table missing tableId");

    const joinU1 = await callJson({
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u1Token,
      body: { tableId, seatNo: 0, buyIn: 100, requestId: requestId("join-u1") },
    });
    assertResponse(joinU1.response, joinU1.text, 200, "poker-join u1");

    const joinU2 = await callJson({
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u2Token,
      body: { tableId, seatNo: 1, buyIn: 100, requestId: requestId("join-u2") },
    });
    assertResponse(joinU2.response, joinU2.text, 200, "poker-join u2");

    // Start heartbeat loops (keeps seats alive)
    heartbeatTimers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), 15000));
    heartbeatTimers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), 15000));

    // One immediate heartbeat
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);

    const startHand = await callJson({
      path: "/.netlify/functions/poker-start-hand",
      method: "POST",
      token: u1Token,
      body: { tableId, requestId: requestId("start-hand") },
    });
    assertResponse(startHand.response, startHand.text, 200, "poker-start-hand");
    assertOk(startHand.json?.ok === true, "poker-start-hand did not return ok:true");

    const getTable = async (label, token) => {
      const url = `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}`;
      const result = await callJson({ path: url, method: "GET", token });
      assertResponse(result.response, result.text, 200, `poker-get-table ${label}`);

      const payload = result.json;
      assertOk(payload?.ok === true, `poker-get-table ${label} ok:false`);
      assertOk(payload?.state?.state?.phase === "PREFLOP", `poker-get-table ${label} unexpected phase`);

      const seats = Array.isArray(payload?.seats) ? payload.seats : [];
      const activeSeats = seats.filter((seat) => seat?.status === "ACTIVE");
      assertOk(activeSeats.length === 2, `poker-get-table ${label} expected 2 active seats`);

      assertOk(
        Array.isArray(payload?.myHoleCards) && payload.myHoleCards.length === 2,
        `poker-get-table ${label} missing hole cards`
      );

      return payload;
    };

    const tableU1 = await getTable("u1", u1Token);
    await getTable("u2", u2Token);

    const turnUserId = tableU1?.state?.state?.turnUserId;
    assertOk(typeof turnUserId === "string" && turnUserId.length > 0, "poker-get-table missing turnUserId");

    let actionToken = null;
    if (turnUserId === u1UserId) actionToken = u1Token;
    if (turnUserId === u2UserId) actionToken = u2Token;
    assertOk(actionToken, "poker-act could not resolve turn user token");

    const act = await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: actionToken,
      body: { tableId, requestId: requestId("act-check"), action: { type: "CHECK" } },
    });
    assertResponse(act.response, act.text, 200, "poker-act CHECK");
    assertOk(act.json?.ok === true, "poker-act CHECK did not return ok:true");

    const tableU1After = await callJson({
      path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}`,
      method: "GET",
      token: u1Token,
    });
    assertResponse(tableU1After.response, tableU1After.text, 200, "poker-get-table u1 post-act");
    assertOk(tableU1After.json?.ok === true, "poker-get-table u1 post-act ok:false");

    const v0 = Number(tableU1?.state?.version);
    const v1 = Number(tableU1After.json?.state?.version);
    assertOk(Number.isFinite(v0) && Number.isFinite(v1) && v1 > v0, "post-act version did not increase");

    if (heartbeatError) throw heartbeatError;

    const uiLink = `${origin.replace(/\/$/, "")}/poker/table.html?tableId=${encodeURIComponent(tableId)}`;
    console.log(`Smoke test complete. tableId=${tableId}`);
    console.log(`UI: ${uiLink}`);
  } finally {
    heartbeatTimers.forEach((t) => clearInterval(t));
  }
};

run().catch((err) => {
  console.error("Smoke test failed:", err?.message || err);
  process.exit(1);
});
