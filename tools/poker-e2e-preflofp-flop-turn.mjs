// tools/poker-e2e-flop-turn.mjs
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

const assertNoPrivate = (payload, label) => {
  const text = JSON.stringify(payload || {});
  assertOk(!text.includes("holeCardsByUserId"), `${label} leaked holeCardsByUserId`);
  assertOk(!text.includes('"deck"'), `${label} leaked deck`);
  assertOk(!text.includes('"handSeed"'), `${label} leaked handSeed`);
};

const run = async () => {
  const u1Token = await getSupabaseToken(process.env.U1_EMAIL, process.env.U1_PASS);
  const u2Token = await getSupabaseToken(process.env.U2_EMAIL, process.env.U2_PASS);

  const u1UserId = decodeUserId(u1Token);
  const u2UserId = decodeUserId(u2Token);
  assertOk(u1UserId && u2UserId, "unable to decode user ids from auth tokens");

  let heartbeatError = null;
  const timers = [];
  let tableId = null;
  const users = [
    { label: "u1", token: u1Token, joined: false },
    { label: "u2", token: u2Token, joined: false },
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
    return gt.json;
  };

  const tokenForTurn = (turnUserId) => {
    if (turnUserId === u1UserId) return u1Token;
    if (turnUserId === u2UserId) return u2Token;
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

    // 2) join seats
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

    // 3) heartbeats
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);

    timers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), HEARTBEAT_MS));

    // 4) start hand (u1)
    const start = await retry(
      "start-hand",
      async (attempt) => {
        const res = await callApi({
          label: `start-hand:${attempt}`,
          path: "/.netlify/functions/poker-start-hand",
          method: "POST",
          token: u1Token,
          body: { tableId, requestId: requestId(`start-${attempt}`) },
        });
        if (res.status !== 200) {
          if ([409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`start-hand transient status=${res.status} body=${snippet(res.text)}`);
          }
          assertStatus(res.status, res.text, 200, "poker-start-hand");
        }
        assertOk(res.json?.ok === true, "poker-start-hand ok:false");
        return res;
      },
      { tries: 6, baseDelayMs: 450, maxDelayMs: 3000 }
    );
    assertStatus(start.status, start.text, 200, "poker-start-hand");
    assertNoPrivate(start.json, "poker-start-hand response");

    // 5) PREFLOP assertions (both users have hole cards)
    const tU1_0 = await waitFor(
      "pref-ready-u1",
      async () => {
        const t = await getTable("u1 pref", u1Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 90000, pollMs: 650 }
    );
    const tU2_0 = await waitFor(
      "pref-ready-u2",
      async () => {
        const t = await getTable("u2 pref", u2Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );
    assertNoPrivate(tU1_0, "u1 PREFLOP payload");
    assertNoPrivate(tU2_0, "u2 PREFLOP payload");

    const v0 = Number(tU1_0?.state?.version);
    assertOk(Number.isFinite(v0), "u1 initial version not numeric");

    const turn0 = tU1_0?.state?.state?.turnUserId;
    assertOk(typeof turn0 === "string" && turn0.length > 0, "missing turnUserId after start");

    // 6) CHECK #1 (by correct user)
    const token1 = tokenForTurn(turn0);
    assertOk(token1, "cannot map turnUserId to u1/u2 token (check test accounts)");
    const act1 = await retry(
      "act:CHECK-1",
      async (attempt) => {
        const res = await callApi({
          label: `act:CHECK-1:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: token1,
          body: { tableId, requestId: requestId(`check-1-${attempt}`), action: { type: "CHECK" } },
        });
        if (res.status !== 200) {
          if ([409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`act CHECK-1 transient status=${res.status} body=${snippet(res.text)}`);
          }
          assertStatus(res.status, res.text, 200, "poker-act CHECK #1");
        }
        assertOk(res.json?.ok === true, "poker-act CHECK #1 ok:false");
        return res;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );
    assertStatus(act1.status, act1.text, 200, "poker-act CHECK #1");
    assertNoPrivate(act1.json, "act CHECK #1 response");

    // 7) CHECK #2 (by new turn user)
    const tU1_1 = await waitFor(
      "post-check-1",
      async () => {
        const t = await getTable("u1 post1", u1Token, tableId);
        const turn = t?.state?.state?.turnUserId;
        if (typeof turn !== "string" || !turn.length) return false;
        return t;
      },
      { timeoutMs: 20000, pollMs: 600 }
    );
    const turn1 = tU1_1?.state?.state?.turnUserId;
    assertOk(typeof turn1 === "string" && turn1.length > 0, "missing turnUserId after check #1");

    const token2 = tokenForTurn(turn1);
    assertOk(token2, "cannot map turnUserId (after check #1) to u1/u2 token");

    const act2 = await retry(
      "act:CHECK-2",
      async (attempt) => {
        const res = await callApi({
          label: `act:CHECK-2:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: token2,
          body: { tableId, requestId: requestId(`check-2-${attempt}`), action: { type: "CHECK" } },
        });
        if (res.status !== 200) {
          if ([409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`act CHECK-2 transient status=${res.status} body=${snippet(res.text)}`);
          }
          assertStatus(res.status, res.text, 200, "poker-act CHECK #2");
        }
        assertOk(res.json?.ok === true, "poker-act CHECK #2 ok:false");
        return res;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );
    assertStatus(act2.status, act2.text, 200, "poker-act CHECK #2");
    assertNoPrivate(act2.json, "act CHECK #2 response");

    // 8) Assert PREFLOP -> FLOP happened
    const tU1_2 = await waitFor(
      "pref-to-flop-u1",
      async () => {
        const t = await getTable("u1 post2", u1Token, tableId);
        if (t?.state?.state?.phase !== "FLOP") return false;
        const comm = t?.state?.state?.community;
        if (!Array.isArray(comm) || comm.length !== 3) return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    const tU2_2 = await waitFor(
      "pref-to-flop-u2",
      async () => {
        const t = await getTable("u2 post2", u2Token, tableId);
        if (t?.state?.state?.phase !== "FLOP") return false;
        const comm = t?.state?.state?.community;
        if (!Array.isArray(comm) || comm.length !== 3) return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    const v1 = Number(tU1_2?.state?.version);
    assertOk(Number.isFinite(v1) && v1 > v0, "version did not increase after actions");

    assertNoPrivate(tU1_2, "u1 FLOP payload");
    assertNoPrivate(tU2_2, "u2 FLOP payload");

    // 9) FLOP: CHECK #1 (by current turn user)
    const flopTurn0 = tU1_2?.state?.state?.turnUserId;
    assertOk(typeof flopTurn0 === "string" && flopTurn0.length > 0, "missing turnUserId on FLOP");
    const flopToken1 = tokenForTurn(flopTurn0);
    assertOk(flopToken1, "cannot map FLOP turnUserId to u1/u2 token");

    const flopAct1 = await retry(
      "act:FLOP-CHECK-1",
      async (attempt) => {
        const res = await callApi({
          label: `act:FLOP-CHECK-1:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: flopToken1,
          body: { tableId, requestId: requestId(`flop-check-1-${attempt}`), action: { type: "CHECK" } },
        });
        if (res.status !== 200) {
          if ([409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`act FLOP CHECK-1 transient status=${res.status} body=${snippet(res.text)}`);
          }
          assertStatus(res.status, res.text, 200, "poker-act FLOP CHECK #1");
        }
        assertOk(res.json?.ok === true, "poker-act FLOP CHECK #1 ok:false");
        return res;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );
    assertStatus(flopAct1.status, flopAct1.text, 200, "poker-act FLOP CHECK #1");
    assertNoPrivate(flopAct1.json, "act FLOP CHECK #1 response");

    // 10) FLOP: CHECK #2 (by next turn user)
    const tU1_3 = await waitFor(
      "post-flop-check-1",
      async () => {
        const t = await getTable("u1 flop post1", u1Token, tableId);
        const turn = t?.state?.state?.turnUserId;
        if (typeof turn !== "string" || !turn.length) return false;
        return t;
      },
      { timeoutMs: 20000, pollMs: 600 }
    );
    const flopTurn1 = tU1_3?.state?.state?.turnUserId;
    assertOk(typeof flopTurn1 === "string" && flopTurn1.length > 0, "missing turnUserId after FLOP check #1");
    const flopToken2 = tokenForTurn(flopTurn1);
    assertOk(flopToken2, "cannot map turnUserId (after FLOP check #1) to u1/u2 token");

    const flopAct2 = await retry(
      "act:FLOP-CHECK-2",
      async (attempt) => {
        const res = await callApi({
          label: `act:FLOP-CHECK-2:${attempt}`,
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: flopToken2,
          body: { tableId, requestId: requestId(`flop-check-2-${attempt}`), action: { type: "CHECK" } },
        });
        if (res.status !== 200) {
          if ([409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`act FLOP CHECK-2 transient status=${res.status} body=${snippet(res.text)}`);
          }
          assertStatus(res.status, res.text, 200, "poker-act FLOP CHECK #2");
        }
        assertOk(res.json?.ok === true, "poker-act FLOP CHECK #2 ok:false");
        return res;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );
    assertStatus(flopAct2.status, flopAct2.text, 200, "poker-act FLOP CHECK #2");
    assertNoPrivate(flopAct2.json, "act FLOP CHECK #2 response");

    // 11) Assert FLOP -> TURN happened
    const tU1_4 = await waitFor(
      "flop-to-turn-u1",
      async () => {
        const t = await getTable("u1 turn", u1Token, tableId);
        if (t?.state?.state?.phase !== "TURN") return false;
        const comm = t?.state?.state?.community;
        if (!Array.isArray(comm) || comm.length !== 4) return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    const tU2_4 = await waitFor(
      "flop-to-turn-u2",
      async () => {
        const t = await getTable("u2 turn", u2Token, tableId);
        if (t?.state?.state?.phase !== "TURN") return false;
        const comm = t?.state?.state?.community;
        if (!Array.isArray(comm) || comm.length !== 4) return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    assertNoPrivate(tU1_4, "u1 TURN payload");
    assertNoPrivate(tU2_4, "u2 TURN payload");

    if (heartbeatError) throw heartbeatError;

    const uiLink = `${origin.replace(/\/$/, "")}/poker/table.html?tableId=${encodeURIComponent(tableId)}`;
    console.log(`OK: PREFLOP->FLOP->TURN CHECK/CHECK then CHECK/CHECK. tableId=${tableId}`);
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
