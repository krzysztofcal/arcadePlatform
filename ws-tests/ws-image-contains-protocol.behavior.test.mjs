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
      "test -f /app/ws-server/poker/protocol/constants.mjs && test -f /app/ws-server/poker/protocol/envelope.mjs && test -f /app/ws-server/poker/handlers/hello.mjs && test -f /app/ws-server/poker/runtime/conn-state.mjs && test -f /app/ws-server/poker/table/table-snapshot.mjs && test -f /app/ws-server/poker/snapshot-runtime/poker-turn-timeout.mjs && test -f /app/ws-server/poker/snapshot-runtime/poker-state-utils.mjs && test -f /app/ws-server/poker/snapshot-runtime/poker-legal-actions.mjs && test -f /app/ws-server/poker/persistence/authoritative-join-adapter.mjs && test -f /app/netlify/functions/_shared/poker-turn-timeout.mjs && test -f /app/netlify/functions/_shared/supabase-admin.mjs && test -f /app/shared/poker-domain/leave.mjs && test -f /app/shared/poker-domain/join.mjs && test ! -f /app/netlify/functions/_shared/xp-cors.mjs"
    ]);
    assert.equal(runtimeCheck.status, 0, `required ws modules are missing in image:
${runtimeCheck.stderr || runtimeCheck.stdout}`);
  } finally {
    try { fs.unlinkSync(sentinelPath); } catch {}
    run("docker", ["rmi", "-f", imageTag]);
  }
});


test("docker runtime resolves authoritative join adapter dependency chain", { timeout: 180000 }, (t) => {
  const dockerCheck = run("docker", ["version"]);
  if (dockerCheck.status !== 0) {
    t.skip("docker is required for ws image behavior tests");
    return;
  }

  const imageTag = `arcadeplatform-ws-test:${Date.now()}-join-loader`;
  try {
    const build = run("docker", ["build", "-t", imageTag, "-f", "ws-server/Dockerfile", "."]);
    assert.equal(build.status, 0, `docker build failed:
${build.stderr || build.stdout}`);

    const runtime = run("docker", [
      "run",
      "--rm",
      imageTag,
      "sh",
      "-lc",
      `cd /app/ws-server && node --input-type=module -e 'const mod = await import("./poker/persistence/authoritative-join-adapter.mjs"); const execute = mod.createAuthoritativeJoinExecutor({ env: { SUPABASE_DB_URL: "", WS_TEST_AUTHORITATIVE_JOIN_RESULT_JSON: "" }, beginSql: async (fn) => fn({}), klog: () => {} }); const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" }); if (result?.code === "temporarily_unavailable") { throw new Error("temporarily_unavailable"); }'`
    ]);
    assert.equal(runtime.status, 0, `authoritative join dependency chain failed in docker runtime:
${runtime.stderr || runtime.stdout}`);
  } finally {
    run("docker", ["rmi", "-f", imageTag]);
  }
});
