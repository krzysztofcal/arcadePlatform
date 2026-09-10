import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  parseMetrics, measureWindow, parseDiskUtilization, classify, readCapacity, monitor,
  evaluateCleanupDecision, exitCodeFor,
} from '../scripts/ops/stage-supabase-resource-health.mjs';

const fixture = fs.readFileSync(new URL('./fixtures/stage-resource-metrics.prom', import.meta.url), 'utf8');
function windowFor(user = 12, iowait = 6) {
  const first = parseMetrics(fixture);
  const second = parseMetrics(fixture);
  for (const sample of second.values()) {
    sample.value = sample.labels.mode === 'user' ? user : sample.labels.mode === 'iowait' ? iowait
      : sample.labels.mode === 'idle' ? 60 - user - iowait : sample.labels.device ? 600 : 0;
  }
  return { first, second, window: measureWindow(first, second, 60) };
}
function addMetric(samples, name, labels, value) {
  samples.set(JSON.stringify([name, Object.entries(labels).sort()]), { name, labels, value });
}
function addCpuGroup(samples, cpu) {
  for (const mode of ['idle', 'iowait', 'irq', 'nice', 'softirq', 'steal', 'system', 'user']) {
    addMetric(samples, 'node_cpu_seconds_total', {
      supabase_project_ref: 'krydukthwdvccggbyjfw', service_type: 'db', cpu, mode,
    }, mode === 'idle' ? 42 : mode === 'user' ? 12 : mode === 'iowait' ? 6 : 0);
  }
}
function addDiskGroup(samples, device, value = 0) {
  for (const name of [
    'node_disk_read_bytes_total', 'node_disk_written_bytes_total',
    'node_disk_reads_completed_total', 'node_disk_writes_completed_total',
  ]) addMetric(samples, name, {
    supabase_project_ref: 'krydukthwdvccggbyjfw', service_type: 'db', device,
  }, value);
}
function deleteMetric(samples, predicate) {
  const entry = [...samples].find(([, sample]) => predicate(sample));
  if (entry) samples.delete(entry[0]);
}
const GiB = 1024 ** 3;
const capacity = { available: true, dbTotalBytes: GiB, ledgerTotalBytes: 100, capacityStatus: 'OK' };
const diskConfiguration = { size_gb: 10, iops: 3000, throughput_mibps: 125, type: 'gp3' };
const diskUtilization = { fsSizeBytes: 10 * GiB, fsAvailBytes: 9 * GiB, fsUsedBytes: GiB };

test('real Supabase fixture: CPU/iowait and per-device throughput/IOPS use counter deltas', () => {
  const { window } = windowFor();
  assert.equal(window.cpuPercent, 20);
  assert.equal(window.iowaitPercent, 10);
  assert.equal(window.disks[0].readBytesPerSecond, 10);
  assert.equal(window.disks[0].writeIops, 10);
  const result = classify(window, capacity, diskUtilization);
  assert.equal(result.state, 'warning');
  assert.equal(result.capacityPercent, 10);
  assert.equal(result.databaseBytes, GiB);
});

test('critical uses average CPU/iowait over the window; capacity cannot change pressure', () => {
  assert.equal(classify(windowFor(54, 0).window, capacity, diskUtilization).pressureState, 'critical');
  assert.equal(classify(windowFor(0, 15).window, capacity, diskUtilization).pressureState, 'critical');
  const healthy = windowFor(6, 0).window;
  const result = classify(healthy, capacity, {
    ...diskUtilization, fsAvailBytes: GiB, fsUsedBytes: 9 * GiB,
  });
  assert.equal(result.state, 'warning');
  assert.equal(result.capacityState, 'critical');
  assert.equal(result.pressureState, 'healthy');
  assert.equal(result.capacityPercent, 90);
  assert.equal(result.databaseBytes, GiB);
  assert.equal(result.cleanupDecision, 'not_evaluated_monitor_only');
  assert.equal(classify(healthy, capacity, null).state, 'unknown');
  assert.deepEqual(parseDiskUtilization({
    timestamp: '2026-09-08T00:00:00Z',
    metrics: { fs_size_bytes: 10 * GiB, fs_avail_bytes: 9 * GiB, fs_used_bytes: GiB },
  }), diskUtilization);
  assert.equal(parseDiskUtilization({ metrics: { fs_size_bytes: 0, fs_avail_bytes: 0, fs_used_bytes: 0 } }), null);
});

