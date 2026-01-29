// tools/poker-e2e-termux.mjs
import { createClient } from "@supabase/supabase-js";
import { api, retry, snippet, waitFor } from "./_shared/poker-e2e-http.mjs";

const {
  BASE,
  ORIGIN,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  U1_EMAIL,
  U1_PASS,
  U2_EMAIL,
  U2_PASS,
} = process.env;

const must = (k) => {
  if (!process.env[k] || !String(process.env[k]).trim()) throw new Error(`Missing env: ${k}`);
  return process.env[k];
};

["BASE", "ORIGIN", "SUPABASE_URL", "SUPABASE_ANON_KEY", "U1_EMAIL", "U1_PASS", "U2_EMAIL", "U2_PASS"].forEach(must);

const HEARTBEAT_MS = 15000;
const MAX_FETCH_TRIES = 5;

const rid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;


const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function login(email, password) {
  // supabase-js already retries internally sometimes, but we wrap anyway because CI flakiness happens.
  return retry(
    `login:${email}`,
    async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`login failed for ${email}: ${error.message}`);
      const token = data?.session?.access_token;
      if (!token) throw new Error(`login: no access_token for ${email}`);
      return token;
    },
    { tries: 4, baseDelayMs: 400, maxDelayMs: 2000 }
  );
}

async function apiCall(method, path, token, body, { label } = {}) {
  return api({
    base: BASE,
    origin: ORIGIN,
    method,
    path,
    token,
    body,
    label: label || `${method} ${path}`,
    tries: MAX_FETCH_TRIES,
  });
}

const assertOk = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const assertStatus = (status, text, want, label) => {
  if (status !== want) throw new Error(`${label} status=${status} body=${snippet(text)}`.trim());
};

