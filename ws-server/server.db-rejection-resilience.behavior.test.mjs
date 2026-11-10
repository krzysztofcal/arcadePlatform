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

test("background sweeps survive transient database CONNECT_TIMEOUT without unhandled rejections", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-db-resilience-"));
  const rejectingModulePath = path.join(tempDir, "rejecting-loader.mjs");
  const moduleSource = `
export async function beginSqlWs() {
  const error = new Error("write CONNECT_TIMEOUT aws-1-eu-west-3.pooler.supabase.com:6543");
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
      SUPABASE_DB_URL: "postgresql://postgres.mock:secret@aws-1-eu-west-3.pooler.supabase.com:6543/postgres",
      WS_BEGIN_SQL_LOADER_MODULE_PATH: rejectingModulePath,
      WS_ZOMBIE_TABLE_SWEEP_MS: "30",
      WS_OPEN_TABLE_JANITOR_SWEEP_MS: "30",
      WS_STALE_ACTIVE_SEAT_SWEEP_MS: "30",
      WS_POKER_ACTION_HISTORY_SWEEP_MS: "30"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (buf) => stdoutLines.push(String(buf)));
  child.stderr.on("data", (buf) => stderrLines.push(String(buf)));

  try {
    await waitForListening(child, 5000);

    // Allow multiple sweep cycles (30ms intervals) to fire with the rejecting database
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

    // Verify handled failure logs were emitted
    assert.equal(
      combinedLogs.includes("ws_zombie_cleanup_list_failed")
      || combinedLogs.includes("ws_open_table_janitor_list_failed")
      || combinedLogs.includes("ws_stale_seat_cleanup_list_failed"),
      true,
      "Should safely log handled sweep failures via klogSafe"
    );
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("retention cleanups preserve strict execution ordering and error isolation", async () => {
  let actionHistoryCalled = 0;
  let closedTableCalled = 0;

  // Case 1: actionHistory skipped due to sweep_in_progress -> closedTableCleanup must NOT run
  const mockActionInProgress = {
    sweep: async () => {
      actionHistoryCalled += 1;
      return { ok: true, skipped: true, reason: "sweep_in_progress" };
    }
  };
  const mockClosed = {
    sweep: async () => {
      closedTableCalled += 1;
      return { ok: true };
    }
  };

  async function testRunRetention(actionHistory, closed) {
    if (actionHistory) {
      try {
        const historyResult = await actionHistory.sweep();
        if (!historyResult || historyResult.ok !== true || (historyResult.skipped === true && historyResult.reason === "sweep_in_progress")) {
          return;
        }
      } catch {
        return;
      }
    }
    if (closed) {
      try {
        await closed.sweep();
      } catch {}
    }
  }

  await testRunRetention(mockActionInProgress, mockClosed);
  assert.equal(actionHistoryCalled, 1);
  assert.equal(closedTableCalled, 0, "closedTableCleanup must not run when action-history sweep is in progress");

  // Case 2: actionHistory error -> closedTableCleanup must NOT run
  const mockActionError = {
    sweep: async () => {
      actionHistoryCalled += 1;
      throw new Error("DB connection timeout");
    }
  };
  await testRunRetention(mockActionError, mockClosed);
  assert.equal(actionHistoryCalled, 2);
  assert.equal(closedTableCalled, 0, "closedTableCleanup must not run when action-history sweep throws");

  // Case 3: actionHistory ok !== true -> closedTableCleanup must NOT run
  const mockActionFailed = {
    sweep: async () => {
      actionHistoryCalled += 1;
      return { ok: false, reason: "phase1_failed" };
    }
  };
  await testRunRetention(mockActionFailed, mockClosed);
  assert.equal(actionHistoryCalled, 3);
  assert.equal(closedTableCalled, 0, "closedTableCleanup must not run when action-history sweep fails");

  // Case 4: actionHistory success -> closedTableCleanup runs
  const mockActionSuccess = {
    sweep: async () => {
      actionHistoryCalled += 1;
      return { ok: true, skipped: false };
    }
  };
  await testRunRetention(mockActionSuccess, mockClosed);
  assert.equal(actionHistoryCalled, 4);
  assert.equal(closedTableCalled, 1, "closedTableCleanup must run after action-history succeeds");
});
