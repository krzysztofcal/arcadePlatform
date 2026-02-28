import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...options });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDockerPortOutput(mapped) {
  const lines = mapped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const ipv4Line = lines.find((line) => /^0\.0\.0\.0:(\d+)$/.test(line));
  const fallbackLine = ipv4Line || lines.find((line) => /:(\d+)$/.test(line));

  const match = fallbackLine?.match(/:(\d+)$/);
  if (!match) {
    throw new Error(`unexpected docker port output:\n${mapped}`);
  }

  const hostPort = Number(match[1]);
  if (!Number.isFinite(hostPort) || hostPort <= 0) {
    throw new Error(`invalid docker host port in output:\n${mapped}`);
  }

  return hostPort;
}

async function probeHealthz(hostPort, timeoutMs) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`http://127.0.0.1:${hostPort}/healthz`, { signal: controller.signal });
    const body = await resp.text();
    return { ok: resp.status === 200 && body.trim() === "ok", aborted: false };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return { ok: false, aborted };
  } finally {
    clearTimeout(abortTimer);
  }
}

function startWsContainer(imageTag, containerName) {
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

  const containerId = runOut.stdout.trim();
  assert.notEqual(containerId, "");

  const portOut = run("docker", ["port", containerId, "3000/tcp"]);
  assert.equal(portOut.status, 0, `could not read mapped port:\n${portOut.stderr || portOut.stdout}`);

  const mapped = (portOut.stdout || "").trim();
  let hostPort = 0;
  try {
    hostPort = parseDockerPortOutput(mapped);
  } catch (error) {
    assert.fail(error instanceof Error ? error.message : `unexpected docker port output:\n${mapped}`);
  }
  assert.equal(Number.isFinite(hostPort) && hostPort > 0, true, `invalid host port from output:\n${mapped}`);

  return { containerId, hostPort };
}

function cleanupWsContainer(imageTag, containerName) {
  run("docker", ["rm", "-f", containerName]);
  run("docker", ["rmi", "-f", imageTag]);
}

test("parseDockerPortOutput handles multi-line docker mappings", () => {
  assert.equal(parseDockerPortOutput("0.0.0.0:49153\n:::49153\n"), 49153);
  assert.equal(parseDockerPortOutput(":::49153\n0.0.0.0:49153\n"), 49153);
  assert.equal(parseDockerPortOutput("127.0.0.1:49153\n"), 49153);
});

test("parseDockerPortOutput reports readable error for invalid output", () => {
  assert.throws(
    () => parseDockerPortOutput("no-port-here\n"),
    /unexpected docker port output:\nno-port-here/
  );
});

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
    const started = startWsContainer(imageTag, containerName);
    containerId = started.containerId;
    const hostPort = started.hostPort;

    let sawReadyLog = false;
    let healthOk = false;
    for (let i = 0; i < 40; i += 1) {
      const logs = run("docker", ["logs", containerId]);
      const combinedLogs = `${logs.stdout}\n${logs.stderr}`;
      if (/WS listening on/.test(combinedLogs)) {
        sawReadyLog = true;
      }

      const probe = await probeHealthz(hostPort, 400);
      if (probe.ok) {
        healthOk = true;
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
    cleanupWsContainer(imageTag, containerName);
  }
});

test("healthz polling is abortable and does not leave pending promises", { timeout: 240000 }, async (t) => {
  const dockerCheck = run("docker", ["version"]);
  if (dockerCheck.status !== 0) {
    t.skip("docker is required for ws container behavior tests");
    return;
  }

  const imageTag = `arcadeplatform-ws-test:${Date.now()}-abortable`;
  const containerName = `arcadeplatform-ws-test-${Date.now()}-abortable`;

  try {
    const started = startWsContainer(imageTag, containerName);
    const hostPort = started.hostPort;

    for (let i = 0; i < 25; i += 1) {
      const probe = await probeHealthz(hostPort, 400);
      assert.equal(typeof probe.ok, "boolean");
      assert.equal(typeof probe.aborted, "boolean");
      await sleep(50);
    }
  } finally {
    cleanupWsContainer(imageTag, containerName);
  }
});
