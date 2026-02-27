import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("npm ci for ws-server succeeds", async () => {
  const result = await new Promise((resolve) => {
    const child = spawn("npm", ["ci", "--prefix", "ws-server", "--ignore-scripts"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, `npm ci failed (code ${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});
