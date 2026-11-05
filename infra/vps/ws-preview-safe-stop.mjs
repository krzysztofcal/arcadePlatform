#!/usr/bin/node
// Stage-only adapter. Import the Production gate's pure checks, never its CLI or host defaults.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateRestartGate, DB_QUIET_SQL, PRESENCE_SQL, parseDbQuiet, parsePresence } from './ws-restart-gate.mjs';

export const UNIT = 'ws-server-preview.service';
export const STAGE = 'krydukthwdvccggbyjfw';
export const TTL = 15 * 60 * 1000;
const BUNDLE = '/usr/local/libexec/arcade-vps-admin';
const RECEIPT = '/var/lib/arcade-admin/ws-preview-safe-stop/receipt.json';
const ENV = '/opt/arcade-ws-preview/.env.preview';
const SIGNER = '/etc/arcadeplatform/ws-preview-signing.env';
const HOLD = '/etc/arcadeplatform/ws-hold-preview/new-hands';
const CGROUP = '/sys/fs/cgroup/system.slice/ws-server-preview.service';
const PROPERTIES = ['LoadState', 'ActiveState', 'MainPID', 'ExecMainStartTimestampMonotonic', 'User', 'WorkingDirectory',
  'EnvironmentFiles', 'Environment', 'ControlGroup', 'ExecStartEx', 'ExecStop', 'ExecStopPost', 'KillMode', 'NeedDaemonReload', 'Result'];
