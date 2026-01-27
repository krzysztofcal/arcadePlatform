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
try { baseHost = new URL(base).hostname; } catch { console.error(`Invalid BASE url: ${base}`); process.exit(1); }
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
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`fetch_timeout:${FETCH_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
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
  const { res, json, text } = await fetchJson(tokenUrl.toString(), {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const msg = json?.error_description || json?.error || text || res.statusText;
    throw new Error(`supabase_auth_failed:${res.status}:${msg}`);
  }
  if (!json?.access_token) throw new Error("supabase_auth_missing_token");
  return json.access_token;
};

const callJson = async ({ path, method, token, body }) => {
  const url = buildUrl(path);
  const headers = { origin, authorization: `Bearer ${token}` };
  if (body) headers["content-type"] = "application/json";
  return fetchJson(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
};

const assertOk = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertStatus = (res, text, want, label) => {
  if (res.status !== want) {
    const summary = text && text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new Error(`${label} status=${res.status} body=${summary || ""}`.trim());
  }
};

const run = async () => {
  const u1Token = await getSupabaseToken(process.env.U1_EMAIL, process.env.U1_PASS);
  const u2Token = await getSupabaseToken(process.env.U2_EMAIL, process.env.U2_PASS);

  const u1UserId = decodeUserId(u1Token);
  const u2UserId = decodeUserId(u2Token);
  assertOk(u1UserId && u2UserId, "unable to decode user ids from auth tokens");

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
      if (hb.res.status !== 200) {
        const summary = hb.text && hb.text.length > 200 ? `${hb.text.slice(0, 200)}…` : hb.text;
        heartbeatError = new Error(`poker-heartbeat ${label} status=${hb.res.status} body=${summary || ""}`.trim());
      }
    } catch (e) {
      heartbeatError = e;
    }
  };

  const getTable = async (label, token, tableId) => {
    const gt = await callJson({
      path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
      method: "GET",
      token,
    });
    assertStatus(gt.res, gt.text, 200, `poker-get-table ${label}`);
    assertOk(gt.json?.ok === true, `poker-get-table ${label} ok:false`);
    return gt.json;
  };

  try {
    // 1) create table (u1)
    const create = await callJson({
      path: "/.netlify/functions/poker-create-table",
      method: "POST",
      token: u1Token,
      body: { requestId: requestId("create"), stakes: { sb: 1, bb: 2 }, maxPlayers: 6 },
    });
    assertStatus(create.res, create.text, 200, "poker-create-table");
    const tableId = create.json?.tableId;
    assertOk(typeof tableId === "string" && tableId.length > 0, "poker-create-table missing tableId");

    // 2) join seats
    const join1 = await callJson({
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u1Token,
      body: { tableId, seatNo: 0, buyIn: 100, requestId: requestId("join-u1") },
    });
    assertStatus(join1.res, join1.text, 200, "poker-join u1");

    const join2 = await callJson({
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u2Token,
      body: { tableId, seatNo: 1, buyIn: 100, requestId: requestId("join-u2") },
    });
    assertStatus(join2.res, join2.text, 200, "poker-join u2");

    // 3) heartbeats
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);

    timers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), HEARTBEAT_MS));

    // 4) start hand (u1)
    const start = await callJson({
      path: "/.netlify/functions/poker-start-hand",
      method: "POST",
      token: u1Token,
      body: { tableId, requestId: requestId("start") },
    });
    assertStatus(start.res, start.text, 200, "poker-start-hand");
    assertOk(start.json?.ok === true, "poker-start-hand ok:false");

    // 5) PREFLOP assertions (both users have hole cards)
    const tU1_0 = await getTable("u1 pref", u1Token, tableId);
    const tU2_0 = await getTable("u2 pref", u2Token, tableId);

    assertOk(tU1_0?.state?.state?.phase === "PREFLOP", "u1 phase not PREFLOP after start");
    assertOk(tU2_0?.state?.state?.phase === "PREFLOP", "u2 phase not PREFLOP after start");
    assertOk(Array.isArray(tU1_0?.myHoleCards) && tU1_0.myHoleCards.length === 2, "u1 missing hole cards");
    assertOk(Array.isArray(tU2_0?.myHoleCards) && tU2_0.myHoleCards.length === 2, "u2 missing hole cards");

    const v0 = Number(tU1_0?.state?.version);
    assertOk(Number.isFinite(v0), "u1 initial version not numeric");

    const turn0 = tU1_0?.state?.state?.turnUserId;
    assertOk(typeof turn0 === "string" && turn0.length > 0, "missing turnUserId after start");

    const tokenForTurn = (turnUserId) => {
      if (turnUserId === u1UserId) return u1Token;
      if (turnUserId === u2UserId) return u2Token;
      return null;
    };

    // 6) CHECK #1 (by correct user)
    const token1 = tokenForTurn(turn0);
    assertOk(token1, "cannot map turnUserId to u1/u2 token (check test accounts)");
    const act1 = await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: token1,
      body: { tableId, requestId: requestId("check-1"), action: { type: "CHECK" } },
    });
    assertStatus(act1.res, act1.text, 200, "poker-act CHECK #1");
    assertOk(act1.json?.ok === true, "poker-act CHECK #1 ok:false");

    // 7) CHECK #2 (by new turn user)
    const tU1_1 = await getTable("u1 post1", u1Token, tableId);
    const turn1 = tU1_1?.state?.state?.turnUserId;
    assertOk(typeof turn1 === "string" && turn1.length > 0, "missing turnUserId after check #1");

    const token2 = tokenForTurn(turn1);
    assertOk(token2, "cannot map turnUserId (after check #1) to u1/u2 token");

    const act2 = await callJson({
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: token2,
      body: { tableId, requestId: requestId("check-2"), action: { type: "CHECK" } },
    });
    assertStatus(act2.res, act2.text, 200, "poker-act CHECK #2");
    assertOk(act2.json?.ok === true, "poker-act CHECK #2 ok:false");

    // 8) Assert PREFLOP -> FLOP happened
    const tU1_2 = await getTable("u1 post2", u1Token, tableId);
    const tU2_2 = await getTable("u2 post2", u2Token, tableId);

    const v1 = Number(tU1_2?.state?.version);
    assertOk(Number.isFinite(v1) && v1 > v0, "version did not increase after actions");

    assertOk(tU1_2?.state?.state?.phase === "FLOP", `u1 phase expected FLOP got ${tU1_2?.state?.state?.phase}`);
    assertOk(tU2_2?.state?.state?.phase === "FLOP", `u2 phase expected FLOP got ${tU2_2?.state?.state?.phase}`);

    const comm = tU1_2?.state?.state?.community;
    assertOk(Array.isArray(comm) && comm.length === 3, "community expected length 3 on FLOP");

    assertOk(Array.isArray(tU1_2?.myHoleCards) && tU1_2.myHoleCards.length === 2, "u1 lost hole cards");
    assertOk(Array.isArray(tU2_2?.myHoleCards) && tU2_2.myHoleCards.length === 2, "u2 lost hole cards");

    if (heartbeatError) throw heartbeatError;

    const uiLink = `${origin.replace(/\/$/, "")}/poker/table.html?tableId=${encodeURIComponent(tableId)}`;
    console.log(`OK: PREFLOP->FLOP CHECK/CHECK. tableId=${tableId}`);
    console.log(`UI: ${uiLink}`);
  } finally {
    timers.forEach((t) => clearInterval(t));
  }
};

run().catch((e) => {
  console.error("Smoke test failed:", e?.message || e);
  process.exit(1);
});
