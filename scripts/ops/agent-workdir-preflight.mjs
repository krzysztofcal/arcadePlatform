#!/usr/bin/env node
// Read-only path preflight for new VPS agent checkouts; Git remains the workspace mechanism.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MOUNT = "/mnt/HC_Volume_107462648";
const ROOT = `${MOUNT}/copilot-work`;
const BY_ID = "/dev/disk/by-id/scsi-0HC_Volume_107462648";
const stop = (reason) => { throw new Error(`STOP agent_workdir ${reason}`); };

// The optional I/O boundary permits deterministic mount-failure tests without root or mounting fixtures.
// CLI callers can supply only a single directory name, never paths, devices or alternate roots.
export function newAgentWorkdir(slug, io = {}) {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(slug)) stop("invalid_directory_name");
  const disk = io.fs || fs;
  const run = io.run || ((argv) => spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: 10000 }));
  const uid = io.uid ?? process.getuid();
  const gid = io.gid ?? process.getgid();
  try {
    const result = run(["/usr/bin/findmnt", "--noheadings", "--raw", "--mountpoint", MOUNT,
      "--output", "TARGET,SOURCE,FSTYPE,OPTIONS"]);
    const fields = String(result.stdout || "").trim().split(/\s+/);
    if (result.status !== 0 || fields.length !== 4 || fields[0] !== MOUNT || fields[1] !== "/dev/sdb"
      || fields[2] !== "ext4" || !fields[3].split(",").includes("rw") || fields[3].split(",").includes("ro")) stop("volume_not_verified_rw_mount");
    if (disk.realpathSync(BY_ID) !== "/dev/sdb" || disk.realpathSync(ROOT) !== ROOT) stop("unexpected_device_or_symlink");
    const device = disk.statSync("/dev/sdb");
    const mount = disk.statSync(MOUNT);
    const root = disk.lstatSync(ROOT);
    if (!device.isBlockDevice() || !mount.isDirectory() || !root.isDirectory()
      || mount.dev !== device.rdev || root.dev !== mount.dev) stop("unexpected_filesystem");
    if (uid === 0 || root.uid !== uid || root.gid !== gid || (root.mode & 0o7777) !== 0o750) stop("workdir_owner_or_mode");
    disk.accessSync(ROOT, fs.constants.W_OK | fs.constants.X_OK);
    const destination = `${ROOT}/${slug}`;
    let existing;
    try { existing = disk.lstatSync(destination); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing) stop("destination_exists_reuse_task_checkout");
    return destination;
  } catch (error) {
    if (error.message?.startsWith("STOP agent_workdir ")) throw error;
    stop("mount_or_path_unavailable_no_fallback");
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) stop("usage_one_directory_name");
    process.stdout.write(`${newAgentWorkdir(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
