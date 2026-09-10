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
  const result = {
    windowSeconds: seconds, cpuPercent: null, iowaitPercent: null, disks: [], measurementReason: null,
  };
  if (!Number.isFinite(seconds) || seconds < 55 || seconds > 75) {
    result.measurementReason = 'window_out_of_range';
    return result;
  }
  let measurementReason = null;
  const setReason = (reason) => {
    if (!measurementReason) measurementReason = reason;
  };
  const group = (samples, names, getGroupKey, getMemberKey) => {
    const groups = new Map();
    for (const sample of samples.values()) {
      if (!names.includes(sample.name)) continue;
      const groupKey = getGroupKey(sample);
      if (!groupKey) continue;
      if (!groups.has(groupKey)) groups.set(groupKey, new Map());
      groups.get(groupKey).set(getMemberKey(sample), sample);
    }
    return groups;
  };
  const sameKeys = (left, right) => left.size === right.size
    && [...left.keys()].every((key) => right.has(key));
  const cpuGroupKey = (sample) => {
    const { cpu, mode, ...instance } = sample.labels;
    return cpu && CPU_MODES.includes(mode)
      ? JSON.stringify([Object.entries(instance).sort(), cpu]) : null;
  };
  const firstCpus = group(first, [CPU], cpuGroupKey, (sample) => sample.labels.mode);
  const secondCpus = group(second, [CPU], cpuGroupKey, (sample) => sample.labels.mode);
  if (!firstCpus.size || !secondCpus.size) {
    setReason('cpu_series_missing');
  } else if (!sameKeys(firstCpus, secondCpus)) {
    setReason('series_set_changed');
  } else {
    let total = 0, idle = 0, wait = 0;
    let cpuInvalid = null;
    for (const [key, firstModes] of firstCpus) {
      const secondModes = secondCpus.get(key);
      if (!CPU_MODES.every((mode) => firstModes.has(mode) && secondModes.has(mode))) {
        cpuInvalid = 'cpu_modes_incomplete';
        break;
      }
      const deltas = {};
      for (const mode of CPU_MODES) {
        const previous = firstModes.get(mode);
        const current = secondModes.get(mode);
        if (current.value < previous.value) {
          cpuInvalid = 'counter_reset';
          break;
        }
        deltas[mode] = current.value - previous.value;
      }
      if (cpuInvalid) break;
      const ticks = Object.values(deltas).reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(ticks) || ticks < seconds * 0.8 || ticks > seconds * 1.2) {
        cpuInvalid = 'cpu_ticks_invalid';
        break;
      }
      total += ticks;
      idle += deltas.idle;
      wait += deltas.iowait;
    }
    if (cpuInvalid) setReason(cpuInvalid);
    else if (!Number.isFinite(total) || total <= 0) setReason('cpu_ticks_invalid');
    else {
      result.cpuPercent = 100 * (total - idle - wait) / total;
      result.iowaitPercent = 100 * wait / total;
    }
  }
  const diskGroupKey = (sample) => sample.labels.device
    ? JSON.stringify(Object.entries(sample.labels).sort()) : null;
  const firstDisks = group(first, DISK, diskGroupKey, (sample) => sample.name);
  const secondDisks = group(second, DISK, diskGroupKey, (sample) => sample.name);
  const complete = (series) => series && DISK.every((name) => series.has(name));
  const firstComplete = new Set();
  let diskReason = null;
  for (const [key, firstSeries] of firstDisks) {
    if (!complete(firstSeries)) {
      diskReason = 'disk_series_incomplete';
      break;
    }
    firstComplete.add(key);
    const secondSeries = secondDisks.get(key);
    if (!complete(secondSeries)) {
      diskReason = 'disk_series_incomplete';
      break;
    }
  }
  if (!diskReason && [...secondDisks].some(([key, series]) => complete(series) && !firstComplete.has(key))) {
    diskReason = 'series_set_changed';
  }
  if (diskReason) {
    setReason(diskReason);
  } else {
    const disks = [];
    let diskReset = false;
    for (const key of firstComplete) {
      const firstSeries = firstDisks.get(key);
      const secondSeries = secondDisks.get(key);
      const deltas = {};
      for (const name of DISK) {
        const previous = firstSeries.get(name);
        const current = secondSeries.get(name);
        if (current.value < previous.value) {
          diskReset = true;
          break;
        }
        deltas[name] = current.value - previous.value;
      }
      if (diskReset) break;
      disks.push({
        device: firstSeries.get(DISK[0]).labels.device,
        readBytesPerSecond: deltas[DISK[0]] / seconds,
        writeBytesPerSecond: deltas[DISK[1]] / seconds,
        readIops: deltas[DISK[2]] / seconds,
        writeIops: deltas[DISK[3]] / seconds,
      });
    }
    if (diskReset) {
      setReason('counter_reset');
    } else if (!disks.length) {
      setReason('disk_series_incomplete');
    } else {
      result.disks = disks;
    }
  }
  result.measurementReason = measurementReason;
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

function isTimeoutError(error) {
  const code = error?.code || error?.cause?.code;
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
    || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code);
}

function metricsErrorCode(error) {
  if (error?.metricsCode === 'metrics_parse_failed') return 'metrics_parse_failed';
  const status = Number(error?.httpStatus);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return status === 403 ? 'metrics_http_403' : `metrics_http_${status}`;
  }
  return isTimeoutError(error) ? 'metrics_timeout' : 'metrics_unavailable';
}

export function evaluateCleanupDecision(state) {
  if (state === 'healthy') return 'allowed_healthy';
  if (state === 'warning') return 'allowed_warning';
  return state === 'critical' ? 'blocked_resource_critical' : 'blocked_resource_unknown';
}

export function exitCodeFor(state, enforce) {
  if (state === 'critical') return 1;
  return enforce && !['healthy', 'warning'].includes(state) ? 1 : 0;
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
    if (!response.ok) throw Object.assign(new Error('api_failed'), { httpStatus: response.status });
    return json ? response.json() : response.text();
  }
  async function scrapeMetrics() {
    const source = await get('analytics/endpoints/metrics');
    try { return parseMetrics(source); }
    catch { throw Object.assign(new Error('metrics_parse_failed'), { metricsCode: 'metrics_parse_failed' }); }
  }
  let window = {
    windowSeconds: null, cpuPercent: null, iowaitPercent: null, disks: [], measurementReason: null,
  };
  let disk = null, diskUtilization = null, capacity = null, relations = [];
  try {
    const first = await scrapeMetrics();
    const start = now();
    await wait(60000);
    const second = await scrapeMetrics();
    window = measureWindow(first, second, (now() - start) / 1000);
  } catch (error) { errors.push(metricsErrorCode(error)); }
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
  const enforce = process.argv.includes('--enforce');
  const report = await monitor();
  if (enforce) report.cleanupDecision = evaluateCleanupDecision(report.state);
  klog('stage_supabase_resource_health', report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Stage Supabase resource health\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
  const exitCode = exitCodeFor(report.state, enforce);
  if (exitCode) process.exitCode = exitCode;
}
