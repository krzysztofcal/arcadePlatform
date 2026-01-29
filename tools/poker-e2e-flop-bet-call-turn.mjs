// tools/poker-e2e-flop-bet-call-turn.mjs
import { api, fetchJson, retry, snippet, waitFor } from "./_shared/poker-e2e-http.mjs";
//
// E2E: 2 players
// - PREFLOP: CHECK/CHECK -> FLOP
// - FLOP: BET 5 / CALL -> TURN
// Hard guard against running on production unless POKER_SMOKE_ALLOW_PROD=1
//
// Goals of this version:
// - eliminate flakes: add retries + waitFor (eventual consistency / races)
// - add better error messages + include URL on timeouts
// - do NOT hammer prod: bounded retries, bounded polling

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

  // Supabase auth can also flake transiently -> retry
  return retry(
    "supabase-auth",
    async () => {
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
        throw new Error(`supabase_auth_failed:${res.status}:${snippet(msg, 400)}`);
      }
      if (!json?.access_token) throw new Error("supabase_auth_missing_token");
      return json.access_token;
    },
    { tries: 4, baseDelayMs: 400, maxDelayMs: 2500 }
  );
};

const callJsonOnce = async ({ label, ...req }) => callApi({ label, ...req });

// Higher-level retry for transient HTTP problems / races.
// NOTE: we *don't* retry on 4xx except a small allowlist (408/425/429/409 in some cases handled by callers).
const callJson = async ({ label, ...req }) => {
  const transient = new Set([408, 425, 429, 500, 502, 503, 504]);
  return retry(
    label || `${req.method || "GET"} ${req.path}`,
    async () => {
      const out = await callJsonOnce({ label, ...req });
      if (out.status && out.status !== 200 && transient.has(out.status)) {
        throw new Error(`http_${out.status}:${snippet(out.text)}`);
      }
      return out;
    },
    { tries: 5, baseDelayMs: 350, maxDelayMs: 2500 }
  );
};

const assertOk = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const assertStatus = (status, text, want, label) => {
  if (status !== want) {
    throw new Error(`${label} status=${status} body=${snippet(text, 220)}`.trim());
  }
};

const mustNotLeakPrivate = (payload, label) => {
  const s = JSON.stringify(payload);
  assertOk(!s.includes("holeCardsByUserId"), `${label} leaked holeCardsByUserId`);
  assertOk(!s.includes('"deck"'), `${label} leaked deck`);
  assertOk(!s.includes('"handSeed"'), `${label} leaked handSeed`);
};

