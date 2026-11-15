#!/usr/bin/env node
// Read-only storage preflight; Git and the installed agent launchers remain the mechanisms.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONFIG = "/etc/arcadeplatform/agent-storage.json";
const MOUNT = "/mnt/HC_Volume_107462648";
const ROOT = `${MOUNT}/copilot-work`;
const BY_ID = "/dev/disk/by-id/scsi-0HC_Volume_107462648";
const stop = (reason) => { throw new Error(`STOP agent_workdir ${reason}`); };

// Only an OWNER-provisioned, non-secret UUID selects the alternate fixed mount.
// Missing configuration retains the exact Hetzner contract; invalid configuration never falls back.
function storageTarget(disk) {
  let config;
  try { config = disk.lstatSync(CONFIG); }
  catch (error) {
    if (error.code === "ENOENT") return { mount: MOUNT, root: ROOT, byId: BY_ID, device: "/dev/sdb" };
    stop("storage_config_unavailable");
  }
  for (const parent of ["/", "/etc", "/etc/arcadeplatform"]) {
    const meta = disk.lstatSync(parent);
    if (!meta.isDirectory() || meta.uid !== 0 || (meta.mode & 0o022) !== 0
      || disk.realpathSync(parent) !== parent) stop("storage_config_untrusted_parent");
  }
  if (!config.isFile() || config.uid !== 0 || config.gid !== 0 || config.nlink !== 1
    || (config.mode & 0o7777) !== 0o644 || disk.realpathSync(CONFIG) !== CONFIG) stop("storage_config_custody");
  const value = JSON.parse(disk.readFileSync(CONFIG, "utf8"));
  if (!value || Object.keys(value).length !== 1 || typeof value.uuid !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.uuid)) stop("storage_config_invalid");
  const byId = `/dev/disk/by-uuid/${value.uuid}`;
  const device = disk.realpathSync(byId);
  if (!/^\/dev\/[a-zA-Z0-9_-]+$/.test(device)) stop("unexpected_device_or_symlink");
  return { mount: "/mnt/agent-work", root: "/mnt/agent-work/copilot-work", byId, device };
}

// The optional I/O boundary permits deterministic mount-failure tests without root or mounting fixtures.
// CLI/environment cannot override paths, devices, thresholds or roots.
function inspectStorage(io = {}) {
  const disk = io.fs || fs;
  const run = io.run || ((argv) => spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: 10000 }));
  const uid = io.uid ?? process.getuid();
  const gid = io.gid ?? process.getgid();
  let target;
  try {
    target = storageTarget(disk);
    const { mount: mountPath, root: workRoot, byId, device: devicePath } = target;
    const result = run(["/usr/bin/findmnt", "--noheadings", "--raw", "--mountpoint", mountPath,
      "--output", "TARGET,SOURCE,FSTYPE,OPTIONS"]);
    const fields = String(result.stdout || "").trim().split(/\s+/);
    if (result.status !== 0 || fields.length !== 4 || fields[0] !== mountPath || fields[1] !== devicePath
      || fields[2] !== "ext4" || !fields[3].split(",").includes("rw") || fields[3].split(",").includes("ro")) stop("volume_not_verified_rw_mount");
    if (disk.realpathSync(byId) !== devicePath || disk.realpathSync(workRoot) !== workRoot
      || disk.realpathSync(mountPath) !== mountPath) stop("unexpected_device_or_symlink");
    const device = disk.statSync(devicePath);
    const mount = disk.statSync(mountPath);
    const root = disk.lstatSync(workRoot);
    if (!device.isBlockDevice() || !mount.isDirectory() || !root.isDirectory()
      || mount.dev !== device.rdev || root.dev !== mount.dev || mount.dev === disk.statSync("/").dev
      || mount.uid !== 0 || (mount.mode & 0o022) !== 0) stop("unexpected_filesystem");
    if (uid === 0 || root.uid !== uid || root.gid !== gid || (root.mode & 0o7777) !== 0o750) stop("workdir_owner_or_mode");
    disk.accessSync(workRoot, fs.constants.W_OK | fs.constants.X_OK);
  } catch (error) {
    if (error.message?.startsWith("STOP agent_workdir ")) throw error;
    stop("mount_or_path_unavailable_no_fallback");
  }
  // Capacity is advisory; only the new-write location checks above fail closed.
  const warn = io.warn || ((message) => process.stderr.write(`${message}\n`));
  const capacity = (path, label) => {
    try {
      const { blocks, bfree, bavail, bsize } = disk.statfsSync(path);
      if (![blocks, bfree, bavail, bsize].every(Number.isSafeInteger)
        || blocks <= 0 || bsize <= 0 || bavail < 0 || bfree < bavail || bfree > blocks) throw new Error("invalid_capacity");
      const used = blocks - bfree;
      if (used + bavail <= 0 || !Number.isSafeInteger(bavail * bsize)) throw new Error("invalid_capacity");
      return { usedPercent: Math.ceil(100 * used / (used + bavail)), availableBytes: bavail * bsize };
    } catch {
      warn(`WARN agent_workdir ${label}_capacity_unverifiable`);
      return null;
    }
  };
  const rootCapacity = capacity("/", "root");
  const volumeCapacity = capacity(target.root, "volume");
  const minimum = 4 * 1024 ** 3;
  if (rootCapacity) {
    const critical = rootCapacity.usedPercent >= 90 || rootCapacity.availableBytes < minimum;
    if (critical || rootCapacity.usedPercent >= 85) warn(`${critical ? "CRITICAL" : "WARN"} agent_workdir root_capacity used_percent=${rootCapacity.usedPercent} available_bytes=${rootCapacity.availableBytes}`);
  }
  if (volumeCapacity && volumeCapacity.availableBytes < minimum) warn(`CRITICAL agent_workdir volume_capacity_low available_bytes=${volumeCapacity.availableBytes}`);
  return { directory: target.root, capacity: { root: rootCapacity, volume: volumeCapacity } };
}

export function checkAgentStorage(io = {}) {
  return inspectStorage(io).capacity;
}

export function newAgentWorkdir(slug, io = {}) {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(slug)) stop("invalid_directory_name");
  const { directory } = inspectStorage(io);
  const destination = `${directory}/${slug}`;
  try {
    (io.fs || fs).lstatSync(destination);
  } catch (error) {
    if (error.code === "ENOENT") return destination;
    stop("destination_unverifiable");
  }
  stop("destination_exists_reuse_task_checkout");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) stop("usage_directory_name_or_--check");
    process.stdout.write(process.argv[2] === "--check"
      ? `${JSON.stringify(checkAgentStorage())}\n` : `${newAgentWorkdir(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
