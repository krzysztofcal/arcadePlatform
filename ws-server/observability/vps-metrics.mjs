import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";

const SAMPLE_MS = 750;
const DU_TIMEOUT_MS = 1_500;
const DU_ARGS_PREFIX = ["--summarize", "--block-size=1", "--one-file-system", "--"];
const JOURNAL_PATHS = ["/var/log/journal", "/run/log/journal"];
const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

function asSafeInteger(value) {
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function percent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return Number(((value / total) * 100).toFixed(1));
}

export function parseMemAvailable(text) {
  const match = String(text || "").match(/^MemAvailable:\s+([0-9]+)\s+kB$/m);
  if (!match) return null;
  const kilobytes = Number(match[1]);
  if (!Number.isSafeInteger(kilobytes) || kilobytes < 0) return null;
  const bytes = kilobytes * 1024;
  return Number.isSafeInteger(bytes) && bytes <= SAFE_INTEGER_MAX ? bytes : null;
}

export function parseDuBytes(stdout, expectedPath) {
  const lines = String(stdout || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) return null;
  const match = lines[0].match(/^([0-9]+)\s+(.+)$/);
  if (!match || match[2] !== expectedPath) return null;
  const bytes = Number(match[1]);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

export function parseProcStatCpu(text) {
  const line = String(text || "").split(/\r?\n/).find((item) => item.startsWith("cpu "));
  if (!line) return null;
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  if (fields.length < 5 || fields.some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
  const total = fields.slice(0, 8).reduce((sum, value) => sum + value, 0);
  return {
    total,
    iowait: fields[4],
  };
}

function roundPercent(value) {
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
}

function readRootFilesystem(fsImpl) {
  return fsImpl.promises.statfs("/", { bigint: true }).then((stats) => {
    const blockSize = asSafeInteger(stats.bsize || stats.frsize);
    const blocks = asSafeInteger(stats.blocks);
    const freeBlocks = asSafeInteger(stats.bfree);
    const availableBlocks = asSafeInteger(stats.bavail);
    const inodeTotal = asSafeInteger(stats.files);
    const inodeFree = asSafeInteger(stats.ffree);
    if ([blockSize, blocks, freeBlocks, availableBlocks, inodeTotal, inodeFree].some((value) => value == null)) {
      return null;
    }
    const totalBytes = blocks * blockSize;
    const usedBytes = (blocks - freeBlocks) * blockSize;
    const availableBytes = availableBlocks * blockSize;
    const inodeUsed = inodeTotal - inodeFree;
    if (
      ![totalBytes, usedBytes, availableBytes, inodeUsed].every((value) => Number.isSafeInteger(value) && value >= 0)
      || usedBytes > totalBytes
      || inodeUsed > inodeTotal
    ) return null;
    return {
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: percent(usedBytes, totalBytes),
      inodes: {
        total: inodeTotal,
        used: inodeUsed,
        available: inodeFree,
        usedPercent: percent(inodeUsed, inodeTotal),
      },
    };
  }).catch(() => null);
}

function runDu(path, execFileImpl) {
  return new Promise((resolve) => {
    execFileImpl(
      "du",
      [...DU_ARGS_PREFIX, path],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024,
        timeout: DU_TIMEOUT_MS,
        killSignal: "SIGTERM",
        shell: false,
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(parseDuBytes(stdout, path));
      }
    );
  });
}

async function readJournalBytes(fsImpl, execFileImpl) {
  const existing = await Promise.all(JOURNAL_PATHS.map(async (path) => {
    try {
      const stat = await fsImpl.promises.stat(path);
      return stat?.isDirectory?.() === true ? path : null;
    } catch (error) {
      return error?.code === "ENOENT" ? null : false;
    }
  }));
  if (existing.includes(false)) return null;
  const paths = existing.filter(Boolean);
  if (!paths.length) return 0;
  const values = await Promise.all(paths.map((path) => runDu(path, execFileImpl)));
  if (values.some((value) => value == null)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function readLogs(fsImpl, execFileImpl) {
  return Promise.all([
    runDu("/var/log", execFileImpl),
    readJournalBytes(fsImpl, execFileImpl),
  ]).then(([varLogBytes, journaldBytes]) => ({ varLogBytes, journaldBytes }));
}

async function readRuntime(fsImpl, osImpl, processImpl, sleepImpl) {
  const startCpu = processImpl.cpuUsage();
  const startWall = Date.now();
  const startStatPromise = fsImpl.promises.readFile("/proc/stat", "utf8")
    .then(parseProcStatCpu)
    .catch(() => null);
  await sleepImpl(SAMPLE_MS);
  const endWall = Date.now();
  const endCpu = processImpl.cpuUsage(startCpu);
  const [startStat, endStat] = await Promise.all([
    startStatPromise,
    fsImpl.promises.readFile("/proc/stat", "utf8").then(parseProcStatCpu).catch(() => null),
  ]);
  const elapsedMs = Math.max(1, endWall - startWall);
  const cpuMicros = Number(endCpu?.user || 0) + Number(endCpu?.system || 0);
  const wsCpuPercent = Number.isFinite(cpuMicros)
    ? roundPercent((cpuMicros / (elapsedMs * 1_000)) * 100)
    : null;
  const totalTicks = startStat && endStat ? endStat.total - startStat.total : null;
  const ioWaitTicks = startStat && endStat ? endStat.iowait - startStat.iowait : null;
  const ioWaitPercent = Number.isFinite(totalTicks) && Number.isFinite(ioWaitTicks) && totalTicks > 0 && ioWaitTicks >= 0
    ? roundPercent((ioWaitTicks / totalTicks) * 100)
    : null;
  let memory = {};
  try {
    memory = processImpl.memoryUsage() || {};
  } catch {}
  let load = [];
  try {
    load = osImpl.loadavg() || [];
  } catch {}
  let logicalCpuCount = null;
  try {
    logicalCpuCount = osImpl.cpus()?.length;
  } catch {}
  let uptime = null;
  try {
    uptime = processImpl.uptime();
  } catch {}
  return {
    wsCpuPercent,
    wsRssBytes: asSafeInteger(memory?.rss),
    wsUptimeSeconds: Number.isFinite(uptime) ? Math.max(0, uptime) : null,
    hostLogicalCpuCount: Number.isInteger(logicalCpuCount) && logicalCpuCount > 0 ? logicalCpuCount : null,
    loadAverage: {
      one: Number.isFinite(load?.[0]) ? load[0] : null,
      five: Number.isFinite(load?.[1]) ? load[1] : null,
      fifteen: Number.isFinite(load?.[2]) ? load[2] : null,
    },
    ioWaitPercent,
    hostAvailableRamBytes: await fsImpl.promises.readFile("/proc/meminfo", "utf8")
      .then(parseMemAvailable)
      .catch(() => null),
  };
}

export function createVpsMetricsCollector({
  fsImpl = fs,
  osImpl = os,
  processImpl = process,
  execFileImpl = execFile,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return {
    async collect() {
      const [rootFilesystem, logs, runtime] = await Promise.all([
        readRootFilesystem(fsImpl),
        readLogs(fsImpl, execFileImpl),
        readRuntime(fsImpl, osImpl, processImpl, sleepImpl),
      ]);
      return { rootFilesystem, logs, runtime };
    },
  };
}

export { DU_TIMEOUT_MS, SAMPLE_MS };
