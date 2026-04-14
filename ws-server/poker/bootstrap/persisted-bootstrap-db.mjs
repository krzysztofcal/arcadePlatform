import fs from "node:fs/promises";
import postgres from "postgres";
import { writeUtf8FileAtomic } from "../persistence/atomic-file-write.mjs";

const clientsByDbUrl = new Map();

async function beginSqlFileStore(fn, { env = process.env } = {}) {
  const filePath = typeof env?.WS_PERSISTED_STATE_FILE === "string" ? env.WS_PERSISTED_STATE_FILE.trim() : "";
  if (!filePath) {
    throw new Error("Persisted state file not configured (WS_PERSISTED_STATE_FILE missing)");
  }
  const raw = await fs.readFile(filePath, "utf8");
  const doc = JSON.parse(raw || "{}");
  const tables = doc && typeof doc === "object" && doc.tables && typeof doc.tables === "object" ? doc.tables : {};

  const tx = {
    unsafe: async (query, params = []) => {
      const sql = String(query).toLowerCase();
      const tableId = params?.[0];
      const table = tables?.[tableId] || null;

      if (sql.includes("from public.poker_tables")) {
        if (!table?.tableRow) return [];
        const row = table.tableRow;
        return [{ id: row.id || tableId, status: row.status || "OPEN", max_players: row.max_players || row.maxPlayers || 6, stakes: row.stakes ?? '{"sb":1,"bb":2}' }];
      }

      if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
        const rows = (table?.seatRows || []).slice().sort((a, b) => Number(a.seat_no) - Number(b.seat_no));
        if (sql.includes("status = 'active'")) {
          return rows
            .filter((r) => String(r?.status || "ACTIVE").toUpperCase() === "ACTIVE")
            .map((r) => ({ seat_no: r.seat_no }));
        }
        return rows.map((r) => ({
          user_id: r.user_id,
          seat_no: r.seat_no,
          status: r.status || "ACTIVE",
          is_bot: !!r.is_bot,
          bot_profile: r.bot_profile ?? null,
          leave_after_hand: !!r.leave_after_hand,
          stack: r.stack ?? 0
        }));
      }

      if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2") && sql.includes("limit 1")) {
        const userId = params?.[1];
        const requiresActive = sql.includes("status = 'active'");
        const row = (table?.seatRows || []).find((r) => {
          if (r?.user_id !== userId) return false;
          if (!requiresActive) return true;
          return String(r?.status || "ACTIVE").toUpperCase() === "ACTIVE";
        });
        return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
      }

      if (sql.includes("insert into public.poker_seats")) {
        if (String(env?.WS_TEST_JOIN_INSERT_FAIL_MODE || "").trim().toLowerCase() === "generic") {
          const err = new Error("join_insert_generic_failure");
          err.code = "58000";
          throw err;
        }
        const userId = params?.[1];
        const seatNo = Number(params?.[2]);
        if (!table) throw Object.assign(new Error("table_not_found"), { code: "table_not_found" });
        const seatRows = Array.isArray(table.seatRows) ? table.seatRows : [];
        if (seatRows.some((r) => Number(r?.seat_no) === seatNo)) {
          throw Object.assign(new Error("seat_taken"), { code: "seat_taken" });
        }
        const isBot = sql.includes("is_bot");
        seatRows.push({
          user_id: userId,
          seat_no: seatNo,
          status: "ACTIVE",
          is_bot: isBot,
          bot_profile: isBot ? params?.[3] ?? "TRIVIAL" : null,
          leave_after_hand: false,
          stack: isBot ? Number(params?.[4]) || 0 : 0
        });
        table.seatRows = seatRows;
        return [{ seat_no: seatNo }];
      }

      if (sql.includes("select version, state from public.poker_state")) {
        if (!table?.stateRow) return [];
        return [{ version: table.stateRow.version, state: table.stateRow.state }];
      }

      if (sql.includes("update public.poker_state") && sql.includes("state")) {
        if (!table?.stateRow) throw Object.assign(new Error("state_missing"), { code: "state_missing" });
        table.stateRow.state = params?.[1];
        const currentVersion = Number(table.stateRow.version);
        if (sql.includes("version = version + 1")) {
          table.stateRow.version = Number.isInteger(currentVersion) ? currentVersion + 1 : 1;
        }
        return [{ version: table.stateRow.version }];
      }


      if (sql.includes("update public.poker_seats set stack")) {
        const userId = params?.[1];
        const seatNo = Number(params?.[2]);
        const stack = Number(params?.[3]);
        const row = (table?.seatRows || []).find((r) => r?.user_id === userId && Number(r?.seat_no) === seatNo);
        if (row) row.stack = stack;
        return [];
      }

      if (sql.includes("delete from public.poker_seats")) {
        const userId = params?.[1];
        const seatNo = Number(params?.[2]);
        table.seatRows = (table?.seatRows || []).filter((row) => !(row?.user_id === userId && Number(row?.seat_no) === seatNo));
        return [];
      }

      if (sql.includes("update public.poker_tables set last_activity_at")) {
        if (table) table.lastActivityAt = new Date().toISOString();
        return [];
      }

      if (sql.includes("update public.poker_seats set status = 'active'")) {
        const userId = params?.[1];
        const row = (table?.seatRows || []).find((r) => r?.user_id === userId);
        if (row) row.status = "ACTIVE";
        return [];
      }

      return [];
    }
  };

  const result = await fn(tx);
  await writeUtf8FileAtomic(filePath, `${JSON.stringify(doc)}
`);
  return result;
}


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
  const dbUrl = typeof env?.SUPABASE_DB_URL === "string" ? env.SUPABASE_DB_URL.trim() : "";
  if (!dbUrl && env?.WS_PERSISTED_STATE_FILE) {
    return beginSqlFileStore(fn, { env });
  }
  const client = getClient(env);
  return client.begin(fn);
}
