import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { operate, UNIT, STAGE, TTL, DATABASE_SQL, StopUncertain } from '../infra/vps/ws-preview-safe-stop.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-stop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, data, mode = 0o600) => { const file = path.join(root, name); fs.writeFileSync(file, data, { mode }); return file; };
  const envFile = put('env', `SUPABASE_STAGE_PROJECT_REF=${STAGE}\nSUPABASE_URL=https://${STAGE}.supabase.co\nPORT=3001\nWS_AUTHORITATIVE_JOIN_ENABLED=1\nPOKER_WS_INTERNAL_TOKEN=fixture-secret\nSUPABASE_DB_URL=postgresql://postgres.${STAGE}:fixture-password@aws-0-eu-west-3.pooler.supabase.com:5432/postgres\n`);
  const hold = put('hold', 'drain\n', 0o644);
  const preflight = put('preflight', fs.readFileSync('infra/vps/ws-preview-env-preflight.mjs'), 0o755);
  for (const name of ['ws-preview-safe-stop.mjs', 'ws-restart-gate.mjs']) put(name, fs.readFileSync('infra/vps/' + name), 0o644);
  let active = true;
  const state = { now: 1000000, runtimeCalls: 0, databaseCalls: 0, shows: 0, empty: true, pid: '123', calls: [],
    runtime: { ok: true, environment: 'preview', continuous: { maintenanceEnabled: false, desiredTableCount: 0, supervisor: { sweepInProgress: false } },
      newHandsHold: { active: true, drain: true, humanMemberTables: 0, connectedHumanTables: 0, loadedHandsInProgress: 0,
        tableCommandsInFlight: 0, stateWritesInFlight: 0, supervisorSweepInProgress: false, dbHandsInProgress: 0, dbVersionMismatches: 0,
        dbFinancialIssues: { missingState: 0, missingEscrow: 0, invalidAmounts: 0, balanceMismatches: 0, unresolvedRequests: 0 }, restartSafe: true } },
    db: 'on\n0|0|0|0|0|0\n0|0\n0|1|1', mutate: () => {} };
  const host = { boundary: root, uid: process.getuid(), gid: process.getgid(), envFile, hold, preflight, bundle: root,
    receipt: path.join(root, 'receipt.json'), now: () => state.now,
    cgroupReady: () => {},
    cgroupEmpty: () => assert.equal(state.empty, true, 'cgroup_processes'),
    runtime: async token => { assert.equal(token, 'fixture-secret'); state.runtimeCalls++; return structuredClone(state.runtime); },
    run(argv, timeout, input, env) {
      state.calls.push(argv); state.mutate(argv);
      if (argv[0] === preflight) return 'PASS CONFIG ONLY fixture';
      if (argv[0] === '/usr/bin/psql') {
        state.databaseCalls++;
        assert.equal(input, DATABASE_SQL); assert.equal(env.PGPASSWORD, 'fixture-password');
        assert.equal(argv.join(' ').includes('fixture-password'), false); assert.equal(env.PGSSLMODE, 'require');
        return state.db;
      }
      assert.equal(argv[0], '/usr/bin/systemctl'); assert.equal(argv[2], UNIT);
      if (argv[1] === 'stop') { assert.equal(timeout, 100000); active = false; return ''; }
      assert.equal(argv[1], 'show'); state.shows++;
      return Object.entries({ LoadState: 'loaded', ActiveState: active ? 'active' : 'inactive', MainPID: active ? state.pid : '0',
        ExecMainStartTimestampMonotonic: '123456', User: 'arcade', WorkingDirectory: '/opt/arcade-ws-preview/ws-server',
        EnvironmentFiles: '/opt/arcade-ws-preview/.env.preview (ignore_errors=no)',
        Environment: 'WS_POKER_NEW_HANDS_HOLD_FILE=/etc/arcadeplatform/ws-hold-preview/new-hands',
        ControlGroup: '/system.slice/ws-server-preview.service', ExecStartEx: '{ path=/usr/bin/node ; argv[]=/usr/bin/node server.mjs ; flags= ; pid=0 }',
        ExecStop: '', ExecStopPost: '', KillMode: 'control-group', NeedDaemonReload: 'no', Result: 'success' })
        .map(([k, v]) => `${k}=${v}`).join('\n');
    } };
  return { root, state, host, stopCalls: () => state.calls.filter(a => a[1] === 'stop') };
}

