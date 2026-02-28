import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

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
  try {
    const build = run("docker", ["build", "-t", imageTag, "-f", "ws-server/Dockerfile", "ws-server"]);
    assert.equal(build.status, 0, `docker build failed:\n${build.stderr || build.stdout}`);

    const check = run("docker", [
      "run",
      "--rm",
      imageTag,
      "sh",
      "-lc",
      "test -f /app/poker/protocol/constants.mjs && test -f /app/poker/protocol/envelope.mjs && test -f /app/poker/handlers/hello.mjs && test -f /app/poker/runtime/conn-state.mjs"
    ]);
    assert.equal(check.status, 0, `required ws modules are missing in image:\n${check.stderr || check.stdout}`);
  } finally {
    run("docker", ["rmi", "-f", imageTag]);
  }
});
