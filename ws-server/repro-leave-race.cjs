const WebSocket = require('ws');
const { createHmac } = require('crypto');

function send(ws, frame) {
  ws.send(JSON.stringify(frame));
}

function waitForMsg(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      try {
        const obj = JSON.parse(String(data));
        if (predicate(obj)) {
          cleanup();
          resolve(obj);
        }
      } catch (e) {}
    };
    const onError = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error('socket closed')); };
    const cleanup = () => { clearTimeout(timer); ws.off('message', onMessage); ws.off('error', onError); ws.off('close', onClose); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('timed out')); }, timeout);
    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.on('close', onClose);
  });
}

async function run() {
  const port = process.env.PORT || 9090;
  const secret = process.env.WS_AUTH_TEST_SECRET || 'test-secret';
  const token = (() => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'race_user' })).toString('base64url');
    const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  })();

  console.log('connecting clientA');
  const a = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r, rej) => { a.once('open', r); a.once('error', rej); });
  console.log('clientA open');
  send(a, { version: '1.0', type: 'hello', requestId: 'h-a', ts: new Date().toISOString(), payload: { supportedVersions: ['1.0'] } });
  const helloA = await waitForMsg(a, (m) => m.type === 'helloAck' || m.type === 'hello', 2000).catch(() => null);
  console.log('clientA helloResp', helloA && helloA.type);
  send(a, { version: '1.0', type: 'auth', requestId: 'auth-a', ts: new Date().toISOString(), payload: { token } });
  const authA = await waitForMsg(a, (m) => m.type === 'authOk', 2000).catch(() => null);
  console.log('clientA auth', authA && authA.type, authA && authA.payload && authA.payload.sessionId);
  if (!authA || !authA.payload || !authA.payload.sessionId) {
    console.error('authA failed'); process.exit(2);
  }
  const sessionId = authA.payload.sessionId;

  send(a, { version: '1.0', type: 'table_join', requestId: 'join-a', ts: new Date().toISOString(), payload: { tableId: 'table_leave_race' } });
  const joinResp = await waitForMsg(a, (m) => m.type === 'table_state' || (m.type === 'commandResult' && m.payload && m.payload.requestId === 'join-a'), 3000).catch(() => null);
  console.log('clientA joinResp', joinResp && joinResp.type);

  console.log('connecting clientB');
  const b = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r, rej) => { b.once('open', r); b.once('error', rej); });
  console.log('clientB open');
  send(b, { version: '1.0', type: 'hello', requestId: 'h-b', ts: new Date().toISOString(), payload: { supportedVersions: ['1.0'] } });
  await waitForMsg(b, (m) => m.type === 'helloAck' || m.type === 'hello', 2000).catch(() => null);
  send(b, { version: '1.0', type: 'auth', requestId: 'auth-b', ts: new Date().toISOString(), payload: { token } });
  const authB = await waitForMsg(b, (m) => m.type === 'authOk', 2000).catch(() => null);
  console.log('clientB auth', authB && authB.type);

  console.log('clientB sending resume to take over');
  send(b, { version: '1.0', type: 'resume', roomId: 'table_leave_race', requestId: 'resume-b', ts: new Date().toISOString(), payload: { tableId: 'table_leave_race', sessionId, lastSeq: 0 } });

  // Option A: immediate leave from A
  console.log('clientA sending leave immediately after resume');
  send(a, { version: '1.0', type: 'leave', requestId: 'leave-a', ts: new Date().toISOString(), payload: { tableId: 'table_leave_race' } });

  // Collect messages for 2s
  const collect = (ws, name) => new Promise((resolve) => {
    const messages = [];
    const onMessage = (m) => { messages.push({ name, msg: JSON.parse(String(m)) }); };
    ws.on('message', onMessage);
    setTimeout(() => { ws.off('message', onMessage); resolve(messages); }, 2200);
  });

  const [msgsA, msgsB] = await Promise.all([collect(a, 'A'), collect(b, 'B')]);
  console.log('--- clientA messages ---'); msgsA.forEach((o) => console.log(JSON.stringify(o)));
  console.log('--- clientB messages ---'); msgsB.forEach((o) => console.log(JSON.stringify(o)));

  a.close(); b.close();
}

run().catch((e) => { console.error('error', e && e.stack ? e.stack : e); process.exit(1); });