test('invalid windows remain unknown with an exact measurement reason', () => {
  const { first, second } = windowFor();
  for (const seconds of [0, 54, 76, NaN]) {
    const result = measureWindow(first, second, seconds);
    assert.equal(result.cpuPercent, null);
    assert.equal(result.measurementReason, 'window_out_of_range');
  }
  const stale = measureWindow(first, first, 60);
  assert.equal(stale.cpuPercent, null);
  assert.equal(stale.measurementReason, 'cpu_ticks_invalid');

  const resetFirst = parseMetrics(fixture);
  const resetSecond = parseMetrics(fixture);
  const resetFirstCpu = [...resetFirst.values()].find((sample) => sample.name === 'node_cpu_seconds_total' && sample.labels.mode === 'user');
  const resetSecondCpu = [...resetSecond.values()].find((sample) => sample.name === 'node_cpu_seconds_total' && sample.labels.mode === 'user');
  resetFirstCpu.value = 100;
  resetSecondCpu.value = 90;
  const reset = measureWindow(resetFirst, resetSecond, 60);
  assert.equal(reset.cpuPercent, null);
  assert.equal(reset.measurementReason, 'counter_reset');

  first.delete(first.keys().next().value);
  const incompleteDisk = measureWindow(first, second, 60);
  assert.equal(incompleteDisk.cpuPercent, 20);
  assert.equal(incompleteDisk.disks.length, 0);
  assert.equal(incompleteDisk.measurementReason, 'disk_series_incomplete');

  const missingCpu = measureWindow(new Map(), new Map(), 60);
  assert.equal(missingCpu.measurementReason, 'cpu_series_missing');
  assert.equal(classify(missingCpu, capacity, diskUtilization).state, 'unknown');
  assert.throws(() => parseMetrics(fixture.replace(/ 0\n/, ' NaN\n')));
});

test('required CPU series changes are diagnosed, while unrelated disk churn is ignored', () => {
  const changed = windowFor();
  addCpuGroup(changed.second, '1');
  const changedWindow = measureWindow(changed.first, changed.second, 60);
  assert.equal(changedWindow.cpuPercent, null);
  assert.equal(changedWindow.measurementReason, 'series_set_changed');

  const churn = windowFor();
  addMetric(churn.second, 'node_disk_read_bytes_total', {
    supabase_project_ref: 'krydukthwdvccggbyjfw', service_type: 'db', device: 'transient-device',
  }, 1);
  const churnWindow = measureWindow(churn.first, churn.second, 60);
  assert.equal(churnWindow.cpuPercent, 20);
  assert.equal(churnWindow.iowaitPercent, 10);
  assert.equal(churnWindow.disks.length, 1);
  assert.equal(churnWindow.measurementReason, null);
});

test('incomplete CPU modes and ticks remain unknown without affecting valid disk deltas', () => {
  const modes = windowFor();
  deleteMetric(modes.second, (sample) => sample.name === 'node_cpu_seconds_total' && sample.labels.mode === 'user');
  const incompleteModes = measureWindow(modes.first, modes.second, 60);
  assert.equal(incompleteModes.cpuPercent, null);
  assert.equal(incompleteModes.disks.length, 1);
  assert.equal(incompleteModes.measurementReason, 'cpu_modes_incomplete');

  const ticks = windowFor();
  deleteMetric(ticks.second, (sample) => sample.name === 'node_cpu_seconds_total' && sample.labels.mode === 'idle');
  addMetric(ticks.second, 'node_cpu_seconds_total', {
    supabase_project_ref: 'krydukthwdvccggbyjfw', service_type: 'db', cpu: '0', mode: 'idle',
  }, 100);
  const invalidTicks = measureWindow(ticks.first, ticks.second, 60);
  assert.equal(invalidTicks.cpuPercent, null);
  assert.equal(invalidTicks.disks.length, 1);
  assert.equal(invalidTicks.measurementReason, 'cpu_ticks_invalid');
});

