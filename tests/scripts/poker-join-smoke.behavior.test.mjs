import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

function runSmoke({ env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/poker-join-smoke.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, ...env }
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("poker-join-smoke rejects seatNo=0 before sending requests", async () => {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const result = await runSmoke({
      env: {
        POKER_JOIN_URL: `http://127.0.0.1:${port}/join`,
        POKER_AUTH_TOKEN: "test-token",
        POKER_TABLE_ID: "table-1",
        POKER_JOIN_COUNT: "1",
        POKER_SEAT_NO: "0"
      }
    });

    assert.notEqual(result.code, 0);
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.equal(combined.includes("POKER_SEAT_NO must be a positive integer (>= 1)"), true);
    assert.equal(requestCount, 0);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("poker-join-smoke accepts seatNo=1 and sends one request", async () => {
  let requestCount = 0;
  let requestBody = null;
  const server = http.createServer(async (req, res) => {
    requestCount += 1;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const result = await runSmoke({
      env: {
        POKER_JOIN_URL: `http://127.0.0.1:${port}/join`,
        POKER_AUTH_TOKEN: "test-token",
        POKER_TABLE_ID: "table-1",
        POKER_JOIN_COUNT: "1",
        POKER_SEAT_NO: "1"
      }
    });

    assert.equal(result.code, 0);
    assert.equal(requestCount, 1);
    assert.equal(requestBody.seatNo, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("poker-join-smoke defaults to seatNo=1 when env var is unset", async () => {
  let requestBody = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const result = await runSmoke({
      env: {
        POKER_JOIN_URL: `http://127.0.0.1:${port}/join`,
        POKER_AUTH_TOKEN: "test-token",
        POKER_TABLE_ID: "table-1",
        POKER_JOIN_COUNT: "1"
      }
    });

    assert.equal(result.code, 0);
    assert.equal(requestBody.seatNo, 1);
    assert.equal(result.stdout.includes("Completed 1 join requests successfully."), true);
  } finally {
    server.close();
    await once(server, "close");
  }
});
