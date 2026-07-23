import { spawn } from "node:child_process";

const targetCount = Number(process.env.SMOKE_TABLE_COUNT || 25);
const expectedBatchSize = Number(process.env.SMOKE_EXPECTED_BATCH_SIZE || 10);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 240_000);
const createTableUrl = String(process.env.POKER_CREATE_TABLE_URL || "").trim();
const origin = String(process.env.POKER_CREATE_TABLE_ORIGIN || "").trim();
const bearerToken = String(process.env.SUPABASE_BEARER_TOKEN || "").trim();
const serviceName = String(process.env.WS_PREVIEW_SERVICE || "ws-server-preview.service").trim();
const existingTableIds = String(process.env.SMOKE_EXISTING_TABLE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!Number.isInteger(targetCount) || targetCount < 1) throw new Error("invalid_SMOKE_TABLE_COUNT");
if (!Number.isInteger(expectedBatchSize) || expectedBatchSize < 1) throw new Error("invalid_SMOKE_EXPECTED_BATCH_SIZE");
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("invalid_SMOKE_TIMEOUT_MS");
if (!createTableUrl || !origin || !bearerToken) throw new Error("missing_create_table_configuration");
if (existingTableIds.length > targetCount) throw new Error("too_many_existing_table_ids");

const startedAtMs = Date.now();
const journal = spawn("sudo", [
  "-n",
  "journalctl",
  "-u",
  serviceName,
  "--since",
  `@${Math.floor(startedAtMs / 1000)}`,
  "--follow",
  "--no-pager",
  "-o",
  "cat"
], { stdio: ["ignore", "pipe", "pipe"] });

const batches = [];
let journalBuffer = "";
let resolveBatch;
const nextBatch = () => new Promise((resolve) => {
  resolveBatch = resolve;
});

journal.stdout.setEncoding("utf8");
journal.stdout.on("data", (chunk) => {
  journalBuffer += chunk;
  const lines = journalBuffer.split("\n");
  journalBuffer = lines.pop() || "";
  for (const line of lines) {
    const marker = "ws_open_table_reconciler_batch_selected ";
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) continue;
    try {
      const payload = JSON.parse(line.slice(markerIndex + marker.length));
      batches.push(payload);
      resolveBatch?.();
      resolveBatch = null;
    } catch {
      // Ignore unrelated or incomplete journal lines.
    }
  }
});

let journalError = "";
journal.stderr.setEncoding("utf8");
journal.stderr.on("data", (chunk) => {
  journalError += chunk;
});

async function createTable() {
  const response = await fetch(createTableUrl, {
    method: "POST",
    headers: {
      origin,
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.tableId !== "string" || !payload.tableId) {
    throw new Error(`create_table_failed:${response.status}:${payload?.error || "invalid_response"}`);
  }
  return payload.tableId;
}

function verifyRotation(tableIds, observedBatches) {
  const targetSet = new Set(tableIds);
  const relevantBatches = observedBatches
    .map((batch) => ({
      ...batch,
      tableIds: Array.isArray(batch?.tableIds) ? batch.tableIds : []
    }))
    .filter((batch) => batch.tableIds.some((tableId) => targetSet.has(tableId)));
  const flattened = relevantBatches.flatMap((batch) => batch.tableIds);
  const requiredVisits = targetCount + Math.min(expectedBatchSize, targetCount);
  if (flattened.length < requiredVisits) return null;

  const firstCycle = flattened.slice(0, targetCount);
  const wrappedPrefix = flattened.slice(targetCount, requiredVisits);
  if (firstCycle.some((tableId) => !targetSet.has(tableId))) {
    throw new Error(`unexpected_table_in_rotation:${firstCycle.find((tableId) => !targetSet.has(tableId))}`);
  }
  if (new Set(firstCycle).size !== targetCount) {
    throw new Error("table_repeated_before_full_rotation");
  }
  if (tableIds.some((tableId) => !firstCycle.includes(tableId))) {
    throw new Error("created_table_missing_from_full_rotation");
  }
  const expectedWrappedPrefix = firstCycle.slice(0, wrappedPrefix.length);
  if (JSON.stringify(wrappedPrefix) !== JSON.stringify(expectedWrappedPrefix)) {
    throw new Error("cursor_wrap_order_mismatch");
  }
  for (const batch of relevantBatches.slice(0, Math.ceil(requiredVisits / expectedBatchSize))) {
    if (batch.limit !== expectedBatchSize || batch.returnedOpenTableCount !== expectedBatchSize) {
      throw new Error("unexpected_bounded_batch_shape");
    }
  }
  return { relevantBatches, firstCycle, wrappedPrefix };
}

const timeoutAt = startedAtMs + timeoutMs;
try {
  const createdTableIds = [...existingTableIds];
  while (createdTableIds.length < targetCount) {
    createdTableIds.push(await createTable());
  }
  process.stdout.write(`${JSON.stringify({ event: "tables_created", tableIds: createdTableIds })}\n`);

  let verified = null;
  while (!verified && Date.now() < timeoutAt) {
    verified = verifyRotation(createdTableIds, batches);
    if (verified) break;
    await Promise.race([
      nextBatch(),
      new Promise((resolve) => setTimeout(resolve, Math.min(5_000, Math.max(0, timeoutAt - Date.now()))))
    ]);
  }
  if (!verified) throw new Error("rotation_verification_timeout");

  process.stdout.write(`${JSON.stringify({
    event: "rotation_verified",
    targetCount,
    expectedBatchSize,
    batches: verified.relevantBatches,
    firstCycle: verified.firstCycle,
    wrappedPrefix: verified.wrappedPrefix
  })}\n`);
} finally {
  journal.kill("SIGTERM");
  if (journalError.trim()) process.stderr.write(journalError);
}