test('incomplete required disk measurement is not converted to zero', () => {
  const { first, second } = windowFor();
  deleteMetric(second, (sample) => sample.name === 'node_disk_reads_completed_total');
  const window = measureWindow(first, second, 60);
  assert.equal(window.cpuPercent, 20);
  assert.equal(window.iowaitPercent, 10);
  assert.deepEqual(window.disks, []);
  assert.equal(window.measurementReason, 'disk_series_incomplete');
  assert.equal(classify(window, capacity, diskUtilization).state, 'unknown');
});

test('existing or newly complete disk devices fail closed without erasing CPU', () => {
  const missing = windowFor();
  addDiskGroup(missing.first, 'device_2');
  addDiskGroup(missing.second, 'device_2', 600);
  deleteMetric(missing.second, (sample) => sample.labels.device === 'device_2'
    && sample.name === 'node_disk_read_bytes_total');
  const incomplete = measureWindow(missing.first, missing.second, 60);
  assert.equal(incomplete.cpuPercent, 20);
  assert.equal(incomplete.iowaitPercent, 10);
  assert.deepEqual(incomplete.disks, []);
  assert.equal(incomplete.measurementReason, 'disk_series_incomplete');
  assert.equal(classify(incomplete, capacity, diskUtilization).pressureState, 'unknown');
  assert.equal(classify(incomplete, capacity, diskUtilization).state, 'unknown');

  const added = windowFor();
  addDiskGroup(added.second, 'device_2', 600);
  const changed = measureWindow(added.first, added.second, 60);
  assert.equal(changed.cpuPercent, 20);
  assert.deepEqual(changed.disks, []);
  assert.equal(changed.measurementReason, 'series_set_changed');
  assert.equal(classify(changed, capacity, diskUtilization).state, 'unknown');
});

test('capacity and largest relations share read-only Stage transaction; top 10 only on alert', async () => {
  for (const high of [false, true]) {
    const queries = [];
    const createSql = (_url, options) => {
      assert.equal(options.connection.default_transaction_read_only, 'on');
      return {
        begin: async (mode, fn) => {
          assert.equal(mode, 'read only');
          return fn({ unsafe: async (query) => {
            queries.push(query);
            assert.match(query.trim(), /^select/i);
            if (query.includes('set_config')) return [];
            if (query.includes('pg_control_system')) return [{ system_identifier: '7656985631720456337' }];
            if (query.includes('db_total_bytes')) return [{ db_total_bytes: (high ? 1 : 9) * GiB, tx_total_bytes: 1, entry_total_bytes: 1 }];
            assert.match(query, /limit 10/i);
            return [];
          } });
        }, end: async () => {},
      };
    };
    const utilization = high ? {
      ...diskUtilization, fsAvailBytes: GiB, fsUsedBytes: 9 * GiB,
    } : diskUtilization;
    await readCapacity({ SUPABASE_STAGE_DB_URL: 'postgres://postgres@db.krydukthwdvccggbyjfw.supabase.co/postgres', ADMIN_LEDGER_DB_WARNING_MB: 0 }, utilization, createSql);
    const capacityQuery = queries.find((q) => q.includes('db_total_bytes'));
    assert.ok(capacityQuery);
    assert.doesNotMatch(capacityQuery, /count\s*\(\s*\*\s*\)/i);
    assert.equal(queries.filter((q) => q.includes('limit 10')).length, high ? 1 : 0);
  }
});

