import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = address && typeof address === "object" ? address.port : null;
      srv.close((err) => {
        if (err) return reject(err);
        if (!port) return reject(new Error("Port allocation failed"));
        resolve(port);
      });
    });
  });
}

function waitForListening(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off("data", onStdout);
      proc.stderr.off("data", onStderr);
      proc.off("exit", onExit);
    };

    const onStdout = (buf) => {
      const text = String(buf);
      stdoutChunks.push(text);
      if (text.includes("WS listening on")) {
        cleanup();
        resolve();
      }
    };

    const onStderr = (buf) => {
      stderrChunks.push(String(buf));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        `Server did not start in time. stdout: ${stdoutChunks.join("")} stderr: ${stderrChunks.join("")}`
      ));
    }, timeoutMs);

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(
        `Server exited before ready: code=${code} signal=${signal || "none"}. stdout: ${stdoutChunks.join("")} stderr: ${stderrChunks.join("")}`
      ));
    };

    proc.stdout.on("data", onStdout);
    proc.stderr.on("data", onStderr);
    proc.once("exit", onExit);
  });
}

function waitForExit(proc) {
  if (proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => proc.once("exit", resolve));
}

test("zombie table background sweep survives transient database CONNECT_TIMEOUT without unhandled rejection", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-db-resilience-"));
  const rejectingModulePath = path.join(tempDir, "rejecting-loader.mjs");
  const moduleSource = `
export async function beginSqlWs() {
  const error = new Error("write CONNECT_TIMEOUT 127.0.0.1:54329");
  error.code = "CONNECT_TIMEOUT";
  throw error;
}
`;
  await fs.writeFile(rejectingModulePath, moduleSource, "utf8");

  const port = await getFreePort();
  const stdoutLines = [];
  const stderrLines = [];

  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    cwd: path.resolve(new URL(".", import.meta.url).pathname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      WS_POKER_LOG_LEVEL: "INFO",
      SUPABASE_DB_URL: "postgresql://postgres.test:test-secret@127.0.0.1:54329/postgres",
      WS_BEGIN_SQL_LOADER_MODULE_PATH: rejectingModulePath,
      WS_ZOMBIE_TABLE_SWEEP_MS: "30"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (buf) => stdoutLines.push(String(buf)));
  child.stderr.on("data", (buf) => stderrLines.push(String(buf)));

  try {
    await waitForListening(child, 5000);

    // Allow multiple zombie sweep cycles (30ms intervals) to fire with the rejecting database
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify server remained alive and responsive
    assert.equal(child.exitCode, null, "Server should not exit on database connection timeouts");

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");

    // Verify no unhandled rejections occurred
    const combinedLogs = stdoutLines.join("") + stderrLines.join("");
    assert.equal(
      combinedLogs.includes("ws_unhandled_rejection"),
      false,
      "Should not emit ws_unhandled_rejection on transient database errors"
    );

    // Verify handled failure log was emitted specifically by the zombie sweep query
    assert.equal(
      combinedLogs.includes("ws_zombie_cleanup_list_failed"),
      true,
      "Should safely log handled zombie sweep failure via ws_zombie_cleanup_list_failed"
    );
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