async function main() {
  const t1 = await login(U1_EMAIL, U1_PASS);
  const t2 = await login(U2_EMAIL, U2_PASS);

  // 1) create table (user1)
  const create = await apiCall("POST", "/.netlify/functions/poker-create-table", t1, { requestId: rid("create") }, { label: "create-table" });
  assertStatus(create.status, create.text, 200, "create-table");
  assertOk(create.json?.tableId, `create-table missing tableId body=${snippet(create.text)}`);

  const tableId = create.json.tableId;
  console.log("tableId=", tableId);

  let heartbeatError = null;
  const timers = [];

  const heartbeatOnce = async (label, token) => {
    try {
      const hb = await apiCall(
        "POST",
        "/.netlify/functions/poker-heartbeat",
        token,
        { tableId, requestId: rid(`hb-${label}`) },
        { label: `heartbeat:${label}` }
      );
      if (hb.status !== 200) heartbeatError = new Error(`heartbeat ${label} status=${hb.status} body=${snippet(hb.text)}`);
    } catch (e) {
      heartbeatError = e;
    }
  };

  const getTable = async (label, token) => {
    // add cache-buster to avoid edge caching weirdness
    const gt = await apiCall(
      "GET",
      `/.netlify/functions/poker-get-table?tableId=${encodeURIComponent(tableId)}&t=${Date.now()}`,
      token,
      null,
      { label: `get-table:${label}` }
    );
    assertStatus(gt.status, gt.text, 200, `get-table ${label}`);
    assertOk(gt.json?.ok === true, `get-table ${label} ok:false body=${snippet(gt.text)}`);
    return gt.json;
  };

  try {
    // 2) join seat 0 (user1) + seat 1 (user2)
    const join1 = await apiCall(
      "POST",
      "/.netlify/functions/poker-join",
      t1,
      { tableId, seatNo: 0, buyIn: 100, requestId: rid("join1") },
      { label: "join-u1" }
    );
    console.log("join1:", join1.status, join1.json || join1.text);
    assertStatus(join1.status, join1.text, 200, "join-u1");

    const join2 = await apiCall(
      "POST",
      "/.netlify/functions/poker-join",
      t2,
      { tableId, seatNo: 1, buyIn: 100, requestId: rid("join2") },
      { label: "join-u2" }
    );
    console.log("join2:", join2.status, join2.json || join2.text);
    assertStatus(join2.status, join2.text, 200, "join-u2");

    // 3) heartbeats (once + background)
    await heartbeatOnce("u1", t1);
    await heartbeatOnce("u2", t2);
    timers.push(setInterval(() => void heartbeatOnce("u1", t1), HEARTBEAT_MS));
    timers.push(setInterval(() => void heartbeatOnce("u2", t2), HEARTBEAT_MS));

    // 4) wait until both seats ACTIVE (race-proof)
    await waitFor(
      "seats-active",
      async () => {
        const t = await getTable("pre-start", t1);
        const seats = Array.isArray(t?.seats) ? t.seats : [];
        const active = seats.filter((s) => s?.status === "ACTIVE");
        return active.length === 2;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    // 5) start hand (user1) with retry for transient races
    const start = await retry(
      "start-hand",
      async (attempt) => {
        const r = await apiCall(
          "POST",
          "/.netlify/functions/poker-start-hand",
          t1,
          { tableId, requestId: rid(`start-${attempt}`) },
          { label: `start-hand:${attempt}` }
        );

        if (r.status === 200) {
          assertOk(r.json?.ok === true, `start-hand ok:false body=${snippet(r.text)}`);
          return r;
        }

        // transient statuses: join propagation / locking
        if ([409, 425, 429, 500, 502, 503, 504].includes(r.status)) {
          throw new Error(`start-hand transient status=${r.status} body=${snippet(r.text)}`);
        }

        // real failure
        assertStatus(r.status, r.text, 200, "start-hand");
        return r;
      },
      { tries: 6, baseDelayMs: 450, maxDelayMs: 3000 }
    );

    console.log("start:", start.status, start.json || start.text);

    // 6) wait until both users see PREFLOP + have hole cards (eventual consistency)
    const g1 = await waitFor(
      "u1-ready",
      async () => {
        const t = await getTable("u1-ready", t1);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return t;
      },
      { timeoutMs: 25000, pollMs: 600 }
    );

    await waitFor(
      "u2-ready",
      async () => {
        const t = await getTable("u2-ready", t2);
        if (t?.state?.state?.phase !== "PREFLOP") return false;
        if (!Array.isArray(t?.myHoleCards) || t.myHoleCards.length !== 2) return false;
        return true;
      },
      { timeoutMs: 25000, pollMs: 650 }
    );

    console.log("get1:", 200, g1?.state?.state?.phase, "myCards:", g1?.myHoleCards?.length);

    // 7) CHECK action: try both, but make it race-proof:
    // - if not_your_turn, retry after refetch
    await retry(
      "pref-check",
      async (attempt) => {
        const cur = await getTable(`before-act-${attempt}`, t1);
        const turnUserId = cur?.state?.state?.turnUserId;
        assertOk(typeof turnUserId === "string" && turnUserId.length > 0, `missing turnUserId (attempt ${attempt})`);

        // We don't decode user IDs here (keep script minimal). We just attempt with both tokens,
        // but we treat "not_your_turn" as expected and retry a bit.
        const a1 = await apiCall(
          "POST",
          "/.netlify/functions/poker-act",
          t1,
          { tableId, requestId: rid(`act1-${attempt}`), action: { type: "CHECK" } },
          { label: `act:u1:${attempt}` }
        );
        console.log("act1:", a1.status, a1.json || a1.text);

        if (a1.status === 200 && a1.json?.ok === true) return true;
        if (a1.status !== 403 || a1.json?.error !== "not_your_turn") {
          // something else happened -> can be transient
          if ([409, 425, 429, 500, 502, 503, 504].includes(a1.status)) throw new Error(`act u1 transient ${a1.status}`);
        }

        const a2 = await apiCall(
          "POST",
          "/.netlify/functions/poker-act",
          t2,
          { tableId, requestId: rid(`act2-${attempt}`), action: { type: "CHECK" } },
          { label: `act:u2:${attempt}` }
        );
        console.log("act2:", a2.status, a2.json || a2.text);

        if (a2.status === 200 && a2.json?.ok === true) return true;
        if (a2.status !== 403 || a2.json?.error !== "not_your_turn") {
          if ([409, 425, 429, 500, 502, 503, 504].includes(a2.status)) throw new Error(`act u2 transient ${a2.status}`);
        }

        // If neither succeeded, this is probably race (turn advanced / state not propagated) -> retry
        throw new Error("no successful CHECK yet (race/not_your_turn)");
      },
      { tries: 6, baseDelayMs: 350, maxDelayMs: 2500 }
    );

    if (heartbeatError) throw heartbeatError;

    console.log("\nOpen UI:");
    console.log(`${BASE}/poker/table.html?tableId=${tableId}`);
  } finally {
    timers.forEach((t) => clearInterval(t));
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
