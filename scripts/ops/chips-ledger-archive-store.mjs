import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import postgres from "postgres";
import {
  EXPORT_SCHEMA_VERSION,
  compareTransactions,
  maxBatchSizeForTarget,
  parseJsonl,
  resolveTarget,
  serializeRecords,
  stringifyJson,
  timestampToMicros,
} from "./chips-ledger-archive-export.mjs";

export const ARCHIVE_BUCKET = "chips-ledger-archive";
export const ARCHIVE_MIME_TYPE = "application/gzip";
export const ARCHIVE_MAX_BYTES = 6 * 1024 * 1024;

const INTEGER_RE = /^-?(?:0|[1-9][0-9]*)$/;
const NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9][0-9]*)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_ORDER = ["transaction.created_at ASC", "transaction.id ASC"];

const HELP = `Usage: node scripts/ops/chips-ledger-archive-store.mjs [options]

Required:
  --target stage|prod       Explicit target; no default.
  --artifact <path>        Existing .jsonl.gz artifact.
  --manifest <path>        Existing local exporter manifest.

The script creates/verifies a private Storage bucket, uploads without upsert,
verifies a private download, and records pending -> committed metadata. It
does not modify ledger rows and never deletes Storage objects.
`;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function hasOwn(value, key) {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
  return value;
}

function assertIntegerString(value, label, { nonNegative = false } = {}) {
  if (typeof value !== "string") fail(`${label} must be serialized as a string`);
  const pattern = nonNegative ? NON_NEGATIVE_INTEGER_RE : INTEGER_RE;
  if (!pattern.test(value)) fail(`${label} must be an integer string`);
  return value;
}

function assertSha(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) fail(`${label} must be a lowercase SHA-256`);
  return value;
}

function sameTimestamp(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return timestampToMicros(left) === timestampToMicros(right);
}

function sameValue(left, right, field) {
  if (field.endsWith("_at") || field === "cutoff") return sameTimestamp(left, right);
  if (field === "tx_types") return canonicalJson(left) === canonicalJson(right);
  return String(left ?? "") === String(right ?? "");
}

function sameCursor(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return sameTimestamp(left.created_at, right.created_at) && text(left.id).toLowerCase() === text(right.id).toLowerCase();
}

function parseArgs(argv) {
  const keyMap = { target: "target", artifact: "artifact", manifest: "manifest" };
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    const key = token.startsWith("--") ? keyMap[token.slice(2)] : null;
    if (!key) fail(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    if (args[key] !== undefined) fail(`${token} was supplied more than once`);
    args[key] = value;
    index += 1;
  }
  return args;
}

