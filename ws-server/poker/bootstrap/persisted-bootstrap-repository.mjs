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

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseTimestampMs(value) {
  if (Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOpenTable(tableRow) {
  const status = typeof tableRow?.status === "string" ? tableRow.status.trim().toUpperCase() : "OPEN";
  return status === "OPEN";
}

function countActiveSeats(seatRows) {
  if (!Array.isArray(seatRows)) {
    return 0;
  }
  return seatRows.filter((row) => String(row?.status || "ACTIVE").trim().toUpperCase() === "ACTIVE").length;
}

function resolveLastActivityMs(tableRow) {
  return parseTimestampMs(tableRow?.last_activity_at)
    ?? parseTimestampMs(tableRow?.lastActivityAt)
    ?? parseTimestampMs(tableRow?.created_at)
    ?? parseTimestampMs(tableRow?.createdAt);
}

function shouldDiscoverTable({ tableRow, seatRows, emptyJoinableGraceMs, nowMs = Date.now() }) {
  if (!tableRow || typeof tableRow !== "object" || !isOpenTable(tableRow)) {
    return false;
  }
  if (countActiveSeats(seatRows) > 0) {
    return true;
  }
  const lastActivityAtMs = resolveLastActivityMs(tableRow);
  if (lastActivityAtMs === null) {
    return false;
  }
  return nowMs - lastActivityAtMs <= emptyJoinableGraceMs;
}

export function createPersistedBootstrapRepository({ env = process.env } = {}) {
  let fileStoreLoaderPromise = null;
  let fileStoreListerPromise = null;
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
        "select id, status, max_players, stakes, created_at, updated_at, last_activity_at from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const tableRow = tableRows?.[0] || null;
      if (!tableRow) {
        return { tableRow: null, seatRows: [], stateRow: null };
      }

      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, is_bot, bot_profile, leave_after_hand, stack from public.poker_seats where table_id = $1 order by seat_no asc;",
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

  async function loadFileStore() {
    if (!fileStoreLoaderPromise) {
      fileStoreLoaderPromise = import("../persistence/persisted-state-file-store.mjs").then((module) => module.loadPersistedTableFromFile);
    }
    return fileStoreLoaderPromise;
  }

  async function listFileStore() {
    if (!fileStoreListerPromise) {
      fileStoreListerPromise = import("../persistence/persisted-state-file-store.mjs").then((module) => module.listPersistedTablesFromFile);
    }
    return fileStoreListerPromise;
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

    if (env.WS_PERSISTED_STATE_FILE) {
      const loadFromFile = await loadFileStore();
      return loadFromFile({ filePath: env.WS_PERSISTED_STATE_FILE, tableId });
    }

    if (!env.SUPABASE_DB_URL) {
      return { tableRow: null, seatRows: [], stateRow: null };
    }

    return loadFromDb(tableId);
  }

  async function listDiscoverableTableIds({ limit = 100, emptyJoinableGraceMs = 60_000 } = {}) {
    const boundedLimit = normalizePositiveInt(limit, 100);
    const graceMs = normalizePositiveInt(emptyJoinableGraceMs, 60_000);
    const nowMs = Date.now();

    if (fixtures) {
      return Object.entries(fixtures)
        .filter(([tableId, fixture]) => shouldDiscoverTable({
          tableRow: fixture?.tableRow ?? null,
          seatRows: fixture?.seatRows ?? [],
          emptyJoinableGraceMs: graceMs,
          nowMs
        }) && typeof tableId === "string" && tableId)
        .sort(([leftId, leftFixture], [rightId, rightFixture]) => {
          const rightActivity = resolveLastActivityMs(rightFixture?.tableRow) ?? 0;
          const leftActivity = resolveLastActivityMs(leftFixture?.tableRow) ?? 0;
          if (rightActivity !== leftActivity) {
            return rightActivity - leftActivity;
          }
          return leftId.localeCompare(rightId);
        })
        .slice(0, boundedLimit)
        .map(([tableId]) => tableId);
    }

    if (env.WS_PERSISTED_STATE_FILE) {
      const listFromFile = await listFileStore();
      const rows = await listFromFile({ filePath: env.WS_PERSISTED_STATE_FILE });
      return rows
        .filter((row) => shouldDiscoverTable({
          tableRow: row?.tableRow ?? null,
          seatRows: row?.seatRows ?? [],
          emptyJoinableGraceMs: graceMs,
          nowMs
        }))
        .sort((left, right) => {
          const rightActivity = resolveLastActivityMs(right?.tableRow) ?? 0;
          const leftActivity = resolveLastActivityMs(left?.tableRow) ?? 0;
          if (rightActivity !== leftActivity) {
            return rightActivity - leftActivity;
          }
          return String(left?.tableId || "").localeCompare(String(right?.tableId || ""));
        })
        .slice(0, boundedLimit)
        .map((row) => row.tableId);
    }

    if (!env.SUPABASE_DB_URL) {
      return [];
    }

    const beginSql = await loadBeginSql();
    return beginSql(async (tx) => {
      const cutoffIso = new Date(nowMs - graceMs).toISOString();
      const rows = await tx.unsafe(
        `
select t.id
from public.poker_tables t
where t.status = 'OPEN'
  and (
    exists (
      select 1
      from public.poker_seats s
      where s.table_id = t.id
        and s.status = 'ACTIVE'
    )
    or coalesce(t.last_activity_at, t.created_at) >= $2::timestamptz
  )
order by coalesce(t.last_activity_at, t.created_at) desc nulls last, t.id asc
limit $1;
        `,
        [boundedLimit, cutoffIso]
      );
      if (!Array.isArray(rows)) {
        return [];
      }
      return rows
        .map((row) => (typeof row?.id === "string" ? row.id : ""))
        .filter((tableId) => tableId);
    }, { env });
  }

  return { load, listDiscoverableTableIds };
}