test('only Preview stops once; receipt waits for audit, is fresh, bound and one-use', async t => {
  const f = fixture(t);
  assert.equal(await operate('stop', '42', f.host), 'stopped_pending_audit');
  assert.deepEqual(f.stopCalls(), [['/usr/bin/systemctl', 'stop', UNIT]]);
  assert.equal(f.state.runtimeCalls, 2); assert.equal(f.state.databaseCalls, 3);
  await assert.rejects(operate('verify-receipt', '1', f.host), /receipt_invalid/);
  await assert.rejects(operate('finalize', '43', f.host), /receipt_run/);
  assert.equal(await operate('finalize', '42', f.host), 'ready');
  assert.equal(await operate('verify-receipt', '1', f.host), 'verified');
  assert.equal(fs.statSync(f.host.receipt).mode & 0o7777, 0o600);
  assert.equal(fs.readFileSync(f.host.receipt, 'utf8').includes('fixture-secret'), false);
  assert.equal(fs.readFileSync(f.host.receipt, 'utf8').includes('fixture-password'), false);
  assert.equal(await operate('consume-receipt', '44', f.host), 'consumed');
  await assert.rejects(operate('consume-receipt', '45', f.host), /receipt_invalid/);
  assert.equal(fs.readFileSync(f.host.hold, 'utf8'), 'drain\n');
});

test('missing runtime proof, live humans, work, finance, bot controls and stale reads fail before stop', async t => {
  for (const change of [
    f => delete f.state.runtime.newHandsHold.humanMemberTables,
    f => delete f.state.runtime.newHandsHold.connectedHumanTables,
    f => { f.state.runtime.newHandsHold.humanMemberTables = 1; },
    f => { f.state.runtime.newHandsHold.connectedHumanTables = 1; },
    f => { f.state.runtime.newHandsHold.tableCommandsInFlight = 1; },
    f => { f.state.runtime.newHandsHold.stateWritesInFlight = 1; },
    f => { f.state.runtime.newHandsHold.loadedHandsInProgress = 1; },
    f => { f.state.runtime.newHandsHold.dbVersionMismatches = 1; },
    f => { f.state.runtime.newHandsHold.dbFinancialIssues.unresolvedRequests = 1; },
    f => { f.state.runtime.continuous.supervisor.sweepInProgress = true; },
    f => { f.state.runtime.continuous.maintenanceEnabled = true; },
    f => { f.state.runtime.environment = 'production'; },
    f => { f.state.db = 'on\n0|0|0|0|0|0\n1|0\n0|1|1'; },
    f => { f.state.db = 'on\n0|0|0|0|0|0\n0|0\n1|1|1'; },
    f => { f.state.db = 'on\n0|0|0|0|0|0\n0|0\n0|1|0'; },
    f => { f.state.db = 'off\n0|0|0|0|0|0\n0|0\n0|1|1'; },
    f => { fs.writeFileSync(f.host.hold, 'hold'); },
    f => { fs.chmodSync(f.host.hold, 0o666); },
    f => { f.host.cgroupReady = () => { throw new Error('cgroup_v2_required'); }; },
    f => { fs.writeFileSync(f.host.envFile, fs.readFileSync(f.host.envFile, 'utf8').replaceAll(STAGE, 'wrongproject')); },
    f => { f.host.runtime = async () => { f.state.now += 10001; return f.state.runtime; }; },
    f => { f.state.mutate = argv => { if (argv[1] === 'show' && f.state.shows > 1) f.state.pid = '456'; }; }
  ]) {
    const f = fixture(t); change(f);
    await assert.rejects(operate('stop', '42', f.host));
    assert.deepEqual(f.stopCalls(), []); assert.equal(fs.existsSync(f.host.receipt), false);
  }
});

test('timeout, surviving cgroup and post-stop DB uncertainty never create usable receipt or restart', async t => {
  for (const failure of ['timeout', 'cgroup', 'database']) {
    const f = fixture(t);
    f.state.mutate = argv => {
      if (argv[1] === 'stop' && failure === 'timeout') throw new Error('timeout');
      if (argv[1] === 'stop' && failure === 'cgroup') f.state.empty = false;
      if (argv[1] === 'stop' && failure === 'database') f.state.db = 'unknown';
    };
    await assert.rejects(operate('stop', '42', f.host), StopUncertain);
    assert.equal(f.stopCalls().length, 1); assert.equal(fs.existsSync(f.host.receipt), false);
    assert.equal(f.state.calls.some(a => ['start', 'restart'].includes(a[1])), false);
    assert.equal(fs.readFileSync(f.host.hold, 'utf8'), 'drain\n');
  }
});

test('receipt expires and rejects changed protected configuration or repopulated cgroup', async t => {
  for (const change of [f => { f.state.now += TTL; }, f => fs.appendFileSync(f.host.envFile, '# changed\n'),
    f => fs.writeFileSync(f.host.hold, 'hold'), f => { f.state.empty = false; }]) {
    const f = fixture(t);
    await operate('stop', '42', f.host); await operate('finalize', '42', f.host); change(f);
    await assert.rejects(operate('consume-receipt', '44', f.host));
    assert.equal(JSON.parse(fs.readFileSync(f.host.receipt)).phase, 'ready');
  }
});