export function resolveStorageTarget(targetValue, env = process.env) {
  const target = resolveTarget(targetValue, env);
  const rawUrl = text(env.SUPABASE_URL);
  if (!rawUrl) fail("SUPABASE_URL is required");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("SUPABASE_URL is invalid");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    fail("SUPABASE_URL must be an HTTPS Supabase origin");
  }
  const projectMatch = /^([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  if (!projectMatch) fail("SUPABASE_URL must expose a supported Supabase project ref");
  const apiProjectRef = projectMatch[1].toLowerCase();
  if (apiProjectRef !== target.projectRef) fail(`SUPABASE_URL does not match the canonical ${target.target} project ref`);
  const serviceKey = text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is required");
  return {
    ...target,
    baseUrl: url.origin,
    apiProjectRef,
    serviceKey,
  };
}

function verifyCursor(cursor, label) {
  if (cursor == null) return null;
  if (!cursor || typeof cursor !== "object" || !UUID_RE.test(text(cursor.id))) fail(`${label} is invalid`);
  timestampToMicros(cursor.created_at);
  return { created_at: text(cursor.created_at), id: text(cursor.id).toLowerCase() };
}

function verifyManifestShape(manifest, artifactName, target) {
  if (!manifest || typeof manifest !== "object") fail("local manifest must be an object");
  if (manifest.schema_version !== EXPORT_SCHEMA_VERSION || manifest.artifact_type !== "chips_ledger_archive" || manifest.format !== "jsonl.gz") {
    fail("local manifest has an unsupported archive format");
  }
  if (manifest.target !== target.target) fail("local manifest target does not match --target");
  if (manifest.artifact !== artifactName) fail("local manifest artifact name does not match the archive");
  if (!manifest.cutoff || typeof manifest.cutoff.created_at !== "string") fail("local manifest cutoff is missing");
  timestampToMicros(manifest.cutoff.created_at);
  if (manifest.cutoff.rule !== "transaction.created_at < cutoff") fail("local manifest cutoff rule is unsupported");

  const batch = manifest.batch;
  const maxBatchSize = maxBatchSizeForTarget(target.target);
  if (!batch || !Number.isSafeInteger(batch.limit) || batch.limit < 1 || batch.limit > maxBatchSize) fail("local manifest batch limit is invalid for target");
  assertSafeInteger(batch.transactions, "batch.transactions");
  assertSafeInteger(batch.entries, "batch.entries");
  if (batch.transactions > batch.limit) fail("local manifest transaction count exceeds target batch limit");
  if (!batch.tx_types || typeof batch.tx_types !== "object" || Array.isArray(batch.tx_types)) fail("local manifest tx_types is invalid");
  let txTypeTotal = 0;
  for (const [txType, count] of Object.entries(batch.tx_types)) {
    if (!txType || !Number.isSafeInteger(count) || count < 0) fail("local manifest tx_types is invalid");
    txTypeTotal += count;
  }
  if (txTypeTotal !== batch.transactions) fail("local manifest tx_types count mismatch");

  const amounts = manifest.amounts;
  if (!amounts) fail("local manifest amounts are missing");
  assertIntegerString(amounts.credits, "amounts.credits", { nonNegative: true });
  assertIntegerString(amounts.debits, "amounts.debits", { nonNegative: true });
  if (assertIntegerString(amounts.net, "amounts.net") !== "0") fail("local manifest net amount is not zero");
  if (amounts.credits !== amounts.debits) fail("local manifest credits and debits differ");

  const bytes = manifest.bytes;
  if (!bytes || !Number.isSafeInteger(bytes.raw) || bytes.raw < 0 || !Number.isSafeInteger(bytes.compressed) || bytes.compressed < 0 || bytes.compressed > ARCHIVE_MAX_BYTES) {
    fail("local manifest byte counts are invalid");
  }
  if (!manifest.sha256) fail("local manifest checksums are missing");
  assertSha(manifest.sha256.raw_jsonl, "raw_jsonl SHA-256");
  assertSha(manifest.sha256.compressed_artifact, "compressed_artifact SHA-256");
  if (!manifest.time_range || !manifest.cursor || canonicalJson(manifest.cursor.order) !== canonicalJson(CURSOR_ORDER)) {
    fail("local manifest cursor is invalid");
  }
  const cursorStart = verifyCursor(manifest.cursor.start, "cursor.start");
  const cursorEnd = verifyCursor(manifest.cursor.end, "cursor.end");
  const cursorNext = verifyCursor(manifest.cursor.next, "cursor.next");
  if (!sameCursor(cursorEnd, cursorNext)) fail("cursor.next does not match cursor.end");
  return { cursorStart, cursorEnd };
}

function summarizeRecords(records, manifest) {
  if (!Array.isArray(records)) fail("JSONL artifact must contain records");
  const sorted = [...records].sort(compareTransactions);
  const seenTransactions = new Set();
  const seenEntries = new Set();
  const txTypes = {};
  let entryCount = 0;
  let credits = 0n;
  let debits = 0n;
  let netAmount = 0n;
  const cutoff = timestampToMicros(manifest.cutoff.created_at);

  records.forEach((record, recordIndex) => {
    if (record !== sorted[recordIndex]) fail("JSONL transaction order is not deterministic");
    const transaction = record?.transaction;
    const transactionId = text(transaction?.id).toLowerCase();
    if (record?.schema_version !== EXPORT_SCHEMA_VERSION || record?.record_type !== "chips_transaction" || !UUID_RE.test(transactionId)) {
      fail("JSONL artifact contains a malformed transaction");
    }
    if (seenTransactions.has(transactionId)) fail("JSONL artifact contains duplicate transactions");
    seenTransactions.add(transactionId);
    const createdAt = text(transaction.created_at);
    if (timestampToMicros(createdAt) >= cutoff) fail("JSONL artifact contains a transaction at or after cutoff");
    const txType = text(transaction.tx_type);
    if (!txType) fail("JSONL artifact contains a transaction without tx_type");
    txTypes[txType] = (txTypes[txType] || 0) + 1;

    if (!Array.isArray(record.entries)) fail(`JSONL artifact has no entries array for ${transactionId}`);
    const sortedEntries = [...record.entries].sort((left, right) => {
      const leftId = BigInt(assertIntegerString(left?.id, "entry.id", { nonNegative: true }));
      const rightId = BigInt(assertIntegerString(right?.id, "entry.id", { nonNegative: true }));
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    if (record.entries.some((entry, entryIndex) => entry !== sortedEntries[entryIndex])) {
      fail(`JSONL entry order is not deterministic for ${transactionId}`);
    }
    let transactionTotal = 0n;
    for (const entry of record.entries) {
      const entryId = assertIntegerString(entry?.id, "entry.id", { nonNegative: true });
      if (seenEntries.has(entryId)) fail(`JSONL artifact contains duplicate entry ${entryId}`);
      seenEntries.add(entryId);
      if (text(entry.transaction_id).toLowerCase() !== transactionId || text(entry.account_id) !== text(entry.account?.id)) {
        fail(`JSONL entry identity mismatch for ${transactionId}`);
      }
      if (!entry.account || !text(entry.account.account_type) || !hasOwn(entry.account, "user_id") || !hasOwn(entry.account, "system_key")) {
        fail(`JSONL entry account context is incomplete for ${transactionId}`);
      }
      assertIntegerString(entry.entry_seq, "entry.entry_seq", { nonNegative: true });
      timestampToMicros(entry.created_at);
      const amount = BigInt(assertIntegerString(entry.amount, "entry.amount"));
      transactionTotal += amount;
      netAmount += amount;
      if (amount > 0n) credits += amount;
      if (amount < 0n) debits -= amount;
    }
    if (transactionTotal !== 0n) fail(`JSONL transaction is not conserved: ${transactionId}`);
    entryCount += record.entries.length;
  });

  if (netAmount !== 0n || credits !== debits) fail("JSONL batch is not conserved");
  const first = records[0]?.transaction?.created_at || null;
  const last = records.at(-1)?.transaction?.created_at || null;
  const expectedEnd = last ? { created_at: last, id: records.at(-1).transaction.id.toLowerCase() } : null;
  if (!sameTimestamp(first, manifest.time_range.first_created_at) || !sameTimestamp(last, manifest.time_range.last_created_at)) {
    fail("local manifest time range does not match JSONL");
  }
  if (!sameCursor(expectedEnd, manifest.cursor.end)) fail("local manifest cursor end does not match JSONL");
  if (manifest.cursor.next && !sameCursor(expectedEnd, manifest.cursor.next)) fail("local manifest cursor next does not match JSONL");
  if (records.length !== manifest.batch.transactions || entryCount !== manifest.batch.entries) fail("local manifest counts do not match JSONL");
  if (canonicalJson(Object.fromEntries(Object.entries(txTypes).sort(([left], [right]) => left.localeCompare(right)))) !== canonicalJson(manifest.batch.tx_types)) {
    fail("local manifest tx_types do not match JSONL");
  }
  if (credits.toString() !== manifest.amounts.credits || debits.toString() !== manifest.amounts.debits || netAmount.toString() !== manifest.amounts.net) {
    fail("local manifest amounts do not match JSONL");
  }
  return { transactionCount: records.length, entryCount, txTypes, credits: credits.toString(), debits: debits.toString(), netAmount: netAmount.toString() };
}

export function buildObjectPath(manifestOrSha) {
  const sha = typeof manifestOrSha === "string" ? manifestOrSha : manifestOrSha?.sha256?.compressed_artifact;
  assertSha(sha, "compressed_artifact SHA-256");
  return `v1/sha256/${sha}.jsonl.gz`;
}

export function verifyArchiveBytes({ compressedBytes: inputBytes, manifest, target, artifactName }) {
  const compressedBytes = Buffer.from(inputBytes || []);
  if (compressedBytes.length > ARCHIVE_MAX_BYTES) fail("artifact exceeds the 6 MiB Storage limit");
  const { cursorStart, cursorEnd } = verifyManifestShape(manifest, artifactName, target);
  const compressedSha256 = crypto.createHash("sha256").update(compressedBytes).digest("hex");
  if (compressedBytes.length !== manifest.bytes.compressed || compressedSha256 !== manifest.sha256.compressed_artifact) {
    fail("local compressed artifact does not match its manifest");
  }
  let rawBytes;
  try {
    rawBytes = gunzipSync(compressedBytes);
  } catch {
    fail("local artifact is not a valid gzip stream");
  }
  const rawSha256 = crypto.createHash("sha256").update(rawBytes).digest("hex");
  if (rawBytes.length !== manifest.bytes.raw || rawSha256 !== manifest.sha256.raw_jsonl) fail("local raw JSONL does not match its manifest");
  const rawText = rawBytes.toString("utf8");
  const records = parseJsonl(rawText);
  if (serializeRecords(records) !== rawText) fail("local JSONL round-trip verification failed");
  const summary = summarizeRecords(records, manifest);
  const expectedRatio = rawBytes.length === 0 ? null : Number((compressedBytes.length / rawBytes.length).toFixed(6));
  if (manifest.bytes.compression_ratio_compressed_over_raw !== expectedRatio) fail("local compression ratio does not match its manifest");
  return {
    manifest,
    compressedBytes,
    rawBytes,
    records,
    objectPath: buildObjectPath(manifest),
    cursorStart,
    cursorEnd,
    summary,
  };
}

export function verifyLocalArchive({ artifactPath, manifestPath, target }) {
  if (!artifactPath || !manifestPath) fail("--artifact and --manifest are required");
  const artifact = path.resolve(artifactPath);
  const manifestFile = path.resolve(manifestPath);
  const stat = fs.statSync(artifact);
  if (!stat.isFile()) fail("artifact must be a regular file");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  return {
    artifactPath: artifact,
    manifestPath: manifestFile,
    ...verifyArchiveBytes({
      compressedBytes: fs.readFileSync(artifact),
      manifest,
      target,
      artifactName: path.basename(artifact),
    }),
  };
}

function bucketRequestPath() {
  return `/storage/v1/bucket/${encodeURIComponent(ARCHIVE_BUCKET)}`;
}

function objectRequestPath(objectPath, mode = "authenticated") {
  const accessSegment = mode ? `/${mode}` : "";
  return `/storage/v1/object${accessSegment}/${encodeURIComponent(ARCHIVE_BUCKET)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

async function storageRequest(storageTarget, requestPath, options = {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  return fetchImpl(`${storageTarget.baseUrl}${requestPath}`, {
    ...options,
    headers: {
      apikey: storageTarget.serviceKey,
      Authorization: `Bearer ${storageTarget.serviceKey}`,
      ...(options.headers || {}),
    },
  });
}

function storageFailure(operation, response) {
  fail(`Storage API ${operation} failed with HTTP ${response.status}`);
}

async function readJsonResponse(response, operation) {
  try {
    return await response.json();
  } catch {
    fail(`Storage API ${operation} returned invalid JSON`);
  }
}

async function isMissingStorageResponse(response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.text().catch(() => "");
  return /not found|does not exist/i.test(body);
}

function verifyBucket(bucket) {
  if (!bucket || bucket.id !== ARCHIVE_BUCKET || bucket.name !== ARCHIVE_BUCKET) {
    fail("Storage archive bucket has an unexpected name");
  }
  if (bucket.public !== false) fail("Storage archive bucket must be private");
  if (Number(bucket.file_size_limit) !== ARCHIVE_MAX_BYTES) fail("Storage archive bucket has an unexpected file size limit");
  if (!Array.isArray(bucket.allowed_mime_types) || bucket.allowed_mime_types.length !== 1 || bucket.allowed_mime_types[0] !== ARCHIVE_MIME_TYPE) {
    fail("Storage archive bucket has an unexpected MIME policy");
  }
  return bucket;
}

export async function verifyArchiveBucket(storageTarget, deps = {}) {
  const response = await storageRequest(storageTarget, bucketRequestPath(), { method: "GET" }, deps);
  if (!response.ok) storageFailure("bucket verification", response);
  return verifyBucket(await readJsonResponse(response, "bucket verification"));
}

export async function ensureArchiveBucket(storageTarget, deps = {}) {
  let response = await storageRequest(storageTarget, bucketRequestPath(), { method: "GET" }, deps);
  if (await isMissingStorageResponse(response)) {
    const createResponse = await storageRequest(storageTarget, "/storage/v1/bucket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: ARCHIVE_BUCKET,
        name: ARCHIVE_BUCKET,
        public: false,
        allowed_mime_types: [ARCHIVE_MIME_TYPE],
        file_size_limit: ARCHIVE_MAX_BYTES,
      }),
    }, deps);
    if (!createResponse.ok && createResponse.status !== 409) storageFailure("bucket creation", createResponse);
    response = await storageRequest(storageTarget, bucketRequestPath(), { method: "GET" }, deps);
  }
  if (!response.ok) storageFailure("bucket verification/creation", response);
  return verifyBucket(await readJsonResponse(response, "bucket verification/creation"));
}

function manifestRow(manifest, storageTarget, objectPath) {
  const start = manifest.cursor.start;
  const end = manifest.cursor.end;
  return {
    object_path: objectPath,
    project_ref: storageTarget.projectRef,
    format_version: String(manifest.schema_version),
    cutoff: manifest.cutoff.created_at,
    cursor_start_created_at: start?.created_at || null,
    cursor_start_id: start?.id || null,
    cursor_end_created_at: end?.created_at || null,
    cursor_end_id: end?.id || null,
    first_created_at: manifest.time_range.first_created_at || null,
    last_created_at: manifest.time_range.last_created_at || null,
    transaction_count: String(manifest.batch.transactions),
    entry_count: String(manifest.batch.entries),
    tx_types: manifest.batch.tx_types,
    raw_bytes: String(manifest.bytes.raw),
    compressed_bytes: String(manifest.bytes.compressed),
    raw_sha256: manifest.sha256.raw_jsonl,
    compressed_sha256: manifest.sha256.compressed_artifact,
    credits: manifest.amounts.credits,
    debits: manifest.amounts.debits,
    net_amount: manifest.amounts.net,
    status: "pending",
  };
}

const IMMUTABLE_FIELDS = [
  "object_path", "project_ref", "format_version", "cutoff", "cursor_start_created_at", "cursor_start_id",
  "cursor_end_created_at", "cursor_end_id", "first_created_at", "last_created_at", "transaction_count",
  "entry_count", "tx_types", "raw_bytes", "compressed_bytes", "raw_sha256", "compressed_sha256", "credits", "debits", "net_amount",
];

function assertSameManifest(existing, expected) {
  if (!existing) fail("archive manifest disappeared during storage operation");
  if (existing.status !== "pending" && existing.status !== "committed") fail("archive manifest has an invalid state");
  for (const field of IMMUTABLE_FIELDS) {
    if (!sameValue(existing[field], expected[field], field)) fail(`archive manifest differs in immutable field: ${field}`);
  }
  return existing;
}

export async function loadOrCreatePendingBatch(localArchive, storageTarget, deps = {}) {
  const store = deps.manifestStore;
  if (!store || typeof store.get !== "function" || typeof store.insertPending !== "function") fail("manifest store adapter is required");
  const expected = manifestRow(localArchive.manifest, storageTarget, localArchive.objectPath);
  const existing = await store.get(expected.object_path);
  if (existing) return { row: assertSameManifest(existing, expected), created: false, expected };
  await store.insertPending(expected);
  const current = await store.get(expected.object_path);
  return { row: assertSameManifest(current, expected), created: true, expected };
}

function verifyDownloadedBytes(localArchive, downloaded) {
  if (downloaded.length !== localArchive.compressedBytes.length || !downloaded.equals(localArchive.compressedBytes)) {
    fail("downloaded Storage object does not match the local artifact");
  }
  return {
    compressedBytes: downloaded.length,
    compressedSha256: crypto.createHash("sha256").update(downloaded).digest("hex"),
  };
}

async function downloadObject(localArchive, storageTarget, deps = {}) {
  const response = await storageRequest(storageTarget, objectRequestPath(localArchive.objectPath), { method: "GET" }, deps);
  if (!response.ok) return { response, downloaded: null };
  return { response, downloaded: Buffer.from(await response.arrayBuffer()) };
}

export async function downloadPrivateArchiveObject(storageTarget, objectPath, deps = {}) {
  const startedAt = Date.now();
  const response = await storageRequest(storageTarget, objectRequestPath(objectPath), { method: "GET" }, deps);
  if (!response.ok) storageFailure("private object download", response);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    downloadMs: Date.now() - startedAt,
  };
}

export async function uploadOrVerifyObject(localArchive, storageTarget, deps = {}) {
  const initialDownloadStarted = Date.now();
  const existing = await downloadObject(localArchive, storageTarget, deps);
  const initialDownloadMs = Date.now() - initialDownloadStarted;
  let objectExisted = false;
  let uploaded = false;
  let uploadMs = 0;
  if (existing.response.ok) {
    objectExisted = true;
    const verified = verifyDownloadedBytes(localArchive, existing.downloaded);
    return { objectExisted, uploaded, uploadMs, downloadMs: initialDownloadMs, ...verified };
  }
  if (!(await isMissingStorageResponse(existing.response))) storageFailure("object lookup", existing.response);
  if (deps.manifestStatus === "committed") fail("committed archive object is missing");
  const uploadStarted = Date.now();
  const uploadResponse = await storageRequest(storageTarget, objectRequestPath(localArchive.objectPath, ""), {
    method: "POST",
    headers: { "content-type": ARCHIVE_MIME_TYPE, "x-upsert": "false" },
    body: localArchive.compressedBytes,
  }, deps);
  uploadMs = Date.now() - uploadStarted;
  if (!uploadResponse.ok && uploadResponse.status !== 400 && uploadResponse.status !== 409) {
    storageFailure("object upload", uploadResponse);
  }
  uploaded = uploadResponse.ok;
  objectExisted = !uploaded;
  const downloadStarted = Date.now();
  const downloaded = await downloadObject(localArchive, storageTarget, deps);
  const downloadMs = Date.now() - downloadStarted;
  if (!downloaded.response.ok) storageFailure("object download", downloaded.response);
  const verified = verifyDownloadedBytes(localArchive, downloaded.downloaded);
  return { objectExisted, uploaded, uploadMs, downloadMs, ...verified };
}

export async function markBatchCommitted(batch, deps = {}) {
  const store = deps.manifestStore;
  if (!store || typeof store.markCommitted !== "function") fail("manifest store adapter is required");
  const committed = await store.markCommitted(batch.expected.object_path);
  const row = assertSameManifest(committed, batch.expected);
  if (row.status !== "committed") fail("archive manifest was not committed");
  return row;
}

function selectManifestSql() {
  return `select
    object_path,
    project_ref,
    format_version::text as format_version,
    cutoff::text as cutoff,
    cursor_start_created_at::text as cursor_start_created_at,
    cursor_start_id::text as cursor_start_id,
    cursor_end_created_at::text as cursor_end_created_at,
    cursor_end_id::text as cursor_end_id,
    first_created_at::text as first_created_at,
    last_created_at::text as last_created_at,
    transaction_count::text as transaction_count,
    entry_count::text as entry_count,
    tx_types::text as tx_types,
    raw_bytes::text as raw_bytes,
    compressed_bytes::text as compressed_bytes,
    raw_sha256,
    compressed_sha256,
    credits::text as credits,
    debits::text as debits,
    net_amount::text as net_amount,
    status
  from public.chips_ledger_archive_batches
  where object_path = $1;`;
}

function normalizeManifestRow(row) {
  if (!row) return null;
  return {
    ...row,
    format_version: String(row.format_version),
    tx_types: typeof row.tx_types === "string" ? JSON.parse(row.tx_types) : row.tx_types,
    transaction_count: String(row.transaction_count),
    entry_count: String(row.entry_count),
    raw_bytes: String(row.raw_bytes),
    compressed_bytes: String(row.compressed_bytes),
    credits: String(row.credits),
    debits: String(row.debits),
    net_amount: String(row.net_amount),
  };
}

export function createManifestStore(sql) {
  if (!sql || typeof sql.unsafe !== "function") fail("postgres manifest adapter is required");
  const timestampParam = (value) => value == null || typeof sql.typed !== "function" ? value : sql.typed(value, 25);
  const get = async (objectPath) => {
    const rows = await sql.unsafe(selectManifestSql(), [objectPath]);
    return normalizeManifestRow(rows[0]);
  };
  return {
    get,
    async insertPending(row) {
      await sql.unsafe(`insert into public.chips_ledger_archive_batches
        (object_path, project_ref, format_version, cutoff, cursor_start_created_at, cursor_start_id,
         cursor_end_created_at, cursor_end_id, first_created_at, last_created_at, transaction_count,
         entry_count, tx_types, raw_bytes, compressed_bytes, raw_sha256, compressed_sha256,
         credits, debits, net_amount, status)
        values ($1, $2, $3::integer, $4::timestamptz, $5::timestamptz, $6::uuid,
                $7::timestamptz, $8::uuid, $9::timestamptz, $10::timestamptz, $11::bigint,
                $12::bigint, $13::jsonb, $14::bigint, $15::bigint, $16, $17,
                $18::numeric, $19::numeric, $20::numeric, 'pending')
        on conflict (object_path) do nothing;`, [
        row.object_path, row.project_ref, row.format_version, timestampParam(row.cutoff), timestampParam(row.cursor_start_created_at), row.cursor_start_id,
        timestampParam(row.cursor_end_created_at), row.cursor_end_id, timestampParam(row.first_created_at), timestampParam(row.last_created_at), row.transaction_count,
        row.entry_count, row.tx_types, row.raw_bytes, row.compressed_bytes, row.raw_sha256, row.compressed_sha256,
        row.credits, row.debits, row.net_amount,
      ]);
    },
    async markCommitted(objectPath) {
      const rows = await sql.unsafe(`update public.chips_ledger_archive_batches
        set status = 'committed', committed_at = timezone('utc', now())
        where object_path = $1 and status = 'pending'
        returning object_path;`, [objectPath]);
      if (!rows.length) return get(objectPath);
      return get(objectPath);
    },
  };
}

function outputMetrics(result) {
  process.stdout.write(`${stringifyJson({
    event: "chips_ledger_archive_store",
    read_only_ledger: true,
    target: result.target,
    project_ref: result.projectRef,
    bucket: ARCHIVE_BUCKET,
    object_path: result.objectPath,
    status: result.manifest.status,
    idempotent: result.idempotent,
    transactions: result.local.summary.transactionCount,
    entries: result.local.summary.entryCount,
    tx_types: result.local.manifest.batch.tx_types,
    amounts: result.local.manifest.amounts,
    raw_bytes: result.local.manifest.bytes.raw,
    compressed_bytes: result.local.manifest.bytes.compressed,
    sha256: result.local.manifest.sha256,
    uploaded: result.object.uploaded,
    object_existed: result.object.objectExisted,
    upload_ms: result.object.uploadMs,
    download_ms: result.object.downloadMs,
  })}\n`);
}

export async function storeArchive({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), deps = {} } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return null;
  }
  if (!args.target) fail("--target is required; no default target is allowed");
  if (!args.artifact) fail("--artifact is required; no default path is allowed");
  if (!args.manifest) fail("--manifest is required; no default path is allowed");
  const storageTarget = resolveStorageTarget(args.target, env);
  const local = verifyLocalArchive({ artifactPath: path.resolve(cwd, args.artifact), manifestPath: path.resolve(cwd, args.manifest), target: storageTarget });
  const sql = deps.sql || (deps.manifestStore ? null : postgres(storageTarget.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 30 }));
  const manifestStore = deps.manifestStore || createManifestStore(sql);
  const adapterDeps = { ...deps, manifestStore };
  try {
    const batch = await loadOrCreatePendingBatch(local, storageTarget, adapterDeps);
    await ensureArchiveBucket(storageTarget, deps);
    const object = await uploadOrVerifyObject(local, storageTarget, { ...deps, manifestStatus: batch.row.status });
    const manifest = await markBatchCommitted(batch, adapterDeps);
    const result = {
      target: storageTarget.target,
      projectRef: storageTarget.projectRef,
      objectPath: local.objectPath,
      local,
      object,
      manifest,
      idempotent: manifest.status === "committed" && !object.uploaded,
    };
    if (deps.emit !== false) outputMetrics(result);
    return result;
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  storeArchive().catch((error) => {
    process.stderr.write(`chips-ledger-archive-store failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
