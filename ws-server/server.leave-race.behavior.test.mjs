import test from "node:test";
import assert from "node:assert/strict";
import { createServer, connectClient, waitForListening, hello, auth, sendFrame, nextMessage, waitForExit } from "./server.test-helpers.mjs";

// This test reproduces the ownership race: socket A owns a session and is joined to a table.
// socket B resumes/takes over the session. Socket A immediately attempts to send a protected
// leave frame in the rebind window. With deny semantics, server must reject A's protected
// frame (STALE_SESSION) and accept B's leave.

test("resume takeover rejects protected leave from prior socket", async () => {
  const secret = "test-secret";
  const token = (function makeHs256Jwt({ secret, sub }) {
    const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
    const signature = require('crypto').createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  })({ secret, sub: "race_user" });

  const { port, child } = await (async () => {
    const { getFreePort } = await import("./server.behavior.test.mjs");
    const srv = await getFreePort();
    const spawn = (await import('node:child_process')).spawn;
    const child = spawn(process.execPath, ["ws-server/server.mjs"], {
      env: { ...process.env, PORT: String(srv), WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await (async function waitForListeningProc(proc, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const onStdout = (buf) => { if (String(buf).includes('WS listening on')) { cleanup(); resolve(); } };
        const onStderr = () => {};
        const onExit = (code) => { cleanup(); reject(new Error('server exited before ready')); };
        const cleanup = () => { proc.stdout.off('data', onStdout); proc.stderr.off('data', onStderr); proc.off('exit', onExit); };
        proc.stdout.on('data', onStdout);
        proc.stderr.on('data', onStderr);
        proc.once('exit', onExit);
        setTimeout(() => { cleanup(); reject(new Error('server start timeout')); }, timeoutMs);
      });
    })(child);
    return { port: srv, child };
  })();

  try {
    // connect client A and authenticate
    const clientA = await connectClient(port);
    await hello(clientA);
    const authResp = await auth(clientA, token);
    const sessionId = authResp.payload.sessionId;

    // join a table so leave is applicable
    sendFrame(clientA, { version: "1.0", type: "table_join", requestId: "req-join-a", ts: "2026-02-28T00:00:00Z", payload: { tableId: "table_leave_race" } });
    const joined = await nextMessage(clientA);
    assert.equal(joined.type === 'table_state' || joined.type === 'commandResult', true, 'expected join acknowledgment');

    // connect client B and authenticate with same token
    const clientB = await connectClient(port);
    await hello(clientB);
    await auth(clientB, token);

    // clientB sends resume to take over the session
    sendFrame(clientB, { version: "1.0", type: "resume", roomId: "table_leave_race", requestId: "req-resume-b", ts: "2026-02-28T00:00:01Z", payload: { tableId: "table_leave_race", sessionId: sessionId, lastSeq: 0 } });

    // Immediately have clientA attempt to send leave (protected frame)
    sendFrame(clientA, { version: "1.0", type: "leave", requestId: "req-leave-a", ts: "2026-02-28T00:00:01Z", payload: { tableId: "table_leave_race" } });

    // Expect clientA to receive an error STALE_SESSION for its leave
    const msgA = await nextMessage(clientA, 3000).catch(() => null);
    assert.ok(msgA, 'clientA should receive a response');
    assert.equal(msgA.type, 'error');
    assert.equal(msgA.payload.code, 'STALE_SESSION');

    // Meanwhile, clientB should receive a resume ack (commandResult accepted)
    const msgB = await nextMessage(clientB, 3000).catch(() => null);
    assert.ok(msgB, 'clientB should receive resume ack');
    assert.equal(msgB.type, 'commandResult');
    assert.equal(msgB.payload.status, 'accepted');

    // Now clientB sends leave and it should be accepted
    sendFrame(clientB, { version: "1.0", type: "leave", requestId: "req-leave-b", ts: "2026-02-28T00:00:02Z", payload: { tableId: "table_leave_race" } });
    const leaveBResp = await nextMessage(clientB, 3000);
    assert.equal(leaveBResp.type, 'commandResult');
    assert.equal(leaveBResp.payload.status, 'accepted');

    clientA.close();
    clientB.close();
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});