test('monitor samples twice 60s apart via GET only; unavailable API stays unknown', async () => {
  let elapsed = 0;
  const calls = [];
  const diskUtilizationResponse = {
    timestamp: '2026-09-08T00:00:00Z',
    metrics: { fs_size_bytes: 10 * GiB, fs_avail_bytes: 9 * GiB, fs_used_bytes: GiB },
  };
  const report = await monitor({ SUPABASE_STAGE_MANAGEMENT_TOKEN: 'test-secret' }, async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(url.startsWith('https://api.supabase.com/v1/projects/krydukthwdvccggbyjfw/'));
    calls.push(url);
    return {
      ok: true,
      text: async () => fixture,
      json: async () => url.endsWith('/config/disk/util')
        ? diskUtilizationResponse : { attributes: diskConfiguration },
    };
  }, async (ms) => { assert.equal(ms, 60000); elapsed += ms; }, () => elapsed,
  async (_env, observedDiskUtilization) => {
    assert.deepEqual(observedDiskUtilization, diskUtilization);
    return { capacity, relations: [] };
  });
  assert.equal(calls.filter((url) => url.endsWith('/metrics')).length, 2);
  assert.equal(calls.filter((url) => url.endsWith('/config/disk')).length, 1);
  assert.equal(calls.filter((url) => url.endsWith('/config/disk/util')).length, 1);
  assert.deepEqual(report.diskUtilization, diskUtilization);
  assert.equal(report.pressureState, 'unknown'); // unchanged counters are stale, not idle
  assert.equal(report.measurementReason, 'cpu_ticks_invalid');
  assert.equal(report.cleanupDecision, 'not_evaluated_monitor_only');
  assert.ok(!JSON.stringify(report).includes('test-secret'));
  const failed = await monitor({}, async () => { throw new Error('no HTTP expected'); },
    async () => {}, () => 0, async () => { throw new Error('private db details'); });
  assert.equal(failed.state, 'unknown');
  assert.ok(!JSON.stringify(failed).includes('private db details'));
});

test('monitor classifies safe Metrics API failures without exposing secrets', async () => {
  const secret = 'metrics-secret-do-not-log';
  const diskUtilizationResponse = {
    metrics: { fs_size_bytes: 10 * GiB, fs_avail_bytes: 9 * GiB, fs_used_bytes: GiB },
  };
  const scenarios = [
    ['metrics_http_403', async () => ({ ok: false, status: 403, text: async () => secret })],
    ['metrics_timeout', async () => { throw Object.assign(new Error(secret), { name: 'TimeoutError' }); }],
    ['metrics_parse_failed', async () => ({ ok: true, text: async () => `node_cpu_seconds_total{broken ${secret}` })],
  ];
  for (const [expected, metricsResponse] of scenarios) {
    const report = await monitor({ SUPABASE_STAGE_MANAGEMENT_TOKEN: secret }, async (url) => {
      if (url.endsWith('/metrics')) return metricsResponse();
      return {
        ok: true,
        json: async () => url.endsWith('/config/disk/util')
          ? diskUtilizationResponse : { attributes: diskConfiguration },
      };
    }, async () => {}, () => 0, async () => ({ capacity, relations: [] }));
    assert.equal(report.state, 'unknown');
    assert.deepEqual(report.errors, [expected]);
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});

test('cleanup enforcement blocks critical/unknown and preserves safe capacity-only retention', () => {
  for (const [window, utilization, expected] of [
    [windowFor(54, 0).window, diskUtilization, 'blocked_resource_critical'],
    [windowFor(0, 15).window, diskUtilization, 'blocked_resource_critical'],
    [measureWindow(new Map(), new Map(), 60), diskUtilization, 'blocked_resource_unknown'],
    [windowFor(6, 0).window, diskUtilization, 'allowed_healthy'],
    [windowFor().window, diskUtilization, 'allowed_warning'],
    [windowFor(6, 0).window, { ...diskUtilization, fsUsedBytes: 9 * GiB, fsAvailBytes: GiB }, 'allowed_warning'],
  ]) {
    const report = classify(window, capacity, utilization);
    assert.equal(evaluateCleanupDecision(report.state), expected);
    assert.equal(report.cleanupDecision, 'not_evaluated_monitor_only');
  }
  assert.equal(evaluateCleanupDecision(undefined), 'blocked_resource_unknown');
});

test('monitor-only tolerates unknown while enforce fails closed', () => {
  for (const [state, monitorOnlyExitCode, enforceExitCode] of [
    ['healthy', 0, 0],
    ['warning', 0, 0],
    ['unknown', 0, 1],
    ['critical', 1, 1],
  ]) {
    assert.equal(exitCodeFor(state, false), monitorOnlyExitCode);
    assert.equal(exitCodeFor(state, true), enforceExitCode);
  }
});
