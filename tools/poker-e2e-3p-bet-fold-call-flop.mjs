/**
 * E2E smoke: 3 players, PREFLOP BET / FOLD / CALL -> FLOP
 *
 * Purpose:
 * - Verifies betting-round completion logic with a fold in-between
 * - Ensures street advances only after all eligible players acted and owe 0
 * - Ensures community cards count is correct and no private fields leak
 *
 * Safety:
 * - Refuses to run against play.kcswh.pl unless POKER_SMOKE_ALLOW_PROD=1
 */
import { cleanupPokerTable } from "./_shared/poker-e2e-cleanup.mjs";
import { api, fetchJson, snippet, waitFor } from "./_shared/poker-e2e-http.mjs";

const REQUIRED_ENV = [
  "BASE",
  "ORIGIN",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "U1_EMAIL",
  "U1_PASS",
  "U2_EMAIL",
  "U2_PASS",
  "U3_EMAIL",
  "U3_PASS",
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

const requestId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const callApi = ({ label, ...req }) => api({ base, origin, label, ...req });
const klog = (line) => {
  try {
    console.warn(line);
  } catch {}
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
  }, { label: "supabase-auth" });
  if (!res.ok) {
    const msg = json?.error_description || json?.error || text || res.statusText;
    throw new Error(`supabase_auth_failed:${res.status}:${msg}`);
  }
  if (!json?.access_token) throw new Error("supabase_auth_missing_token");
  return json.access_token;
};

const assertOk = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const assertStatus = (status, text, want, label) => {
  if (status !== want) {
    throw new Error(`${label} status=${status} body=${snippet(text, 220)}`.trim());
  }
};

const hasPrivateLeak = (obj) => {
  const s = JSON.stringify(obj);
  return s.includes('"holeCardsByUserId"') || s.includes('"deck"') || s.includes('"handSeed"');
};

