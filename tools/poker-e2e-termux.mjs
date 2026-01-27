import { createClient } from "@supabase/supabase-js";

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

["BASE","ORIGIN","SUPABASE_URL","SUPABASE_ANON_KEY","U1_EMAIL","U1_PASS","U2_EMAIL","U2_PASS"].forEach(must);

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login failed for ${email}: ${error.message}`);
  const token = data?.session?.access_token;
  if (!token) throw new Error(`login: no access_token for ${email}`);
  return token;
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, text };
}

const rid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function main() {
  const t1 = await login(U1_EMAIL, U1_PASS);
  const t2 = await login(U2_EMAIL, U2_PASS);

  // 1) create table (user1)
  const create = await api("POST", "/.netlify/functions/poker-create-table", t1, { requestId: rid("create") });
  if (create.status !== 200 || !create.json?.tableId) {
    console.error("create:", create.status, create.text);
    process.exit(1);
  }
  const tableId = create.json.tableId;
  console.log("tableId=", tableId);

  // 2) join seat 0 (user1)
  const join1 = await api("POST", "/.netlify/functions/poker-join", t1, {
    tableId,
    seatNo: 0,
    buyIn: 100,
    requestId: rid("join1"),
  });
  console.log("join1:", join1.status, join1.json || join1.text);

  // 3) join seat 1 (user2)
  const join2 = await api("POST", "/.netlify/functions/poker-join", t2, {
    tableId,
    seatNo: 1,
    buyIn: 100,
    requestId: rid("join2"),
  });
  console.log("join2:", join2.status, join2.json || join2.text);

  // 4) start hand (user1)
  const start = await api("POST", "/.netlify/functions/poker-start-hand", t1, {
    tableId,
    requestId: rid("start"),
  });
  console.log("start:", start.status, start.json || start.text);

  // 5) fetch table (both users) and act for whoever’s turn
  const g1 = await api("GET", `/.netlify/functions/poker-get-table?tableId=${tableId}`, t1);
  const g2 = await api("GET", `/.netlify/functions/poker-get-table?tableId=${tableId}`, t2);
  console.log("get1:", g1.status, g1.json?.state?.state?.phase, "myCards:", g1.json?.myHoleCards?.length);
  console.log("get2:", g2.status, g2.json?.state?.state?.phase, "myCards:", g2.json?.myHoleCards?.length);

  const turn = g1.json?.state?.state?.turnUserId || g2.json?.state?.state?.turnUserId;
  console.log("turnUserId=", turn);

  // Try CHECK with both; only correct user should succeed
  const act1 = await api("POST", "/.netlify/functions/poker-act", t1, {
    tableId,
    requestId: rid("act1"),
    action: { type: "CHECK" },
  });
  console.log("act1:", act1.status, act1.json || act1.text);

  const act2 = await api("POST", "/.netlify/functions/poker-act", t2, {
    tableId,
    requestId: rid("act2"),
    action: { type: "CHECK" },
  });
  console.log("act2:", act2.status, act2.json || act2.text);

  console.log("\nOpen UI:");
  console.log(`${BASE}/poker/table.html?tableId=${tableId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
