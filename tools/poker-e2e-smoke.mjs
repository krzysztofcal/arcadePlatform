/* tools/poker-e2e-smoke.mjs */
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

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
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
    const message = json?.error_description || json?.error || text || res.statusText;
    throw new Error(`supabase_auth_failed:${res.status}:${snippet(message, 400)}`);
  }
  if (!json?.access_token) throw new Error("supabase_auth_missing_token");
  return json.access_token;
};

const callJsonOnce = async ({ label, ...req }) => callApi({ label, ...req });

const assertOk = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertResponse = (status, text, expectedStatus, label) => {
  if (status !== expectedStatus) {
    throw new Error(`${label} status=${status} body=${snippet(text)}`.trim());
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
  let tableId = null;
  const users = [
    { label: "u1", token: u1Token, joined: false },
    { label: "u2", token: u2Token, joined: false },
  ];

  const heartbeatOnce = async (label, token, activeTableId) => {
    try {
      const hb = await callApi({
        label: `heartbeat:${label}`,
        path: "/.netlify/functions/poker-heartbeat",
        method: "POST",
        token,
        body: { tableId: activeTableId, requestId: requestId(`hb-${label}`) },
      });

      if (hb.status !== 200) {
        heartbeatError = new Error(
          `poker-heartbeat ${label} status=${hb.status} body=${snippet(hb.text)}`
        );
      }
    } catch (err) {
      heartbeatError = err;
    }
  };

  let runError = null;
  try {
    const create = await callApi({
      label: "create-table",
      path: "/.netlify/functions/poker-create-table",
      method: "POST",
      token: u1Token,
      body: { requestId: requestId("create"), stakes: { sb: 1, bb: 2 }, maxPlayers: 6 },
    });
    assertResponse(create.status, create.text, 200, "poker-create-table");

    tableId = create.json?.tableId;
    assertOk(typeof tableId === "string" && tableId.length > 0, "poker-create-table missing tableId");

    const joinU1 = await callApi({
      label: "join-u1",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u1Token,
      body: { tableId, seatNo: 0, buyIn: 100, requestId: requestId("join-u1") },
    });
    assertResponse(joinU1.status, joinU1.text, 200, "poker-join u1");
    users[0].joined = true;

    const joinU2 = await callApi({
      label: "join-u2",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u2Token,
      body: { tableId, seatNo: 1, buyIn: 100, requestId: requestId("join-u2") },
    });
    assertResponse(joinU2.status, joinU2.text, 200, "poker-join u2");
    users[1].joined = true;

    // Start heartbeat loops (keeps seats alive)
    heartbeatTimers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), HEARTBEAT_MS));
    heartbeatTimers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), HEARTBEAT_MS));

    // One immediate heartbeat
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);

    // Wait until both seats are ACTIVE (race-proof)
    await waitFor(
      "seats-active",
      async () => {
        const t = await callApi({
          label: "get-table:pre-start",
          path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
          method: "GET",
          token: u1Token,
        });
        if (t.status !== 200) throw new Error(`get-table pre-start status=${t.status}`);
        if (t.json?.ok !== true) return false;

        const seats = Array.isArray(t.json?.seats) ? t.json.seats : [];
        const activeSeats = seats.filter((s) => s?.status === "ACTIVE");
        return activeSeats.length === 2;
      },
      { timeoutMs: 25000, pollMs: 600 }
    );

    // Retry start-hand (can race with join propagation / seat activity)
    const startHand = await retry(
      "start-hand",
      async (attempt) => {
        const res = await callJsonOnce({
          path: "/.netlify/functions/poker-start-hand",
          method: "POST",
          token: u1Token,
          body: { tableId, requestId: requestId(`start-hand-${attempt}`) },
        });
        // treat 409/425/503 as transient
        if (![200].includes(res.status)) {
          if ([409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`start-hand transient status=${res.status} body=${snippet(res.text)}`);
          }
          assertResponse(res.status, res.text, 200, "poker-start-hand");
        }
        assertOk(res.json?.ok === true, `poker-start-hand ok:false body=${snippet(res.text)}`);
        return res;
      },
      { tries: 6, baseDelayMs: 450, maxDelayMs: 3000 }
    );

    assertResponse(startHand.status, startHand.text, 200, "poker-start-hand");

    const getTable = async (label, token) => {
      const url = `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`;
      const result = await callApi({ label: `get-table:${label}`, path: url, method: "GET", token });
      assertResponse(result.status, result.text, 200, `poker-get-table ${label}`);

      const payload = result.json;
      assertOk(payload?.ok === true, `poker-get-table ${label} ok:false`);
      const seats = Array.isArray(payload?.seats) ? payload.seats : [];
      const activeSeats = seats.filter((seat) => seat?.status === "ACTIVE");
      assertOk(activeSeats.length === 2, `poker-get-table ${label} expected 2 active seats`);

      assertOk(
        Array.isArray(payload?.myHoleCards) && payload.myHoleCards.length === 2,
        `poker-get-table ${label} missing hole cards`
      );

      return payload;
    };

    // Wait until PREFLOP is visible + hole cards present (eventual consistency)
    const tableU1 = await waitFor(
      "table-ready-u1",
      async () => {
        const t = await callApi({
          label: "get-table:u1-ready",
          path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
          method: "GET",
          token: u1Token,
        });
        if (t.status !== 200) return false;
        if (t.json?.ok !== true) return false;
        if (t.json?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t.json?.myHoleCards) || t.json.myHoleCards.length !== 2) return false;
        const seats = Array.isArray(t.json?.seats) ? t.json.seats : [];
        const activeSeats = seats.filter((s) => s?.status === "ACTIVE");
        if (activeSeats.length !== 2) return false;
        return t.json;
      },
      { timeoutMs: 25000, pollMs: 600 }
    );

    // also ensure u2 can read and has hole cards
    await waitFor(
      "table-ready-u2",
      async () => {
        const t = await callApi({
          label: "get-table:u2-ready",
          path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
          method: "GET",
          token: u2Token,
        });
        if (t.status !== 200) return false;
        if (t.json?.ok !== true) return false;
        if (t.json?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t.json?.myHoleCards) || t.json.myHoleCards.length !== 2) return false;
        return true;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    const turnUserId = tableU1?.state?.state?.turnUserId;
    assertOk(typeof turnUserId === "string" && turnUserId.length > 0, "poker-get-table missing turnUserId");

    const tokenByUserId = (uid) => (uid === u1UserId ? u1Token : uid === u2UserId ? u2Token : null);

    // Determine current actor, and if it changes due to races, re-fetch and retry
    const actCheck = await retry(
      "act-check",
      async (attempt) => {
        const current = await callApi({
          label: `get-table:before-act-${attempt}`,
          path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
          method: "GET",
          token: u1Token,
        });
        assertResponse(current.status, current.text, 200, "poker-get-table before-act");
        assertOk(current.json?.ok === true, "poker-get-table before-act ok:false");

        const who = current.json?.state?.state?.turnUserId;
        const actionToken = tokenByUserId(who);
        assertOk(actionToken, `cannot resolve token for turnUserId=${who}`);

        const res = await callJsonOnce({
          path: "/.netlify/functions/poker-act",
          method: "POST",
          token: actionToken,
          body: { tableId, requestId: requestId(`act-check-${attempt}`), action: { type: "CHECK" } },
        });

        // not_your_turn can happen if turn advanced between get-table and act; retry
        if (res.status === 403 && res.json?.error === "not_your_turn") {
          throw new Error(`race:not_your_turn`);
        }
        if (res.status === 409 || res.status === 425) {
          throw new Error(`race:status_${res.status}`);
        }

        assertResponse(res.status, res.text, 200, "poker-act CHECK");
        assertOk(res.json?.ok === true, "poker-act CHECK did not return ok:true");
        return res;
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );

    void actCheck; // keep lint calm if you add lint later

    const tableU1After = await callApi({
      label: "get-table:post-act",
      path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
      method: "GET",
      token: u1Token,
    });
    assertResponse(tableU1After.status, tableU1After.text, 200, "poker-get-table u1 post-act");
    assertOk(tableU1After.json?.ok === true, "poker-get-table u1 post-act ok:false");

    const v0 = Number(tableU1?.state?.version);
    const v1 = Number(tableU1After.json?.state?.version);
    assertOk(Number.isFinite(v0) && Number.isFinite(v1) && v1 > v0, "post-act version did not increase");

    if (heartbeatError) throw heartbeatError;

    const uiLink = `${origin.replace(/\/$/, "")}/poker/table.html?tableId=${encodeURIComponent(tableId)}`;
    console.log(`Smoke test complete. tableId=${tableId}`);
    console.log(`UI: ${uiLink}`);
  } catch (err) {
    runError = err;
  } finally {
    await cleanupPokerTable({
      baseUrl: base,
      origin,
      tableId,
      users,
      timers: heartbeatTimers,
      klog,
    });
  }
  if (runError) throw runError;
};

run().catch((err) => {
  console.error("Smoke test failed:", err?.message || err);
  process.exit(1);
});
