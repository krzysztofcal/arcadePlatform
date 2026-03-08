function parseFixtureMap(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}


function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPersistedBootstrapRepository({ env = process.env } = {}) {
  const fixtures = parseFixtureMap(env.WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON);
  let beginSqlPromise = null;

  async function loadBeginSql() {
    if (!beginSqlPromise) {
      beginSqlPromise = import("./persisted-bootstrap-db.mjs").then((module) => module.beginSqlWs);
    }

    return beginSqlPromise;
  }

  async function loadFromDb(tableId) {
    const beginSql = await loadBeginSql();
    return beginSql(async (tx) => {
      const tableRows = await tx.unsafe(
        "select id, status, max_players, stakes from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const tableRow = tableRows?.[0] || null;
      if (!tableRow) {
        return { tableRow: null, seatRows: [], stateRow: null };
      }

      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, is_bot from public.poker_seats where table_id = $1 order by seat_no asc;",
        [tableId]
      );

      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 limit 1;",
        [tableId]
      );

      return {
        tableRow,
        seatRows: Array.isArray(seatRows) ? seatRows : [],
        stateRow: stateRows?.[0] || null
      };
    }, { env });
  }

  async function load(tableId) {
    if (fixtures && Object.prototype.hasOwnProperty.call(fixtures, tableId)) {
      const fixture = fixtures[tableId];
      const fixtureDelayMs = Number(fixture?.delayMs);
      if (Number.isFinite(fixtureDelayMs) && fixtureDelayMs > 0) {
        await delay(fixtureDelayMs);
      }
      return {
        tableRow: fixture?.tableRow ?? null,
        seatRows: Array.isArray(fixture?.seatRows) ? fixture.seatRows : [],
        stateRow: fixture?.stateRow ?? null
      };
    }

    if (!env.SUPABASE_DB_URL) {
      return { tableRow: null, seatRows: [], stateRow: null };
    }

    return loadFromDb(tableId);
  }

  return { load };
}
