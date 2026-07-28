import postgres from "postgres";
import { serializePokerLogPayload } from "../observability/poker-log-policy.mjs";
import { pokerLogRuntimeControl } from "../observability/poker-log-runtime-control.mjs";

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || "";
const DB_MAX_RAW = Number(process.env.SUPABASE_DB_MAX || process.env.POKER_DB_MAX || 5);
const DB_MAX = Number.isFinite(DB_MAX_RAW) ? Math.min(10, Math.max(2, Math.floor(DB_MAX_RAW))) : 5;
const POSTGRES_OPTIONS = { max: DB_MAX, idle_timeout: 30, connect_timeout: 10, prepare: false };

const sql = SUPABASE_DB_URL ? postgres(SUPABASE_DB_URL, POSTGRES_OPTIONS) : null;

function klog(kind, data) {
  if (!pokerLogRuntimeControl.shouldEmit(kind, data)) return;
  process.stdout.write(`[klog] ${kind} ${serializePokerLogPayload(kind, data)}\n`);
}

async function beginSql(fn) {
  if (!sql) {
    throw new Error("Supabase DB connection not configured (SUPABASE_DB_URL missing)");
  }
  return await sql.begin(fn);
}

export { beginSql, klog };
