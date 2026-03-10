import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...options });
}

test("ws image contains required poker protocol/runtime modules", { timeout: 180000 }, (t) => {
  const dockerCheck = run("docker", ["version"]);
  if (dockerCheck.status !== 0) {
    t.skip("docker is required for ws image behavior tests");
    return;
  }

  const imageTag = `arcadeplatform-ws-test:${Date.now()}-protocol`;
  const sentinelPath = "ws-server/node_modules/.host-sentinel-artifact";
  fs.mkdirSync("ws-server/node_modules", { recursive: true });
  fs.writeFileSync(sentinelPath, "host-sentinel", "utf8");
  try {
    const build = run("docker", ["build", "-t", imageTag, "-f", "ws-server/Dockerfile", "."]);
    assert.equal(build.status, 0, `docker build failed:\n${build.stderr || build.stdout}`);

    const check = run("docker", [
      "run",
      "--rm",
      imageTag,
      "sh",
      "-lc",
      "test ! -e /app/ws-server/node_modules/.host-sentinel-artifact"
    ]);
    assert.equal(check.status, 0, `host sentinel node_modules artifact leaked into image:
${check.stderr || check.stdout}`);

    const runtimeCheck = run("docker", [
      "run",
      "--rm",
      imageTag,
      "sh",
      "-lc",
      "test -f /app/ws-server/poker/protocol/constants.mjs && test -f /app/ws-server/poker/protocol/envelope.mjs && test -f /app/ws-server/poker/handlers/hello.mjs && test -f /app/ws-server/poker/runtime/conn-state.mjs && test -f /app/ws-server/poker/table/table-snapshot.mjs && test -f /app/ws-server/poker/snapshot-runtime/poker-turn-timeout.mjs && test -f /app/ws-server/poker/snapshot-runtime/poker-state-utils.mjs && test -f /app/ws-server/poker/snapshot-runtime/poker-legal-actions.mjs && test ! -e /app/netlify/functions/_shared/poker-turn-timeout.mjs"
    ]);
    assert.equal(runtimeCheck.status, 0, `required ws modules are missing in image:
${runtimeCheck.stderr || runtimeCheck.stdout}`);
  } finally {
    try { fs.unlinkSync(sentinelPath); } catch {}
    run("docker", ["rmi", "-f", imageTag]);
  }
});
