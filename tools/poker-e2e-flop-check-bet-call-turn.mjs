// tools/poker-e2e-flop-check-bet-call-turn.mjs
import { cleanupPokerTable } from "./_shared/poker-e2e-cleanup.mjs";
import { api, fetchJson, retry, snippet, waitFor } from "./_shared/poker-e2e-http.mjs";
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
const callApi = ({ label, ...req }) => api({ base, origin, label, ...req });
const klog = (line) => {
  try {
    console.warn(line);
  } catch {}
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
  }, { label: "supabase-auth" });
  if (!res.ok || !json?.access_token) {
    throw new Error(`supabase_auth_failed:${res.status}:${text}`);
  }
  return json.access_token;
};

const assertOk = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertStatus = (status, text, want, label) => {
  if (status !== want) {
    throw new Error(`${label} status=${status} body=${snippet(text, 220)}`);
  }
};

(async () => {
  const u1Token = await getSupabaseToken(process.env.U1_EMAIL, process.env.U1_PASS);
  const u2Token = await getSupabaseToken(process.env.U2_EMAIL, process.env.U2_PASS);
  const u1UserId = decodeUserId(u1Token);
  const u2UserId = decodeUserId(u2Token);
  assertOk(u1UserId && u2UserId, "failed to decode user ids");
  const users = [
    { label: "u1", token: u1Token, joined: false },
    { label: "u2", token: u2Token, joined: false },
  ];

  let heartbeatError = null;
  const timers = [];
  let tableId = null;

  const heartbeatOnce = async (label, token, tableId) => {
    try {
      const hb = await callApi({
        label: `heartbeat:${label}`,
        path: "/.netlify/functions/poker-heartbeat",
        method: "POST",
        token,
        body: { tableId, requestId: requestId(`hb-${label}`) },
      });
      if (hb.status !== 200) heartbeatError = new Error(`heartbeat ${label} failed`);
    } catch (e) {
      heartbeatError = e;
    }
  };

  const getTable = async (token, tableId) => {
    const gt = await callApi({
      label: "get-table",
      path: `/.netlify/functions/poker-get-table?tableId=${tableId}&t=${Date.now()}`,
      method: "GET",
      token,
    });
    assertStatus(gt.status, gt.text, 200, "poker-get-table");
    assertOk(gt.json?.ok === true, "get-table ok:false");
    return gt.json;
  };

  let runError = null;
  try {
    // create table
    const create = await callApi({
      label: "create-table",
      path: "/.netlify/functions/poker-create-table",
      method: "POST",
      token: u1Token,
      body: { requestId: requestId("create") },
    });
    assertStatus(create.status, create.text, 200, "create-table");
    tableId = create.json.tableId;

    // join
    users[0].attempted = true;
    const join1 = await callApi({
      label: "join-u1",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u1Token,
      body: { tableId, seatNo: 0, buyIn: 100, requestId: requestId("join1") },
    });
    users[0].joined = join1.status === 200;
    users[1].attempted = true;
    const join2 = await callApi({
      label: "join-u2",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u2Token,
      body: { tableId, seatNo: 1, buyIn: 100, requestId: requestId("join2") },
    });
    users[1].joined = join2.status === 200;

    // heartbeat
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);
    timers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), HEARTBEAT_MS));

    // start hand
    const start = await callApi({
      label: "start-hand",
      path: "/.netlify/functions/poker-start-hand",
      method: "POST",
      token: u1Token,
      body: { tableId, requestId: requestId("start") },
    });
    assertOk(start.json?.ok === true, "start-hand failed");

    // PREFLOP CHECK / CHECK
    let table = await waitFor(
      "pref-ready",
      async () => {
        const t = await getTable(u1Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );
    let turn = table.state.state.turnUserId;
    const tokenFor = (uid) => uid === u1UserId ? u1Token : u2Token;

    await retry(
      "act:pf-check-1",
      async (attempt) => {
        const res = await callApi({
          label: `act:pf-check-1:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: tokenFor(turn),
          body: { tableId, requestId: requestId(`pf-check-1-${attempt}`), action: { type: "CHECK" } },
        });
        if (res.status !== 200 && [409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
          throw new Error(`act pf-check-1 transient status=${res.status}`);
        }
        assertStatus(res.status, res.text, 200, "poker-act pf-check-1");
        assertOk(res.json?.ok === true, "poker-act pf-check-1 ok:false");
        return true;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );

    table = await waitFor(
      "post-pf-check-1",
      async () => {
        const t = await getTable(u1Token, tableId);
        const who = t?.state?.state?.turnUserId;
        return typeof who === "string" && who.length ? t : false;
      },
      { timeoutMs: 20000, pollMs: 600 }
    );
    turn = table.state.state.turnUserId;

    await retry(
      "act:pf-check-2",
      async (attempt) => {
        const res = await callApi({
          label: `act:pf-check-2:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: tokenFor(turn),
          body: { tableId, requestId: requestId(`pf-check-2-${attempt}`), action: { type: "CHECK" } },
        });
        if (res.status !== 200 && [409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
          throw new Error(`act pf-check-2 transient status=${res.status}`);
        }
        assertStatus(res.status, res.text, 200, "poker-act pf-check-2");
        assertOk(res.json?.ok === true, "poker-act pf-check-2 ok:false");
        return true;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );

    // FLOP: CHECK → BET → CALL
    table = await waitFor(
      "phase-flop",
      async () => {
        const t = await getTable(u1Token, tableId);
        const comm = t?.state?.state?.community;
        if (t?.state?.state?.phase !== "FLOP") return false;
        return Array.isArray(comm) && comm.length === 3 ? t : false;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    turn = table.state.state.turnUserId;
    await retry(
      "act:flop-check",
      async (attempt) => {
        const res = await callApi({
          label: `act:flop-check:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: tokenFor(turn),
          body: { tableId, requestId: requestId(`flop-check-${attempt}`), action: { type: "CHECK" } },
        });
        if (res.status !== 200 && [409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
          throw new Error(`act flop-check transient status=${res.status}`);
        }
        assertStatus(res.status, res.text, 200, "poker-act flop-check");
        assertOk(res.json?.ok === true, "poker-act flop-check ok:false");
        return true;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );

    table = await waitFor(
      "post-flop-check",
      async () => {
        const t = await getTable(u1Token, tableId);
        const who = t?.state?.state?.turnUserId;
        return typeof who === "string" && who.length ? t : false;
      },
      { timeoutMs: 20000, pollMs: 600 }
    );
    turn = table.state.state.turnUserId;
    await retry(
      "act:flop-bet",
      async (attempt) => {
        const res = await callApi({
          label: `act:flop-bet:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: tokenFor(turn),
          body: { tableId, requestId: requestId(`flop-bet-${attempt}`), action: { type: "BET", amount: 5 } },
        });
        if (res.status !== 200 && [409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
          throw new Error(`act flop-bet transient status=${res.status}`);
        }
        assertStatus(res.status, res.text, 200, "poker-act flop-bet");
        assertOk(res.json?.ok === true, "poker-act flop-bet ok:false");
        return true;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );

    table = await waitFor(
      "post-flop-bet",
      async () => {
        const t = await getTable(u1Token, tableId);
        const who = t?.state?.state?.turnUserId;
        return typeof who === "string" && who.length ? t : false;
      },
      { timeoutMs: 20000, pollMs: 600 }
    );
    turn = table.state.state.turnUserId;
    await retry(
      "act:flop-call",
      async (attempt) => {
        const res = await callApi({
          label: `act:flop-call:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: tokenFor(turn),
          body: { tableId, requestId: requestId(`flop-call-${attempt}`), action: { type: "CALL" } },
        });
        if (res.status !== 200 && [409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
          throw new Error(`act flop-call transient status=${res.status}`);
        }
        assertStatus(res.status, res.text, 200, "poker-act flop-call");
        assertOk(res.json?.ok === true, "poker-act flop-call ok:false");
        return true;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );

    table = await waitFor(
      "phase-turn",
      async () => {
        const t = await getTable(u1Token, tableId);
        const comm = t?.state?.state?.community;
        if (t?.state?.state?.phase !== "TURN") return false;
        return Array.isArray(comm) && comm.length === 4 ? t : false;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    if (heartbeatError) throw heartbeatError;

    console.log(`OK: PREFLOP->FLOP CHECK/CHECK then FLOP CHECK/BET/CALL -> TURN. tableId=${tableId}`);
    console.log(`UI: ${origin.replace(/\/$/, "")}/poker/table.html?tableId=${tableId}`);
  } catch (e) {
    runError = e;
  } finally {
    await cleanupPokerTable({
      baseUrl: base,
      origin,
      tableId,
      users,
      timers,
      klog,
    });
  }
  if (runError) {
    console.error("Smoke test failed:", runError.message || runError);
    process.exit(1);
  }
})();