const require = (ok, reason) => { if (!ok) throw new Error(reason); };
const hash = data => createHash('sha256').update(data).digest('hex');
const envParse = source => {
  const values = Object.create(null);
  for (const line of source.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    require(m && !Object.hasOwn(values, m[1]), 'environment_syntax');
    let value = m[2].trim();
    if (/^["']/.test(value)) { require(value.length >= 2 && value.at(-1) === value[0], 'environment_quote'); value = value.slice(1, -1); }
    values[m[1]] = value;
  }
  return values;
};

// Test overrides are exported JS dependencies only, never CLI/environment options.
export function createHost(overrides = {}) {
  return {
    now: Date.now, uid: 0, gid: 0, boundary: '/', receipt: RECEIPT, envFile: ENV, signer: SIGNER, hold: HOLD, bundle: BUNDLE, preflight: '/usr/local/sbin/arcade-ws-preview-env-preflight',
    run(argv, timeout = 10000, input, extraEnv = {}) {
      const result = spawnSync(argv[0], argv.slice(1), { input, timeout, encoding: 'utf8', maxBuffer: 1048576,
        env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', ...extraEnv }, stdio: ['pipe', 'pipe', 'ignore'] });
      require(!result.error && result.status === 0, 'command_failed_or_uncertain');
      return result.stdout.trim();
    },
    async runtime(token) {
      const response = await fetch('http://127.0.0.1:3001/internal/admin/poker-maintenance', {
        headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-store' }, redirect: 'error', signal: AbortSignal.timeout(5000)
      });
      require(response.status === 200, 'runtime_http');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; require(size <= 1048576, 'runtime_response_size'); chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },
    cgroupEmpty() {
      // A removed unit cgroup is proof of absence only after loaded/inactive/MainPID=0 was verified.
      require(fs.lstatSync('/sys/fs/cgroup/system.slice').isDirectory(), 'cgroup_parent');
      try {
        require(fs.lstatSync(CGROUP).isDirectory(), 'cgroup_type');
        require(/^populated 0$/m.test(fs.readFileSync(`${CGROUP}/cgroup.events`, 'utf8')), 'cgroup_populated');
        require(fs.readFileSync(`${CGROUP}/cgroup.procs`, 'utf8').trim() === '', 'cgroup_processes');
      } catch (error) { if (error.code !== 'ENOENT' || fs.existsSync(CGROUP)) throw error; }
    }, ...overrides
  };
}

function parents(host, file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    require(dir === host.boundary || dir.startsWith(host.boundary === '/' ? '/' : host.boundary + '/'), 'path_boundary');
    const st = fs.lstatSync(dir);
    require(st.isDirectory() && st.uid === host.uid && st.gid === host.gid && !(st.mode & 0o022), 'unprotected_parent');
    if (dir === host.boundary) break;
  }
}
function read(host, file, mode) {
  parents(host, file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    require(st.isFile() && st.nlink === 1 && st.uid === host.uid && st.gid === host.gid
      && (st.mode & 0o7777) === mode && st.size <= 1048576, 'unprotected_file');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
function writeReceipt(host, data) {
  parents(host, host.receipt);
  if (fs.existsSync(host.receipt)) read(host, host.receipt, 0o600);
  const tmp = host.receipt + '.pending';
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, host.receipt);
  const dir = fs.openSync(path.dirname(host.receipt), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function unit(host, stopped = false) {
  const raw = host.run(['/usr/bin/systemctl', 'show', UNIT, '--all', ...PROPERTIES.flatMap(p => ['-p', p])]);
  const entries = raw.split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; });
  const u = Object.create(null);
  for (const [key, value] of entries) {
    require(PROPERTIES.includes(key) && (!Object.hasOwn(u, key) || key === 'EnvironmentFiles'), 'unit_properties');
    u[key] = Object.hasOwn(u, key) ? u[key] + ' ' + value : value;
  }
  require(PROPERTIES.every(k => Object.hasOwn(u, k)), 'unit_properties');
  require(u.LoadState === 'loaded' && u.NeedDaemonReload === 'no' && u.KillMode === 'control-group'
    && ['arcade', 'arcade-preview'].includes(u.User) && u.WorkingDirectory === '/opt/arcade-ws-preview/ws-server' && (u.ControlGroup === '/system.slice/ws-server-preview.service' || stopped && u.ControlGroup === '')
    && /^\{ path=\/usr\/bin\/node ; argv\[\]=\/usr\/bin\/node server.mjs ; flags= ;/.test(u.ExecStartEx)
    && u.ExecStop === '' && u.ExecStopPost === '' && /^[1-9][0-9]*$/.test(u.ExecMainStartTimestampMonotonic), 'unit_configuration');
  require(stopped ? u.ActiveState === 'inactive' && u.MainPID === '0' && u.Result === 'success'
    : u.ActiveState === 'active' && /^[1-9][0-9]*$/.test(u.MainPID), 'unit_state');
  if (stopped) host.cgroupEmpty();
  return u;
}
function configuration(host, u) {
  const source = read(host, host.envFile, 0o600), values = envParse(source);
  const allowed = [`${ENV} (ignore_errors=no)`, `${ENV} (ignore_errors=no) ${SIGNER} (ignore_errors=yes)`,
    `${ENV} (ignore_errors=no) ${SIGNER} (ignore_errors=no)`];
  require(allowed.includes(u.EnvironmentFiles), 'unit_environment_files');
  // Unit Environment may set only the fixed hold; credentials must come from the attested files.
  require(u.Environment === `WS_POKER_NEW_HANDS_HOLD_FILE=${HOLD}`, 'unit_environment');
  let signer = '';
  if (u.EnvironmentFiles.includes(SIGNER)) {
    signer = read(host, host.signer, 0o600);
    const extra = envParse(signer);
    require(Object.keys(extra).length === 1 && !!extra.WS_AUTH_HS256_SECRET && !values.WS_AUTH_HS256_SECRET, 'signer_configuration');
  }
  require(!Object.hasOwn(values, 'WS_POKER_NEW_HANDS_HOLD_FILE') && !values.WS_PERSISTED_STATE_FILE
    && values.SUPABASE_STAGE_PROJECT_REF === STAGE && values.PORT === '3001'
    && values.WS_AUTHORITATIVE_JOIN_ENABLED === '1'
    && (values.SUPABASE_URL || values.SUPABASE_URL_V2) === `https://${STAGE}.supabase.co`
    && !!values.POKER_WS_INTERNAL_TOKEN, 'stage_configuration');
  const db = new URL(values.SUPABASE_DB_URL);
  require(['postgres:', 'postgresql:'].includes(db.protocol) && db.pathname === '/postgres' && !!db.password
    && (db.hostname === `db.${STAGE}.supabase.co` && decodeURIComponent(db.username) === 'postgres'
      || /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(db.hostname) && decodeURIComponent(db.username) === `postgres.${STAGE}`)
    && ['5432', '6543', ''].includes(db.port), 'stage_database_identity');
  const drain = read(host, host.hold, 0o644);
  require(drain.trim() === 'drain', 'protected_drain_required');
  const preflight = host.preflight;
  require(hash(read(host, preflight, 0o755)) === '704dc9a8dd59fa96625f63199f3605b888b7eaecabd4a4dcb724a4862d22993e', 'stage_preflight_version');
  require(host.run([preflight, '--config-only']).startsWith('PASS CONFIG ONLY'), 'stage_preflight');
  const fingerprint = hash(JSON.stringify([source, signer, drain, ...['ws-preview-safe-stop.mjs', 'ws-restart-gate.mjs']
    .map(name => read(host, path.join(host.bundle, name), 0o644))]));
  return { db, token: values.POKER_WS_INTERNAL_TOKEN, fingerprint };
}

// Four bounded aggregate result rows, not table/history downloads; transaction is explicitly read-only.
export const DATABASE_SQL = `BEGIN READ ONLY; SET LOCAL statement_timeout='5000ms';
SELECT current_setting('transaction_read_only');
${DB_QUIET_SQL}\n${PRESENCE_SQL}
SELECT concat_ws('|', (SELECT count(*) FROM public.poker_tables WHERE status='OPEN'),
 (SELECT count(*) FROM public.poker_managed_table_profiles),
 (SELECT count(*) FROM public.poker_managed_table_profiles WHERE profile_key='CONTINUOUS_BOT_DEFAULT' AND enabled=false AND desired_table_count=0));
ROLLBACK;`;
function database(host, config) {
  const db = config.db;
  const rows = host.run(['/usr/bin/psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-h', db.hostname, '-p', db.port || '5432',
    '-U', decodeURIComponent(db.username), '-d', 'postgres'], 15000, DATABASE_SQL,
  { PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '5' }).split('\n');
  require(rows.length === 4 && rows[0] === 'on' && rows[3] === '0|1|1', 'database_controls');
  const quiet = parseDbQuiet(rows[1]), presence = parsePresence(rows[2]);
  require(quiet && presence && [...Object.values(quiet), ...Object.values(presence)].every(n => n === 0), 'database_not_quiet');
  return presence;
}
async function proof(host, before) {
  const started = host.now(), u = unit(host), config = configuration(host, u);
  require(!before || JSON.stringify(u) === JSON.stringify(before.unit), 'process_or_unit_changed');
  const presence = database(host, config), runtime = await host.runtime(config.token);
  require(runtime.ok === true && runtime.environment === 'preview', 'runtime_identity');
  require(runtime.continuous?.maintenanceEnabled === false && runtime.continuous?.desiredTableCount === 0
    && runtime.continuous?.supervisor?.sweepInProgress === false, 'runtime_supervisor');
  const hold = runtime.newHandsHold;
  require(hold?.humanMemberTables === 0 && hold?.connectedHumanTables === 0, 'runtime_human_presence');
  require(evaluateRestartGate({ serviceState: 'active', httpStatus: 200, holdStatus: hold, presence }).safe, 'runtime_not_quiet');
  require(host.now() - started < 10000 && host.now() >= started, 'stale_proof');
  require(JSON.stringify(unit(host)) === JSON.stringify(u), 'process_or_unit_changed');
  return { unit: u, config };
}
function context(host, u, config) {
  return { unit: u, fingerprint: config.fingerprint, project: STAGE, service: UNIT };
}
export async function operate(mode, runId, overrides = {}) {
  const host = createHost(overrides);
  require(/^[1-9][0-9]{0,19}$/.test(String(runId)), 'run_id');
  if (mode === 'stop') {
    parents(host, host.receipt);
    require(!fs.existsSync(host.receipt), 'receipt_exists_owner_recovery_required');
    const first = await proof(host);
    const final = await proof(host, first);
    require(final.config.fingerprint === first.config.fingerprint, 'configuration_changed');
    // No retry and no auto restart, even if systemctl times out or a later assertion fails.
    require(configuration(host, unit(host)).fingerprint === final.config.fingerprint, 'configuration_changed');
    require(JSON.stringify(unit(host)) === JSON.stringify(final.unit), 'process_or_unit_changed');
    host.run(['/usr/bin/systemctl', 'stop', UNIT], 100000);
    const stopped = unit(host, true), config = configuration(host, stopped);
    require(stopped.ExecMainStartTimestampMonotonic === first.unit.ExecMainStartTimestampMonotonic
      && config.fingerprint === first.config.fingerprint, 'stopped_context_changed');
    database(host, config);
    const now = host.now();
    writeReceipt(host, { version: 1, phase: 'pending_audit', run: String(runId), stoppedAt: now, expiresAt: now + TTL,
      previousPID: first.unit.MainPID, context: context(host, stopped, config) });
    return 'stopped_pending_audit';
  }
  require(['finalize', 'verify-receipt', 'consume-receipt'].includes(mode), 'mode');
  const receipt = JSON.parse(read(host, host.receipt, 0o600));
  const now = host.now();
  require(receipt.version === 1 && receipt.phase === (mode === 'finalize' ? 'pending_audit' : 'ready')
    && Number.isSafeInteger(receipt.stoppedAt) && Number.isSafeInteger(receipt.expiresAt)
    && receipt.stoppedAt <= now && receipt.expiresAt === receipt.stoppedAt + TTL && now < receipt.expiresAt
    && /^[1-9][0-9]{0,19}$/.test(receipt.run) && /^[1-9][0-9]*$/.test(receipt.previousPID), 'receipt_invalid_or_expired');
  if (mode === 'finalize') require(receipt.run === String(runId), 'receipt_run');
  const u = unit(host, true), config = configuration(host, u);
  require(JSON.stringify(receipt.context) === JSON.stringify(context(host, u, config)), 'receipt_context_changed');
  database(host, config);
  if (mode !== 'verify-receipt') {
    receipt.phase = mode === 'finalize' ? 'ready' : 'consumed';
    if (mode === 'consume-receipt') receipt.consumedBy = String(runId);
    writeReceipt(host, receipt);
  }
  return mode === 'finalize' ? 'ready' : mode === 'consume-receipt' ? 'consumed' : 'verified';
}
const main = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (main) {
  try {
    require(process.getuid() === 0 && process.argv.length === 4, 'root_and_exact_arguments_required');
    const result = await operate(process.argv[2], process.argv[3]);
    process.stdout.write(`SAFE_STOP_OK ${result}\n`);
  } catch {
    // Exceptions may contain connection URLs or response bodies: never print them.
    process.stdout.write('SAFE_STOP_BLOCKED inspect_read_only_no_retry\n'); process.exitCode = 1;
  }
}
