import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import postgres from 'postgres';
import { loadLedgerCapacity } from '../../netlify/functions/_shared/ledger-capacity.mjs';

function klog(kind, data) {
  process.stdout.write(`[klog] ${kind} ${JSON.stringify(data)}\n`);
}

// Canonical Stage identity, matching the Stage automation preflight.
export const STAGE_REF = 'krydukthwdvccggbyjfw';
const STAGE_SYSTEM_IDENTIFIER = '7656985631720456337';
const CPU = 'node_cpu_seconds_total';
const DISK = ['node_disk_read_bytes_total', 'node_disk_written_bytes_total',
  'node_disk_reads_completed_total', 'node_disk_writes_completed_total'];
const SERIES_RE = new RegExp(`^(?:${[CPU, ...DISK].join('|')})(?:\\{|\\s)`);
const CPU_MODES = ['idle', 'iowait', 'irq', 'nice', 'softirq', 'steal', 'system', 'user'];

function safeBytes(value) {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

// Only documented Supabase series are interpreted; unknown series are ignored.
export function parseMetrics(source) {
  const samples = new Map();
  for (const line of source.split('\n')) {
    if (!SERIES_RE.test(line)) continue;
    const match = /^(\w+)\{((?:[^"{}]|"(?:\\.|[^"\\])*")*)\}\s+(\S+)(?:\s+\d+)?\s*$/.exec(line);
    if (!match) throw new Error('invalid_metrics');
    const labels = {};
    let rest = match[2];
    while (rest.trim()) {
      const label = /^\s*(\w+)="((?:\\.|[^"\\])*)"\s*(?:,|$)/.exec(rest);
      if (!label || Object.hasOwn(labels, label[1])) throw new Error('invalid_labels');
      labels[label[1]] = JSON.parse(`"${label[2]}"`);
      rest = rest.slice(label[0].length);
    }
    if (labels.supabase_project_ref !== STAGE_REF || labels.service_type !== 'db') continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value) || value < 0) throw new Error('invalid_counter');
    const key = JSON.stringify([match[1], Object.entries(labels).sort()]);
    if (samples.has(key)) throw new Error('duplicate_series');
    samples.set(key, { name: match[1], labels, value });
  }
  return samples;
}

export function measureWindow(first, second, seconds) {
  const result = { windowSeconds: seconds, cpuPercent: null, iowaitPercent: null, disks: [] };
  if (!Number.isFinite(seconds) || seconds < 55 || seconds > 75) return result;
  const deltas = [];
  // A reset or a changed series set invalidates the window, never becomes zero load.
  if (first.size !== second.size) return result;
  for (const [key, current] of second) {
    const previous = first.get(key);
    if (!previous || current.value < previous.value) return result;
    deltas.push({ ...current, delta: current.value - previous.value });
  }
  const cpus = new Map();
  for (const sample of deltas.filter((s) => s.name === CPU)) {
    const { cpu, mode, ...instance } = sample.labels;
    if (!cpu || !CPU_MODES.includes(mode)) continue;
    const key = JSON.stringify([instance, cpu]);
    if (!cpus.has(key)) cpus.set(key, {});
    cpus.get(key)[mode] = sample.delta;
  }
  let total = 0, idle = 0, wait = 0;
  for (const modes of cpus.values()) {
    if (!CPU_MODES.every((mode) => Object.hasOwn(modes, mode))) return result;
    const ticks = Object.values(modes).reduce((a, b) => a + b, 0);
    if (ticks < seconds * 0.8 || ticks > seconds * 1.2) return result;
    total += ticks; idle += modes.idle; wait += modes.iowait;
  }
  if (total > 0) {
    result.cpuPercent = 100 * (total - idle - wait) / total;
    result.iowaitPercent = 100 * wait / total;
  }
  const devices = new Map();
  for (const sample of deltas.filter((s) => DISK.includes(s.name))) {
    const device = sample.labels.device;
    if (!device) continue;
    const key = JSON.stringify(Object.entries(sample.labels).sort());
    if (!devices.has(key)) devices.set(key, { device });
    devices.get(key)[sample.name] = sample.delta / seconds;
  }
  for (const device of devices.values()) {
    if (DISK.every((name) => Number.isFinite(device[name]))) result.disks.push({
      device: device.device, readBytesPerSecond: device[DISK[0]], writeBytesPerSecond: device[DISK[1]],
      readIops: device[DISK[2]], writeIops: device[DISK[3]],
    });
  }
  return result;
}

export function parseDiskUtilization(payload) {
  const metrics = payload?.metrics;
  if (!metrics || typeof metrics !== 'object') return null;
  const fsSizeBytes = safeBytes(metrics.fs_size_bytes);
  const fsAvailBytes = safeBytes(metrics.fs_avail_bytes);
  const fsUsedBytes = safeBytes(metrics.fs_used_bytes);
  if (fsSizeBytes == null || fsAvailBytes == null || fsUsedBytes == null
    || fsSizeBytes <= 0 || fsAvailBytes > fsSizeBytes || fsUsedBytes > fsSizeBytes) return null;
  return { fsSizeBytes, fsAvailBytes, fsUsedBytes };
}

const level = (value, warning, critical) => value == null ? 'unknown'
  : value >= critical ? 'critical' : value >= warning ? 'warning' : 'healthy';

function filesystemCapacityPercent(diskUtilization) {
  return diskUtilization?.fsSizeBytes > 0
    && diskUtilization.fsUsedBytes <= diskUtilization.fsSizeBytes
    ? diskUtilization.fsUsedBytes / diskUtilization.fsSizeBytes * 100 : null;
}

