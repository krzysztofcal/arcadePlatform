import assert from "node:assert/strict";
import test from "node:test";
import {
  createVpsMetricsCollector,
  parseDuBytes,
  parseMemAvailable,
  parseProcStatCpu,
} from "./vps-metrics.mjs";

function createDeps({ journalFailure = false } = {}) {
  let procStatReads = 0;
  const fsImpl = {
    promises: {
      statfs: async () => ({
        bsize: 4096n,
        blocks: 1_000_000n,
        bfree: 400_000n,
        bavail: 380_000n,
        files: 3_200_000n,
        ffree: 3_080_000n,
      }),
      stat: async (path) => {
        if (path === "/run/log/journal") return { isDirectory: () => true };
        return { isDirectory: () => true };
      },
      readFile: async (path) => {
        if (path === "/proc/meminfo") return "MemAvailable:       4194304 kB\nMemFree: 100 kB\n";
        if (path === "/proc/stat") {
          procStatReads += 1;
          return procStatReads === 1 ? "cpu 100 0 100 1000 0 0 0 0 0 0\n" : "cpu 120 0 110 1100 10 0 0 0 0 0\n";
        }
        throw new Error("unexpected_file");
      },
    },
  };
  const osImpl = {
    cpus: () => [{}, {}],
    loadavg: () => [1.2, 0.9, 0.7],
  };
  const processImpl = {
    cpuUsage: (previous) => previous ? { user: 18_000, system: 3_000 } : { user: 0, system: 0 },
    memoryUsage: () => ({ rss: 256 * 1024 * 1024 }),
    uptime: () => 6580,
  };
  const execFileImpl = (_command, args, _options, callback) => {
    const path = args[args.length - 1];
    if (journalFailure && path === "/var/log/journal") {
      const error = new Error("permission denied");
      error.code = "EACCES";
      callback(error, "", "permission denied");
      return { kill() {} };
    }
    callback(null, `123\t${path}\n`, "");
    return { kill() {} };
  };
  return {
    fsImpl,
    osImpl,
    processImpl,
    execFileImpl,
    sleepImpl: async () => {},
  };
}

test("VPS collector returns storage, runtime and host metrics without an aggregate status", async () => {
  assert.equal(parseMemAvailable("MemAvailable: 4194304 kB\n"), 4194304 * 1024);
  assert.equal(parseMemAvailable("MemAvailable: -1 kB\n"), null);
  assert.equal(parseMemAvailable("MemFree: 10 kB\n"), null);
  assert.equal(parseDuBytes("123\t/var/log\n", "/var/log"), 123);
  assert.equal(parseDuBytes("123\n456\n", "/var/log"), null);
  assert.deepEqual(
    parseProcStatCpu("cpu 100 2 3 4 5 6 7 8 90 10\n"),
    { total: 135, iowait: 5 }
  );

  const snapshot = await createVpsMetricsCollector(createDeps()).collect();
  assert.equal(snapshot.rootFilesystem.usedBytes, 600_000 * 4096);
  assert.equal(snapshot.runtime.hostLogicalCpuCount, 2);
  assert.equal(snapshot.runtime.wsUptimeSeconds, 6580);
  assert.equal(snapshot.runtime.hostAvailableRamBytes, 4194304 * 1024);
  assert.equal(snapshot.logs.varLogBytes, 123);
  assert.equal(snapshot.logs.journaldBytes, 246);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "status"), false);
});

test("VPS collector keeps independent metrics when journald du fails", async () => {
  const snapshot = await createVpsMetricsCollector(createDeps({ journalFailure: true })).collect();
  assert.equal(snapshot.logs.varLogBytes, 123);
  assert.equal(snapshot.logs.journaldBytes, null);
  assert.equal(snapshot.rootFilesystem.usedPercent, 60);
  assert.equal(snapshot.runtime.hostLogicalCpuCount, 2);
});
