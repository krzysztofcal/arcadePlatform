// tools/poker-e2e-flop-check-bet-call-turn.mjs
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

const missing = REQUIRED_ENV.filter((k) => !process.env[k] || !String(process.env[k]).trim());
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 15000;
const HEARTBEAT_MS = 15000;

const base = process.env.BASE;
const origin = process.env.ORIGIN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const allowProd = process.env.POKER_SMOKE_ALLOW_PROD === "1";

let baseHost = null;
try { baseHost = new URL(base).hostname; } catch {
  console.error(`Invalid BASE url: ${base}`);
  process.exit(1);
}

if (baseHost === "play.kcswh.pl" && !allowProd) {
  console.error("Refusing to run smoke test against production. Set POKER_SMOKE_ALLOW_PROD=1 to proceed.");
  process.exit(1);
}

const requestId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const buildUrl = (path) => new URL(path, base).toString();

const parseJson = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

const fetchJson = async (url, options) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    const json = parseJson(text);
    return { res, text, json };
  } finally {
    clearTimeout(timeoutId);
  }
};

const decodeUserId = (token) => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.sub || null;
  } catch {
    return null;
  }
};

const getSupabaseToken = async (email, password) => {
  const tokenUrl = new URL("/auth/v1/token", supabaseUrl);
  tokenUrl.searchParams.set("grant_type", "password");
  const { res, json, text } = await fetchJson(tokenUrl.toString(), {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok || !json?.access_token) {
    throw new Error(`supabase_auth_failed:${res.status}:${text}`);
  }
  return json.access_token;
};

const callJson = async ({ path, method, token, body }) => {
  const headers = { origin, authorization: `Bearer ${token}` };
  if (body) headers["content-type"] = "application/json";
  return fetchJson(buildUrl(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
};

const assertOk = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertStatus = (res, text, want, label) => {
  if (res.status !== want) {
    throw new Error(`${label} status=${res.status} body=${text || ""}`);
  }
};

(async () => {
  const u1Token = await getSupabaseToken(process.env.U1_EMAIL, process.env.U1_PASS);
  const u2Token = await getSupabaseToken(process.env.U2_EMAIL, process.env.U2_PASS);
  const u1UserId = decodeUserId(u1Token);
  const u2UserId = decodeUserId(u2Token);
  assertOk(u1UserId && u2UserId, "failed to decode user ids");

  let heartbeatError = null;
  const timers = [];

  const heartbeatOnce = async (label, token, tableId) => {
    try {
      const hb = await callJson({
        path: "/.netlify/functions/poker-heartbeat",
        method: "POST",
        token,
        body: { tableId, requestId: requestId(`hb-${label}`) },
      });
      if (hb.res.status !== 200) heartbeatError = new Error(`heartbeat ${label} failed`);
    } catch (e) {
      heartbeatError = e;
    }
  };

  const getTable = async (token, tableId) => {
    const gt = await callJson({
      path: `/.netlify/functions/poker-get-table?tableId=${tableId}&t=${Date.now()}`,
      method: "GET",
      token,
    });
    assertStatus(gt.res, gt.text, 200, "poker-get-table");
    assertOk(gt.json?.ok === true, "get-table ok:false");
    return gt.json;
  };

  try {
    // create table
    const create = await callJson({
      path: "/.netlify/functions/poker-create-table",
      method: "POST",
      token: u1Token,
      body: { requestId: requestId("create") },
    });
    assertStatus(create.res, create.text, 200, "create-table");
    const tableId = create.json.tableId;

    // join
    await callJson({
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u1Token,
      body: { tableId, seatNo: 0, buyIn: 100, requestId: requestId("join1") },
    });
    await callJson({
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u2Token,
      body: { tableId, seatNo: 1, buyIn: 100, requestId: requestId("join2") },
    });

    // heartbeat
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);
    timers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), HEARTBEAT_MS));

    // start hand
    const start = await callJson({
      path: "/.netlify/functions/poker-start-hand",
      method: "POST",
      token: u1Token,
      body: { tableId, requestId: requestId("start") },
    });
    assertOk(start.json?.ok === true, "start-hand failed");

    // PREFLOP CHECK / CHECK
    let table = await getTable(u1Token, tableId);
    let turn = table.state.state.turnUserId;
    const tokenFor = (uid) => uid === u1UserId ? u1Token : u2Token;

    await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: tokenFor(turn),
      body: { tableId, requestId: requestId("pf-check-1"), action: { type: "CHECK" } },
    });

    table = await getTable(u1Token, tableId);
    turn = table.state.state.turnUserId;

    await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: tokenFor(turn),
      body: { tableId, requestId: requestId("pf-check-2"), action: { type: "CHECK" } },
    });

    // FLOP: CHECK → BET → CALL
    table = await getTable(u1Token, tableId);
    assertOk(table.state.state.phase === "FLOP", "expected FLOP");

    turn = table.state.state.turnUserId;
    await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: tokenFor(turn),
      body: { tableId, requestId: requestId("flop-check"), action: { type: "CHECK" } },
    });

    table = await getTable(u1Token, tableId);
    turn = table.state.state.turnUserId;
    await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: tokenFor(turn),
      body: { tableId, requestId: requestId("flop-bet"), action: { type: "BET", amount: 5 } },
    });

    table = await getTable(u1Token, tableId);
    turn = table.state.state.turnUserId;
    await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: tokenFor(turn),
      body: { tableId, requestId: requestId("flop-call"), action: { type: "CALL" } },
    });

    table = await getTable(u1Token, tableId);
    assertOk(table.state.state.phase === "TURN", "expected TURN");
    assertOk(table.state.state.community.length === 4, "expected 4 community cards");

    if (heartbeatError) throw heartbeatError;

    console.log(`OK: PREFLOP->FLOP CHECK/CHECK then FLOP CHECK/BET/CALL -> TURN. tableId=${tableId}`);
    console.log(`UI: ${origin.replace(/\/$/, "")}/poker/table.html?tableId=${tableId}`);
  } catch (e) {
    console.error("Smoke test failed:", e.message || e);
    process.exit(1);
  } finally {
    timers.forEach(clearInterval);
  }
})();
