import fs from "node:fs/promises";
import postgres from "postgres";

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
        return [{ id: row.id || tableId, status: row.status || "OPEN", max_players: row.max_players || row.maxPlayers || 6 }];
      }

      if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2") && sql.includes("limit 1")) {
        const userId = params?.[1];
        const requiresActive = sql.includes("status = 'active'");
        const row = (table?.seatRows || []).find((r) => {
          if (r?.user_id !== userId) return false;
          if (!requiresActive) return true;
          return String(r?.status || "ACTIVE").toUpperCase() === "ACTIVE";
        });
        return row ? [{ seat_no: row.seat_no }] : [];
      }

      if (sql.includes("from public.poker_seats") && sql.includes("status = 'active'") && sql.includes("order by seat_no asc")) {
        const rows = (table?.seatRows || [])
          .filter((r) => String(r?.status || "ACTIVE").toUpperCase() === "ACTIVE")
          .sort((a, b) => Number(a.seat_no) - Number(b.seat_no));
        return rows.map((r) => ({ seat_no: r.seat_no }));
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
        seatRows.push({ user_id: userId, seat_no: seatNo, status: "ACTIVE", is_bot: false });
        table.seatRows = seatRows;
        return [];
      }

      if (sql.includes("select version, state from public.poker_state")) {
        if (!table?.stateRow) return [];
        return [{ version: table.stateRow.version, state: table.stateRow.state }];
      }

      if (sql.includes("update public.poker_state set state")) {
        if (!table?.stateRow) throw Object.assign(new Error("state_missing"), { code: "state_missing" });
        table.stateRow.state = params?.[1];
        return [{ version: table.stateRow.version }];
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
  await fs.writeFile(filePath, `${JSON.stringify(doc)}
`, "utf8");
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