export function classify(window, capacity, diskUtilization) {
  const cpu = level(window.cpuPercent, 70, 85);
  const wait = level(window.iowaitPercent, 10, 20);
  const pressure = cpu === 'critical' || wait === 'critical' ? 'critical'
    : cpu === 'unknown' || wait === 'unknown' || !window.disks.length ? 'unknown'
    : cpu === 'warning' || wait === 'warning' ? 'warning' : 'healthy';
  const dbBytes = capacity?.available && Number.isSafeInteger(capacity.dbTotalBytes) && capacity.dbTotalBytes > 0
    ? capacity.dbTotalBytes : null;
  const capacityPercent = filesystemCapacityPercent(diskUtilization);
  const capacityState = level(capacityPercent, 70, 85);
  const state = pressure === 'critical' ? 'critical'
    : pressure === 'unknown' || capacityState === 'unknown' ? 'unknown'
    : pressure === 'warning' || capacityState === 'critical' || capacityState === 'warning' ? 'warning'
    : 'healthy';
  return { state, pressureState: pressure, capacityState,
    databaseBytes: dbBytes, ledgerBytes: capacity?.ledgerTotalBytes ?? null,
    filesystemSizeBytes: diskUtilization?.fsSizeBytes ?? null,
    filesystemAvailableBytes: diskUtilization?.fsAvailBytes ?? null,
    filesystemUsedBytes: diskUtilization?.fsUsedBytes ?? null, capacityPercent,
    cleanupDecision: 'not_evaluated_monitor_only' };
}

export async function readCapacity(env, diskUtilization, createSql = postgres) {
  const url = new URL(env.SUPABASE_STAGE_DB_URL);
  const direct = url.hostname === `db.${STAGE_REF}.supabase.co`;
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && decodeURIComponent(url.username) === `postgres.${STAGE_REF}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || (!direct && !pooler)) throw new Error('invalid_stage');
  const sql = createSql(url.href, { ssl: 'require', max: 1, prepare: false, connect_timeout: 10,
    connection: { default_transaction_read_only: 'on' } });
  try {
    return await sql.begin('read only', async (tx) => {
      await tx.unsafe(`select set_config('statement_timeout',
        least(coalesce(nullif(setting::bigint, 0), 5000), 5000)::text, true)
        from pg_catalog.pg_settings where name = 'statement_timeout'`);
      const identity = await tx.unsafe('select system_identifier::text from pg_catalog.pg_control_system()');
      if (identity[0]?.system_identifier !== STAGE_SYSTEM_IDENTIFIER) throw new Error('invalid_stage_identity');
      const capacity = await loadLedgerCapacity(env, (query) => tx.unsafe(query), undefined, { includeRowCounts: false });
      let relations = [];
      const capacityState = level(filesystemCapacityPercent(diskUtilization), 70, 85);
      if (['warning', 'critical'].includes(capacityState)) {
        relations = await tx.unsafe(`select n.nspname as schema, c.relname as relation,
          pg_total_relation_size(c.oid)::text as bytes
          from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'm') and n.nspname not in ('pg_catalog', 'information_schema')
          order by pg_total_relation_size(c.oid) desc limit 10`);
      }
      return { capacity, relations };
    });
  } finally { await sql.end({ timeout: 1 }); }
}

export async function monitor(env = process.env, fetchImpl = fetch, wait = sleep, now = () => performance.now(), read = readCapacity) {
  const errors = [];
  async function get(path, json = false) {
    if (!env.SUPABASE_STAGE_MANAGEMENT_TOKEN) throw new Error('missing_token');
    const response = await fetchImpl(`https://api.supabase.com/v1/projects/${STAGE_REF}/${path}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${env.SUPABASE_STAGE_MANAGEMENT_TOKEN}` },
    });
    if (!response.ok) throw new Error('api_failed');
    return json ? response.json() : response.text();
  }
  let window = { windowSeconds: null, cpuPercent: null, iowaitPercent: null, disks: [] };
  let disk = null, diskUtilization = null, capacity = null, relations = [];
  try {
    const first = parseMetrics(await get('analytics/endpoints/metrics'));
    const start = now();
    await wait(60000);
    const second = parseMetrics(await get('analytics/endpoints/metrics'));
    window = measureWindow(first, second, (now() - start) / 1000);
  } catch { errors.push('metrics_unavailable'); }
  try { disk = (await get('config/disk', true)).attributes; } catch { errors.push('disk_config_unavailable'); }
  try {
    diskUtilization = parseDiskUtilization(await get('config/disk/util', true));
    if (!diskUtilization) errors.push('disk_utilization_unavailable');
  } catch { errors.push('disk_utilization_unavailable'); }
  try { ({ capacity, relations } = await read(env, diskUtilization)); } catch { errors.push('capacity_unavailable'); }
  const health = classify(window, capacity, diskUtilization);
  return { ...health, ...window, diskConfiguration: disk ? {
    sizeGb: disk.size_gb, iops: disk.iops, throughputMibps: disk.throughput_mibps, type: disk.type,
  } : null, diskUtilization: diskUtilization ? {
    fsSizeBytes: diskUtilization.fsSizeBytes, fsAvailBytes: diskUtilization.fsAvailBytes,
    fsUsedBytes: diskUtilization.fsUsedBytes,
  } : null, wal: null, diskIoConsumedPercent: null,
  unavailable: ['wal_no_verified_series', 'disk_io_budget_no_authoritative_series', 'historical_growth_no_history'],
  largestRelations: relations, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await monitor();
  klog('stage_supabase_resource_health', report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Stage Supabase resource health\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
  if (report.state === 'unknown' || report.state === 'critical') process.exitCode = 1;
}
