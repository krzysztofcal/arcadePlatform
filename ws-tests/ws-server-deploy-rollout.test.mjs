import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function rollout({ baseDir, releaseSha, archivePath }) {
  const releasesDir = path.join(baseDir, "releases");
  const currentLink = path.join(baseDir, "current");
  const newReleaseDir = path.join(releasesDir, releaseSha);

  fs.rmSync(newReleaseDir, { recursive: true, force: true });
  fs.mkdirSync(newReleaseDir, { recursive: true });

  execFileSync("tar", ["-xzf", archivePath, "-C", newReleaseDir]);

  const tmpLink = `${currentLink}.tmp`;
  fs.rmSync(tmpLink, { force: true });
  fs.symlinkSync(newReleaseDir, tmpLink);
  fs.renameSync(tmpLink, currentLink);
}

function createArchive({ archivePath, fileName, fileContent }) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "ws-rollout-stage-"));
  fs.writeFileSync(path.join(staging, fileName), fileContent);
  execFileSync("tar", ["-czf", archivePath, "-C", staging, "."]);
}

test("rollout script is atomic: current symlink switches only after extract success", async () => {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ws-rollout-"));
  const releasesDir = path.join(baseDir, "releases");
  const oldRelease = path.join(releasesDir, "old");
  const currentLink = path.join(baseDir, "current");

  await fs.promises.mkdir(oldRelease, { recursive: true });
  await fs.promises.mkdir(releasesDir, { recursive: true });
  await fs.promises.symlink(oldRelease, currentLink);

  const badArchive = path.join(baseDir, "missing.tgz");
  assert.throws(() => rollout({ baseDir, releaseSha: "new-fail", archivePath: badArchive }));

  const afterFail = await fs.promises.realpath(currentLink);
  assert.equal(afterFail, oldRelease);

  const goodArchive = path.join(baseDir, "good.tgz");
  createArchive({ archivePath: goodArchive, fileName: "server.mjs", fileContent: "export {}\n" });

  rollout({ baseDir, releaseSha: "new-success", archivePath: goodArchive });
  const afterSuccess = await fs.promises.realpath(currentLink);
  assert.equal(afterSuccess, path.join(releasesDir, "new-success"));
});
