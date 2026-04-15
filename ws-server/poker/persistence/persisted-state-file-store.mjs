import fs from "node:fs/promises";

function emptyStore() {
  return { tables: {} };
}

async function readStore(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
    if (!parsed.tables || typeof parsed.tables !== "object" || Array.isArray(parsed.tables)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

async function writeStore(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function loadPersistedTableFromFile({ filePath, tableId }) {
  const store = await readStore(filePath);
  const row = store.tables?.[tableId];
  if (!row || typeof row !== "object") {
    return { tableRow: null, seatRows: [], stateRow: null };
  }
  return {
    tableRow: row.tableRow ?? null,
    seatRows: Array.isArray(row.seatRows) ? row.seatRows : [],
    stateRow: row.stateRow ?? null
  };
}

export async function listPersistedTablesFromFile({ filePath }) {
  const store = await readStore(filePath);
  return Object.entries(store.tables || {})
    .filter(([tableId, row]) => typeof tableId === "string" && tableId && row && typeof row === "object")
    .map(([tableId, row]) => ({
      tableId,
      tableRow: row.tableRow ?? null,
      seatRows: Array.isArray(row.seatRows) ? row.seatRows : [],
      stateRow: row.stateRow ?? null
    }));
}

export async function writePersistedTableToFile({ filePath, tableId, expectedVersion, nextState }) {
  if (!filePath || !tableId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return { ok: false, reason: "invalid" };
  }
  const store = await readStore(filePath);
  const row = store.tables?.[tableId];
  if (!row || typeof row !== "object") {
    return { ok: false, reason: "not_found" };
  }
  const currentVersion = Number(row?.stateRow?.version);
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    return { ok: false, reason: "invalid" };
  }
  if (currentVersion !== expectedVersion) {
    return { ok: false, reason: "conflict", currentVersion };
  }
  const nextVersion = currentVersion + 1;
  row.stateRow = { version: nextVersion, state: nextState };
  row.lastActivityAt = new Date().toISOString();
  store.tables[tableId] = row;
  await writeStore(filePath, store);
  return { ok: true, newVersion: nextVersion };
}
