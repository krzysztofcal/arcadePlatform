const targetCount = Number(process.env.SMOKE_TABLE_COUNT || 25);
const expectedBatchSize = Number(process.env.SMOKE_EXPECTED_BATCH_SIZE || 10);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 300_000);
const pollIntervalMs = Number(process.env.SMOKE_POLL_INTERVAL_MS || 5_000);
const createTableUrl = String(process.env.POKER_CREATE_TABLE_URL || "").trim();
const adminTablesListUrl = String(process.env.ADMIN_TABLES_LIST_URL || "").trim();
const origin = String(process.env.POKER_CREATE_TABLE_ORIGIN || "").trim();
const bearerToken = String(process.env.SUPABASE_BEARER_TOKEN || "").trim();
const existingTableIds = String(process.env.SMOKE_EXISTING_TABLE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!Number.isInteger(targetCount) || targetCount < 1) throw new Error("invalid_SMOKE_TABLE_COUNT");
if (!Number.isInteger(expectedBatchSize) || expectedBatchSize < 1) throw new Error("invalid_SMOKE_EXPECTED_BATCH_SIZE");
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("invalid_SMOKE_TIMEOUT_MS");
if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 250) throw new Error("invalid_SMOKE_POLL_INTERVAL_MS");
if (!createTableUrl || !adminTablesListUrl || !origin || !bearerToken) {
  throw new Error("missing_smoke_configuration");
}
if (existingTableIds.length > targetCount) throw new Error("too_many_existing_table_ids");
if (targetCount <= expectedBatchSize) throw new Error("target_count_must_exceed_expected_batch_size");

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`request_failed:${response.status}:${payload?.error || "invalid_response"}`);
  }
  return payload;
}

async function createTable() {
  const payload = await requestJson(createTableUrl, {
    method: "POST",
    headers: {
      origin,
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" })
  });
  if (typeof payload?.tableId !== "string" || !payload.tableId) {
    throw new Error("create_table_failed:invalid_response");
  }
  return payload.tableId;
}

async function readStatuses(tableIds) {
  const targetIds = new Set(tableIds);
  const statuses = Object.fromEntries(tableIds.map((tableId) => [tableId, null]));
  const pageLimit = 100;
  let page = 1;
  while (targetIds.size > 0) {
    const url = new URL(adminTablesListUrl);
    url.searchParams.set("status", "ALL");
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(pageLimit));
    const payload = await requestJson(url, {
      headers: {
        origin,
        authorization: `Bearer ${bearerToken}`
      }
    });
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      if (!targetIds.has(item?.tableId)) continue;
      statuses[item.tableId] = item?.status || null;
      targetIds.delete(item.tableId);
    }
    if (targetIds.size === 0 || payload?.pagination?.hasNextPage !== true) break;
    page += 1;
  }
  return statuses;
}

const startedAtMs = Date.now();
const timeoutAt = startedAtMs + timeoutMs;
const createdTableIds = [...existingTableIds];
while (createdTableIds.length < targetCount) {
  createdTableIds.push(await createTable());
}
process.stdout.write(`${JSON.stringify({
  event: "tables_created",
  tableCount: createdTableIds.length,
  expectedBatchSize
})}\n`);

const firstClosedAtMsByTableId = new Map();
let statuses = {};
while (Date.now() < timeoutAt) {
  statuses = await readStatuses(createdTableIds);
  const observedAtMs = Date.now();
  for (const tableId of createdTableIds) {
    if (statuses[tableId] === "CLOSED" && !firstClosedAtMsByTableId.has(tableId)) {
      firstClosedAtMsByTableId.set(tableId, observedAtMs);
    }
  }
  if (firstClosedAtMsByTableId.size === targetCount) break;
  await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, timeoutAt - Date.now()))));
}

const notClosed = createdTableIds.filter((tableId) => statuses[tableId] !== "CLOSED");
if (notClosed.length > 0) {
  throw new Error(`reconciliation_effect_timeout:${notClosed.length}_tables_not_closed`);
}

const closureOffsetsMs = createdTableIds
  .map((tableId) => Number(firstClosedAtMsByTableId.get(tableId) || 0) - startedAtMs)
  .sort((a, b) => a - b);
process.stdout.write(`${JSON.stringify({
  event: "reconciliation_effect_verified",
  tableCount: targetCount,
  expectedBatchSize,
  allClosed: true,
  firstClosureOffsetMs: closureOffsetsMs[0] || null,
  lastClosureOffsetMs: closureOffsetsMs.at(-1) || null,
  distinctObservationWindows: new Set(closureOffsetsMs).size
})}\n`);