const tokenForTurn = (turnUserId, u1TokenV, u2TokenV, u1Id, u2Id) => {
  if (turnUserId === u1Id) return u1TokenV;
  if (turnUserId === u2Id) return u2TokenV;
  return null;
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
        label: `heartbeat:${label}`,
        path: "/.netlify/functions/poker-heartbeat",
        method: "POST",
        token,
        body: { tableId, requestId: requestId(`hb-${label}`) },
      });
      if (hb.status !== 200) {
        heartbeatError = new Error(
          `poker-heartbeat ${label} status=${hb.status} body=${snippet(hb.text, 220)}`.trim()
        );
      }
    } catch (e) {
      heartbeatError = e;
    }
  };

  const getTableOnce = async (label, token, tableId) => {
    const gt = await callJson({
      label: `get-table:${label}`,
      path: `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
      method: "GET",
      token,
    });
    assertStatus(gt.status, gt.text, 200, `poker-get-table ${label}`);
    assertOk(gt.json?.ok === true, `poker-get-table ${label} ok:false`);
    mustNotLeakPrivate(gt.json, `poker-get-table ${label}`);
    return gt.json;
  };

  // In case /poker-get-table itself flakes (timeouts, 5xx), wrap as retry too.
  const getTable = async (label, token, tableId) =>
    retry(
      `get-table:${label}`,
      async () => getTableOnce(label, token, tableId),
      { tries: 5, baseDelayMs: 350, maxDelayMs: 2500 }
    );

  try {
    // 1) create table (u1)
    const create = await callJson({
      label: "create-table",
      path: "/.netlify/functions/poker-create-table",
      method: "POST",
      token: u1Token,
      body: { requestId: requestId("create"), stakes: { sb: 1, bb: 2 }, maxPlayers: 6 },
    });
    assertStatus(create.status, create.text, 200, "poker-create-table");
    const tableId = create.json?.tableId;
    assertOk(typeof tableId === "string" && tableId.length > 0, "poker-create-table missing tableId");

    // 2) join seats
    const join1 = await callJson({
      label: "join-u1",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u1Token,
      body: { tableId, seatNo: 0, buyIn: 100, requestId: requestId("join-u1") },
    });
    assertStatus(join1.status, join1.text, 200, "poker-join u1");

    const join2 = await callJson({
      label: "join-u2",
      path: "/.netlify/functions/poker-join",
      method: "POST",
      token: u2Token,
      body: { tableId, seatNo: 1, buyIn: 100, requestId: requestId("join-u2") },
    });
    assertStatus(join2.status, join2.text, 200, "poker-join u2");

    // 3) heartbeats (once + background)
    await heartbeatOnce("u1", u1Token, tableId);
    await heartbeatOnce("u2", u2Token, tableId);
    timers.push(setInterval(() => void heartbeatOnce("u1", u1Token, tableId), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u2", u2Token, tableId), HEARTBEAT_MS));

    // Wait until both seats are ACTIVE (race-proof)
    await waitFor(
      "seats-active",
      async () => {
        const t = await getTable("pre-start", u1Token, tableId);
        const seats = Array.isArray(t?.seats) ? t.seats : [];
        const activeSeats = seats.filter((s) => s?.status === "ACTIVE");
        return activeSeats.length === 2 ? true : false;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    // 4) start hand (u1) - retry on transient statuses
    const start = await retry(
      "start-hand",
      async (attempt) => {
        const res = await callJsonOnce({
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

        assertOk(res.json?.ok === true, `poker-start-hand ok:false body=${snippet(res.text)}`);
        return res;
      },
      { tries: 6, baseDelayMs: 450, maxDelayMs: 3000 }
    );
    assertStatus(start.status, start.text, 200, "poker-start-hand");

    // 5) wait until PREFLOP is visible and both users have hole cards
    const tU1_0 = await waitFor(
      "table-ready-u1",
      async () => {
        const t = await getTable("u1-ready", u1Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        const seats = Array.isArray(t?.seats) ? t.seats : [];
        const activeSeats = seats.filter((s) => s?.status === "ACTIVE");
        return activeSeats.length === 2 ? t : false;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    await waitFor(
      "table-ready-u2",
      async () => {
        const t = await getTable("u2-ready", u2Token, tableId);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return true;
      },
      { timeoutMs: 25000, pollMs: 700 }
    );

    const v0 = Number(tU1_0?.state?.version);
    assertOk(Number.isFinite(v0), "u1 initial version not numeric");

    // Helper: act with retries for racey conditions (not_your_turn / 409 / 425 / transient http)
    const actWithRetry = async ({ label, action }) =>
      retry(
        `act:${label}`,
        async (attempt) => {
          const current = await getTable(`before-${label}-${attempt}`, u1Token, tableId);
          const who = current?.state?.state?.turnUserId;
          assertOk(typeof who === "string" && who.length > 0, `missing turnUserId before ${label}`);

          const token = tokenForTurn(who, u1Token, u2Token, u1UserId, u2UserId);
          assertOk(token, `cannot map turnUserId=${who} to u1/u2 token before ${label}`);

          const res = await callJsonOnce({
            path: "/.netlify/functions/poker-act",
            method: "POST",
            token,
            body: { tableId, requestId: requestId(`${label}-${attempt}`), action },
          });

          // If the turn advanced between get-table and act, retry.
          if (res.status === 403 && res.json?.error === "not_your_turn") {
            throw new Error("race:not_your_turn");
          }

          // Some backends may use these for concurrency / readiness.
          if ([409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`transient_status:${res.status} body=${snippet(res.text)}`);
          }

          assertStatus(res.status, res.text, 200, `poker-act ${label}`);
          assertOk(res.json?.ok === true, `poker-act ${label} ok:false body=${snippet(res.text)}`);
          mustNotLeakPrivate(res.json, `poker-act ${label}`);
          return res;
        },
        { tries: 7, baseDelayMs: 350, maxDelayMs: 2500 }
      );

    // 6) PREFLOP CHECK/CHECK
    await actWithRetry({ label: "pref-check-1", action: { type: "CHECK" } });
    await actWithRetry({ label: "pref-check-2", action: { type: "CHECK" } });

    // 7) Wait for FLOP
    const tU1_flop = await waitFor(
      "phase-flop",
      async () => {
        const t = await getTable("u1-flop", u1Token, tableId);
        if (t?.state?.state?.phase !== "FLOP") return false;
        const comm = t?.state?.state?.community;
        if (!Array.isArray(comm) || comm.length !== 3) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    await waitFor(
      "phase-flop-u2",
      async () => {
        const t = await getTable("u2-flop", u2Token, tableId);
        if (t?.state?.state?.phase !== "FLOP") return false;
        const comm = t?.state?.state?.community;
        return Array.isArray(comm) && comm.length === 3;
      },
      { timeoutMs: 25000, pollMs: 700 }
    );

    const vF = Number(tU1_flop?.state?.version);
    assertOk(Number.isFinite(vF) && vF > v0, "version did not increase after PREFLOP actions");

    // 8) FLOP BET 5 / CALL
    await actWithRetry({ label: "flop-bet", action: { type: "BET", amount: 5 } });
    await actWithRetry({ label: "flop-call", action: { type: "CALL" } });

    // 9) Wait for TURN
    const tU1_turn = await waitFor(
      "phase-turn",
      async () => {
        const t = await getTable("u1-turn", u1Token, tableId);
        if (t?.state?.state?.phase !== "TURN") return false;
        const comm = t?.state?.state?.community;
        if (!Array.isArray(comm) || comm.length !== 4) return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 30000, pollMs: 650 }
    );

    await waitFor(
      "phase-turn-u2",
      async () => {
        const t = await getTable("u2-turn", u2Token, tableId);
        if (t?.state?.state?.phase !== "TURN") return false;
        const comm = t?.state?.state?.community;
        if (!Array.isArray(comm) || comm.length !== 4) return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return true;
      },
      { timeoutMs: 30000, pollMs: 700 }
    );

    const vT = Number(tU1_turn?.state?.version);
    assertOk(Number.isFinite(vT) && vT > vF, "version did not increase after FLOP BET/CALL");

    if (heartbeatError) throw heartbeatError;

    const uiLink = `${origin.replace(/\/$/, "")}/poker/table.html?tableId=${encodeURIComponent(tableId)}`;
    console.log(`OK: PREFLOP->FLOP CHECK/CHECK then FLOP BET/CALL -> TURN. tableId=${tableId}`);
    console.log(`UI: ${uiLink}`);
  } finally {
    timers.forEach((t) => clearInterval(t));
  }
};

run().catch((e) => {
  console.error("E2E flop-bet-call-turn failed:", e?.message || e);
  process.exit(1);
});
