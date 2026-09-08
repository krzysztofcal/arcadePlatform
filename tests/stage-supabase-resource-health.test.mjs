import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  parseMetrics, measureWindow, parseDiskUtilization, classify, readCapacity, monitor,
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

test('missing, reset, stale, changed series or out-of-bounds window remains unknown', () => {
  const { first, second } = windowFor();
  for (const seconds of [0, 54, 76, NaN]) assert.equal(measureWindow(first, second, seconds).cpuPercent, null);
  assert.equal(measureWindow(first, first, 60).cpuPercent, null);
  second.values().next().value.value = -1;
  assert.equal(measureWindow(first, second, 60).cpuPercent, null);
  first.delete(first.keys().next().value);
  assert.equal(measureWindow(first, second, 60).cpuPercent, null);
  assert.equal(classify(measureWindow(new Map(), new Map(), 60), capacity, diskUtilization).state, 'unknown');
  assert.throws(() => parseMetrics(fixture.replace(/ 0\n/, ' NaN\n')));
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
