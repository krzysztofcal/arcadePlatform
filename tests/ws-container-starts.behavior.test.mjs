import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...options });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("ws container starts, logs readiness, and serves healthz", { timeout: 240000 }, async (t) => {
  const dockerCheck = run("docker", ["version"]);
  if (dockerCheck.status !== 0) {
    t.skip("docker is required for ws container behavior tests");
    return;
  }

  const imageTag = `arcadeplatform-ws-test:${Date.now()}-starts`;
  const containerName = `arcadeplatform-ws-test-${Date.now()}`;

  let containerId = "";
  try {
    const build = run("docker", ["build", "-t", imageTag, "-f", "ws-server/Dockerfile", "ws-server"]);
    assert.equal(build.status, 0, `docker build failed:\n${build.stderr || build.stdout}`);

    const runOut = run("docker", [
      "run",
      "-d",
      "--name",
      containerName,
      "-e",
      "PORT=3000",
      "-p",
      "0:3000",
      imageTag
    ]);
    assert.equal(runOut.status, 0, `docker run failed:\n${runOut.stderr || runOut.stdout}`);
    containerId = runOut.stdout.trim();
    assert.notEqual(containerId, "");

    const portOut = run("docker", ["port", containerId, "3000/tcp"]);
    assert.equal(portOut.status, 0, `could not read mapped port:\n${portOut.stderr || portOut.stdout}`);
    const mapped = portOut.stdout.trim();
    const match = mapped.match(/:(\d+)$/);
    assert.ok(match, `unexpected docker port output: ${mapped}`);
    const hostPort = Number(match[1]);

    let sawReadyLog = false;
    let healthOk = false;
    for (let i = 0; i < 40; i += 1) {
      const logs = run("docker", ["logs", containerId]);
      const combinedLogs = `${logs.stdout}\n${logs.stderr}`;
      if (/WS listening on/.test(combinedLogs)) {
        sawReadyLog = true;
      }

      try {
        const resp = await fetch(`http://127.0.0.1:${hostPort}/healthz`);
        const body = await resp.text();
        if (resp.status === 200 && body.trim() === "ok") {
          healthOk = true;
        }
      } catch {
        // keep polling until timeout
      }

      if (sawReadyLog && healthOk) {
        break;
      }
      await sleep(250);
    }

    assert.equal(sawReadyLog, true, "container logs never contained 'WS listening on'");
    assert.equal(healthOk, true, "healthz endpoint never returned 200 + ok");

    await sleep(2000);
    const running = run("docker", ["inspect", "-f", "{{.State.Running}}", containerId]);
    assert.equal(running.status, 0, `could not inspect container state:\n${running.stderr || running.stdout}`);
    assert.equal(running.stdout.trim(), "true", "container stopped shortly after readiness");
  } finally {
    if (containerId) {
      run("docker", ["rm", "-f", containerId]);
    } else {
      run("docker", ["rm", "-f", containerName]);
    }
    run("docker", ["rmi", "-f", imageTag]);
  }
});
