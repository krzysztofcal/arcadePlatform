import postgres from "postgres";

const clientsByDbUrl = new Map();

function resolveDbUrl(env) {
  const dbUrl = typeof env?.SUPABASE_DB_URL === "string" ? env.SUPABASE_DB_URL.trim() : "";
  if (!dbUrl) {
    throw new Error("Supabase DB connection not configured (SUPABASE_DB_URL missing)");
  }
  return dbUrl;
}

function resolveDbMax(env) {
  const parsed = Number(env?.SUPABASE_DB_MAX ?? env?.POKER_DB_MAX ?? 5);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.min(10, Math.max(2, Math.floor(parsed)));
}

function getClient(env) {
  const dbUrl = resolveDbUrl(env);
  if (clientsByDbUrl.has(dbUrl)) {
    return clientsByDbUrl.get(dbUrl);
  }

  const client = postgres(dbUrl, {
    max: resolveDbMax(env),
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false
  });

  clientsByDbUrl.set(dbUrl, client);
  return client;
}

export async function beginSqlWs(fn, { env = process.env } = {}) {
  const client = getClient(env);
  return client.begin(fn);
}