const run = async () => {
  const u1Token = await getSupabaseToken(process.env.U1_EMAIL, process.env.U1_PASS);
  const u2Token = await getSupabaseToken(process.env.U2_EMAIL, process.env.U2_PASS);
  const u3Token = await getSupabaseToken(process.env.U3_EMAIL, process.env.U3_PASS);

  const u1UserId = decodeUserId(u1Token);
  const u2UserId = decodeUserId(u2Token);
  const u3UserId = decodeUserId(u3Token);
  assertOk(u1UserId && u2UserId && u3UserId, "unable to decode user ids from auth tokens");

  let heartbeatError = null;
  const timers = [];
  let tableId = null;
  const users = [
    { label: "u1", token: u1Token, joined: false },
    { label: "u2", token: u2Token, joined: false },
    { label: "u3", token: u3Token, joined: false },
  ];

  const heartbeatOnce = async (label, token, tableId) => {
    try {
      const hb = await callApi({
        label: `heartbeat:${label}`,
        path: "/.netlify/functions/poker-heartbeat",
        method: "POST",
        token,
        body: { tableId, requestId: requestId(`hb-${label}`) },
      });
      if (hb.status !== 200) {
        heartbeatError = new Error(`poker-heartbeat ${label} status=${hb.status} body=${snippet(hb.text, 220)}`.trim());
      }
    } catch (e) {
      heartbeatError = e;
    }
  };

  const getTable = async (label, token, tableId) => {
    const gt = await callApi({
      label: `get-table:${label}`,
      path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
      method: "GET",
      token,
    });
    assertStatus(gt.status, gt.text, 200, `poker-get-table ${label}`);
    assertOk(gt.json?.ok === true, `poker-get-table ${label} ok:false`);
    assertOk(!hasPrivateLeak(gt.json), `poker-get-table ${label} leaked private fields`);
    return gt.json;
  };

  const tokenForTurn = (turnUserId) => {
    if (turnUserId === u1UserId) return u1Token;
    if (turnUserId === u2UserId) return u2Token;
    if (turnUserId === u3UserId) return u3Token;
    return null;
  };

  let runError = null;
  try {
    // 1) create table (u1)
    const create = await callApi({
      label: "create-table",
      path: "/.netlify/functions/poker-create-table",
      method: "POST",
      token: u1Token,
      body: { requestId: requestId("create"), stakes: { sb: 1, bb: 2 }, maxPlayers: 6 },
    });
    assertStatus(create.status, create.text, 200, "poker-create-table");
    tableId = create.json?.tableId;
    assertOk(typeof tableId === "string" && tableId.length > 0, "poker-create-table missing tableId");

    // 2) join seats (0,1,2)
    const join1 = await callApi({
      label: "join-u1",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u1Token,
      body: { tableId, seatNo: 0, buyIn: 100, requestId: requestId("join-u1") },
    });
    assertStatus(join1.status, join1.text, 200, "poker-join u1");
    users[0].joined = true;

    const join2 = await callApi({
      label: "join-u2",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u2Token,
      body: { tableId, seatNo: 1, buyIn: 100, requestId: requestId("join-u2") },
    });
    assertStatus(join2.status, join2.text, 200, "poker-join u2");
    users[1].joined = true;

    const join3 = await callApi({
      label: "join-u3",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u3Token,
      body: { tableId, seatNo: 2, buyIn: 100, requestId: requestId("join-u3") },
    });
    assertStatus(join3.status, join3.text, 200, "poker-join u3");
    users[2].joined = true;

    // 3) heartbeats
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);
    await heartbeatOnce("u3", u3Token, tableId);

    timers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u3", u3Token, tableId), HEARTBEAT_MS));

    // 4) start hand (u1)
    const start = await callApi({
      label: "start-hand",
      path: "/.netlify/functions/poker-start-hand",
      method: "POST",
      token: u1Token,
      body: { tableId, requestId: requestId("start") },
    });
    assertStatus(start.status, start.text, 200, "poker-start-hand");
    assertOk(start.json?.ok === true, "poker-start-hand ok:false");

    // 5) PREFLOP assertions (all have hole cards)
    const t1_0 = await waitFor(
      "pref-ready-u1",
      async () => {
        const t = await getTable("u1 pref", u1Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );
    const t2_0 = await waitFor(
      "pref-ready-u2",
      async () => {
        const t = await getTable("u2 pref", u2Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );
    const t3_0 = await waitFor(
      "pref-ready-u3",
      async () => {
        const t = await getTable("u3 pref", u3Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    const v0 = Number(t1_0?.state?.version);
    assertOk(Number.isFinite(v0), "u1 initial version not numeric");

    // 6) PREFLOP BET (by current turn user)
    const turn0 = t1_0?.state?.state?.turnUserId;
    assertOk(typeof turn0 === "string" && turn0.length > 0, "missing turnUserId after start");

    const betToken = tokenForTurn(turn0);
    assertOk(betToken, "cannot map turnUserId to u1/u2/u3 token");

    const bet = await callApi({
      label: "act-bet",
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: betToken,
      body: { tableId, requestId: requestId("bet"), action: { type: "BET", amount: 5 } },
    });
    assertStatus(bet.status, bet.text, 200, "poker-act PREFLOP BET");
    assertOk(bet.json?.ok === true, "poker-act PREFLOP BET ok:false");
    assertOk(!hasPrivateLeak(bet.json), "poker-act BET leaked private fields");

    // 7) Next turn -> FOLD (by current turn user)
    const tAfterBet = await waitFor(
      "post-bet",
      async () => {
        const t = await getTable("u1 after bet", u1Token, tableId);
        const who = t?.state?.state?.turnUserId;
        return typeof who === "string" && who.length ? t : false;
      },
      { timeoutMs: 20000, pollMs: 600 }
    );
    const turn1 = tAfterBet?.state?.state?.turnUserId;
    assertOk(typeof turn1 === "string" && turn1.length > 0, "missing turnUserId after BET");

    const foldToken = tokenForTurn(turn1);
    assertOk(foldToken, "cannot map turnUserId (after BET) to token");
    const fold = await callApi({
      label: "act-fold",
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: foldToken,
      body: { tableId, requestId: requestId("fold"), action: { type: "FOLD" } },
    });
    assertStatus(fold.status, fold.text, 200, "poker-act PREFLOP FOLD");
    assertOk(fold.json?.ok === true, "poker-act PREFLOP FOLD ok:false");
    assertOk(!hasPrivateLeak(fold.json), "poker-act FOLD leaked private fields");

    // 8) Next turn -> CALL (by current turn user)
    const tAfterFold = await waitFor(
      "post-fold",
      async () => {
        const t = await getTable("u1 after fold", u1Token, tableId);
        const who = t?.state?.state?.turnUserId;
        return typeof who === "string" && who.length ? t : false;
      },
      { timeoutMs: 20000, pollMs: 600 }
    );
    const turn2 = tAfterFold?.state?.state?.turnUserId;
    assertOk(typeof turn2 === "string" && turn2.length > 0, "missing turnUserId after FOLD");

    const callToken = tokenForTurn(turn2);
    assertOk(callToken, "cannot map turnUserId (after FOLD) to token");
    const call = await callApi({
      label: "act-call",
      path: "/.netlify/functions/poker-act",
      method: "POST",
      token: callToken,
      body: { tableId, requestId: requestId("call"), action: { type: "CALL" } },
    });
    assertStatus(call.status, call.text, 200, "poker-act PREFLOP CALL");
    assertOk(call.json?.ok === true, "poker-act PREFLOP CALL ok:false");
    assertOk(!hasPrivateLeak(call.json), "poker-act CALL leaked private fields");

    // 9) Assert PREFLOP -> FLOP
    const t1_end = await waitFor(
      "pref-to-flop-u1",
      async () => {
        const t = await getTable("u1 end", u1Token, tableId);
        const comm = t?.state?.state?.community;
        if (t?.state?.state?.phase !== "FLOP") return false;
        return Array.isArray(comm) && comm.length === 3 ? t : false;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );
    const t2_end = await waitFor(
      "pref-to-flop-u2",
      async () => {
        const t = await getTable("u2 end", u2Token, tableId);
        const comm = t?.state?.state?.community;
        if (t?.state?.state?.phase !== "FLOP") return false;
        return Array.isArray(comm) && comm.length === 3 ? t : false;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );
    const t3_end = await waitFor(
      "pref-to-flop-u3",
      async () => {
        const t = await getTable("u3 end", u3Token, tableId);
        const comm = t?.state?.state?.community;
        if (t?.state?.state?.phase !== "FLOP") return false;
        return Array.isArray(comm) && comm.length === 3 ? t : false;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    const v1 = Number(t1_end?.state?.version);
    assertOk(Number.isFinite(v1) && v1 > v0, "version did not increase after actions");

    const comm = t1_end?.state?.state?.community;
    assertOk(Array.isArray(comm) && comm.length === 3, "community expected length 3 on FLOP");

    // folded user should have 0 hole cards if they are no longer ACTIVE seat in UI payload,
    // but your API currently returns myHoleCards for the requesting user even if folded; we only assert "still 2" for u1/u2/u3.
    assertOk(Array.isArray(t1_end?.myHoleCards) && t1_end.myHoleCards.length === 2, "u1 lost hole cards");
    assertOk(Array.isArray(t2_end?.myHoleCards) && t2_end.myHoleCards.length === 2, "u2 lost hole cards");
    assertOk(Array.isArray(t3_end?.myHoleCards) && t3_end.myHoleCards.length === 2, "u3 lost hole cards");

    if (heartbeatError) throw heartbeatError;

    const uiLink = `${origin.replace(/\/$/, "")}/poker/table.html?tableId=${encodeURIComponent(tableId)}`;
    console.log(`OK: 3P PREFLOP BET/FOLD/CALL -> FLOP. tableId=${tableId}`);
    console.log(`UI: ${uiLink}`);
  } catch (err) {
    runError = err;
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
  if (runError) throw runError;
};

run().catch((e) => {
  console.error("Smoke test failed:", e?.message || e);
  process.exit(1);
});
