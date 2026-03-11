import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...options });
}

test("docker image contains authoritative leave runtime modules", { timeout: 180000 }, (t) => {
  const dockerCheck = run("docker", ["version"]);
  if (dockerCheck.status !== 0) {
    t.skip("docker is required for ws docker leave runtime guard");
    return;
  }

  const imageTag = `arcadeplatform-ws-test:${Date.now()}-leave-runtime`;
  try {
    const build = run("docker", ["build", "-t", imageTag, "-f", "ws-server/Dockerfile", "."]);
    assert.equal(build.status, 0, `docker build failed:\n${build.stderr || build.stdout}`);

    const fileCheck = run("docker", [
      "run",
      "--rm",
      imageTag,
      "sh",
      "-lc",
      "test -f /app/ws-server/shared/poker-domain/leave.mjs && test -f /app/shared/poker-domain/leave.mjs && test -f /app/netlify/functions/_shared/poker-reducer.mjs"
    ]);
    assert.equal(fileCheck.status, 0, `authoritative leave runtime files missing in image:\n${fileCheck.stderr || fileCheck.stdout}`);
  } finally {
    run("docker", ["rmi", "-f", imageTag]);
  }
});

test("docker runtime resolves authoritative leave adapter default loader", { timeout: 180000 }, (t) => {
  const dockerCheck = run("docker", ["version"]);
  if (dockerCheck.status !== 0) {
    t.skip("docker is required for ws docker leave runtime guard");
    return;
  }

  const imageTag = `arcadeplatform-ws-test:${Date.now()}-leave-loader`;
  try {
    const build = run("docker", ["build", "-t", imageTag, "-f", "ws-server/Dockerfile", "."]);
    assert.equal(build.status, 0, `docker build failed:\n${build.stderr || build.stdout}`);

    const runtime = run("docker", [
      "run",
      "--rm",
      imageTag,
      "sh",
      "-lc",
      "cd /app/ws-server && node --input-type=module -e \"import { createAuthoritativeLeaveExecutor } from './poker/persistence/authoritative-leave-adapter.mjs'; const execute = createAuthoritativeLeaveExecutor({ env: { SUPABASE_DB_URL: '' }, beginSql: async (fn) => fn({}), klog: () => {} }); const result = await execute({ tableId: 't1', userId: 'u1', requestId: 'r1' }); if (result?.code === 'temporarily_unavailable') { throw new Error('temporarily_unavailable'); }\""
    ]);
    assert.equal(runtime.status, 0, `authoritative leave loader failed in docker runtime:\n${runtime.stderr || runtime.stdout}`);
  } finally {
    run("docker", ["rmi", "-f", imageTag]);
  }
});
