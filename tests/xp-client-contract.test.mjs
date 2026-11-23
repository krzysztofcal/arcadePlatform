import assert from 'node:assert/strict';
import vm from 'node:vm';

function response(status, json) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return json; },
    async text() { return JSON.stringify(json); },
  };
}

async function loadClientWithFetch(fetchImpl, options = {}) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const src = await fs.readFile(path.join(__dirname, '..', 'js', 'xpClient.js'), 'utf8');

  const store = new Map();
  let randomId = 0;
  const baseWindow = { localStorage: {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  } };
  const ctx = {
    window: Object.assign(baseWindow, options.window || {}),
    fetch: fetchImpl,
    crypto: { randomUUID: () => `uuid-test-${++randomId}` },
    Date: options.Date || Date, setTimeout, clearTimeout, console, JSON,
  };
  ctx.window.fetch = fetchImpl;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'xpClient.js' });
  return ctx.window.XPClient;
}

(async () => {
  const semanticWindow = (scoreDelta) => ({
    gameId: 'pacman', windowStart: Date.now() - 1000, windowEnd: Date.now(),
    inputEvents: 3, visibilitySeconds: 1, gameplayActions: 1, scoreDelta,
  });

  // Success path
  {
    const XPClient = await loadClientWithFetch(async (_url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.operation === 'status') return response(200, { ok: true, status: 'statusOnly' });
      return response(200, { ok: true, awarded: 10, totalToday: 10, sessionTotal: 10, lastSync: body.ts, cap: 400, capDelta: 240 });
    });
    const res = await XPClient.postWindowServerCalc(semanticWindow(10));
    assert.equal(res.awarded, 10);
  }

  // 422 with delta_out_of_range → throws
  {
    const XPClient = await loadClientWithFetch(async () =>
      response(422, { error: 'delta_out_of_range', capDelta: 123 })
    );
    await assert.rejects(
      () => XPClient.postWindowServerCalc(semanticWindow(9999)),
      /delta_out_of_range/i
    );
  }

  // 500 → throws
  {
    const XPClient = await loadClientWithFetch(async () =>
      response(500, { error: 'server_error' })
    );
    await assert.rejects(
      () => XPClient.postWindowServerCalc(semanticWindow(1)),
      /server_error|status 500/i
    );
  }

  // Network error → throws
  {
    const XPClient = await loadClientWithFetch(async () => {
      throw new Error('fetch failed');
    });
    await assert.rejects(
      () => XPClient.postWindowServerCalc(semanticWindow(1)),
      /fetch failed|XP request failed/i
    );
  }

  // refreshBadgeFromServer applies status payload without award animation meta
  {
    let applied = null;
    const calls = [];
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts?.body || '{}') });
      return response(200, { ok: true, status: 'statusOnly', totalLifetime: 777, cap: 10 });
    }, {
      window: {
        XP: {
          refreshFromServerStatus(payload, meta){
            applied = { payload, meta };
          },
        },
      },
    });
    await XPClient.refreshBadgeFromServer({ bumpBadge: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/.netlify/functions/calculate-xp');
    assert.equal(calls[0].body.operation, 'status');
    assert.equal(calls[0].body.statusOnly, undefined);
    assert.equal(applied.payload.totalLifetime, 777);
    assert.equal(applied.meta.source, 'status');
    assert.equal(applied.meta.bump, undefined);
  }

  // Authenticated XP cache hydrates without award animation and publishes only confirmed snapshots.
  {
    let applied = null;
    let userUiListener = null;
    const published = [];
    const cached = { totalLifetime: 300, level: 3 };
    const XPClient = await loadClientWithFetch(async () => response(200, { ok: true, status: 'statusOnly', totalLifetime: 300 }), {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => 'token',
          getCurrentUserId: async () => 'xp-user',
        },
        UserUiState: {
          hydrate(userId){ assert.equal(userId, 'xp-user'); return { xp: cached }; },
          publish(userId, slice, value){ published.push({ userId, slice, value }); return value; },
          onChange(listener){ userUiListener = listener; },
        },
        XP: {
          refreshFromServerStatus(payload, meta){ applied = { payload, meta }; },
          getSnapshot(){ return { totalXp: applied ? applied.payload.totalLifetime : 0, level: applied && applied.payload.totalLifetime === 450 ? 4 : (applied ? 3 : 1) }; },
        },
      },
    });
    const hydrated = await XPClient.hydrateCachedXp();
    assert.deepEqual(hydrated, cached);
    assert.equal(applied.payload.totalLifetime, 300);
    assert.equal(applied.meta.source, 'user-ui-cache');
    assert.equal(applied.meta.authenticated, true);
    assert.equal(applied.meta.hydration, true);
    assert.equal(applied.meta.bump, undefined);
    await XPClient.publishConfirmedXp({ ok: true, totalLifetime: 300 });
    assert.equal(JSON.stringify(published), JSON.stringify([{ userId: 'xp-user', slice: 'xp', value: cached }]));
    await XPClient.publishConfirmedXp({ ok: false, totalLifetime: 900 });
    assert.equal(published.length, 1);
    userUiListener({ slice: 'xp', value: { totalLifetime: 450, level: 4 } });
    assert.equal(applied.payload.totalLifetime, 450);
    assert.equal(applied.meta.hydration, true);
  }

  // Reaching the server-side session cap rotates the next award session.
  {
    const awardCalls = [];
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') return response(200, { ok: true, status: 'statusOnly' });
      if (url === '/.netlify/functions/calculate-xp') {
        awardCalls.push(body);
        return response(200, {
          ok: true,
          awarded: 10,
          totalToday: awardCalls.length * 10,
          totalLifetime: awardCalls.length * 10,
          sessionTotal: awardCalls.length === 1 ? 300 : 10,
          sessionCapped: awardCalls.length === 1,
          cap: 3000,
          capDelta: 300,
        });
      }
      return response(200, { ok: true });
    });

    await XPClient.postWindowServerCalc({ gameId: 'pacman', scoreDelta: 10 });
    await XPClient.postWindowServerCalc({ gameId: 'pacman', scoreDelta: 10 });
    assert.equal(awardCalls.length, 2);
    assert.notEqual(awardCalls[0].sessionId, awardCalls[1].sessionId);
  }

  // Concurrent invalid sessions share one renewal request.
  {
    let startSessionCalls = 0;
    let releaseSession;
    const sessionReady = new Promise(resolve => { releaseSession = resolve; });
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (url === '/.netlify/functions/start-session') {
        startSessionCalls += 1;
        await sessionReady;
        return response(200, { ok: true, sessionId: 'renewed-session', sessionToken: 'renewed-token', expiresIn: 600 });
      }
      if (body.operation === 'status') return response(200, { ok: true, status: 'statusOnly' });
      if (body.sessionToken === 'renewed-token') return response(200, { ok: true, awarded: 1 });
      return response(401, { error: 'invalid_session', reason: 'invalid', requiresNewSession: true });
    });

    const first = XPClient.postWindowServerCalc(semanticWindow(1));
    const second = XPClient.postWindowServerCalc(semanticWindow(1));
    for (let i = 0; i < 20 && startSessionCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(startSessionCalls, 1);
    releaseSession();
    await Promise.all([first, second]);
    assert.equal(startSessionCalls, 1);
  }

  // 1. Concurrent: 3 concurrent fetchStatus() calls with an identical token and ids → exactly 1 status POST, and all 3 resolve to the same payload.
  {
    const calls = [];
    let resolveNetwork;
    const networkPromise = new Promise(resolve => { resolveNetwork = resolve; });
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        calls.push({ url, headers: opts?.headers || {}, body });
        await networkPromise;
        return response(200, { ok: true, status: 'statusOnly', totalLifetime: 100 });
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => 'test-token-1',
          getCurrentUserId: async () => 'user-1',
        },
      },
    });

    const p1 = XPClient.fetchStatus();
    const p2 = XPClient.fetchStatus();
    const p3 = XPClient.fetchStatus();

    resolveNetwork();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.equal(calls.length, 1, '3 concurrent fetchStatus calls must share 1 POST');
    assert.deepEqual(r1, { ok: true, status: 'statusOnly', totalLifetime: 100 });
    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
    assert.notStrictEqual(r1, r2, 'joined caller must receive its own copy');
    assert.notStrictEqual(r1, r3, 'joined caller must receive its own copy');
    assert.notStrictEqual(r2, r3, 'joined caller must receive its own copy');
    r2.mutated = true;
    assert.equal(r1.mutated, undefined, 'mutating joined result must not affect leader result');
    assert.equal(r3.mutated, undefined, 'mutating joined result must not affect other callers');
  }

  // 2. User or token change: call 1 is in flight with token A. The bridge then returns token B (a different sub) and call 2 starts → 2 POSTs. Call 2's POST carries B, and call 1's carries A.
  {
    const calls = [];
    let currentToken = 'token-A';
    let currentTime = 1_000_000;
    const fakeDate = function(...args) { return new Date(...args); };
    fakeDate.now = () => currentTime;
    Object.setPrototypeOf(fakeDate, Date);

    let resolve1;
    const wait1 = new Promise(resolve => { resolve1 = resolve; });
    let resolve2;
    const wait2 = new Promise(resolve => { resolve2 = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        const item = { url, headers: opts?.headers || {}, body };
        calls.push(item);
        if (calls.length === 1) {
          await wait1;
        } else {
          await wait2;
        }
        return response(200, { ok: true, status: 'statusOnly', tokenUsed: item.headers.Authorization });
      }
      return response(200, { ok: true });
    }, {
      Date: fakeDate,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => currentToken,
          getCurrentUserId: async () => (currentToken === 'token-A' ? 'user-A' : 'user-B'),
        },
      },
    });

    const p1 = XPClient.fetchStatus();
    const p1b = XPClient.fetchStatus();
    for (let i = 0; i < 20 && calls.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Token changes and cache expires before call 2 starts
    currentToken = 'token-B';
    currentTime += 65_000;

    const p2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && calls.length < 2; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    resolve1();
    resolve2();
    const [r1, r1b, r2] = await Promise.all([p1, p1b, p2]);

    assert.equal(calls.length, 2, 'expected exactly 2 POSTs (1 for token A, 1 for token B)');
    assert.equal(calls[0].headers.Authorization, 'Bearer token-A');
    assert.equal(calls[1].headers.Authorization, 'Bearer token-B');
    assert.deepStrictEqual(r1, r1b);
    assert.equal(r1.tokenUsed, 'Bearer token-A');
    assert.equal(r2.tokenUsed, 'Bearer token-B');
  }

  // F2(a): A POST with token A is in flight. A new call starts whose first token read returns A, but buildAuthHeaders returns B → second POST carrying Bearer B.
  {
    const calls = [];
    let dateNowCalls = 0;
    const fakeDate = function(...args) { return new Date(...args); };
    fakeDate.now = () => {
      dateNowCalls++;
      // Call 4 is Call 2 read 1 (cache hit with token-A at currentTime 1_000_000).
      // From Call 5 onwards (Call 2 read 2 buildAuthHeaders), time has advanced past TTL (1_065_000).
      if (dateNowCalls >= 5) {
        return 1_065_000;
      }
      return 1_000_000;
    };
    Object.setPrototypeOf(fakeDate, Date);

    let resolve1;
    const wait1 = new Promise(resolve => { resolve1 = resolve; });
    let resolve2;
    const wait2 = new Promise(resolve => { resolve2 = resolve; });

    let bridgeCalls = 0;
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        const item = { url, headers: opts?.headers || {}, body };
        calls.push(item);
        if (calls.length === 1) {
          await wait1;
          return response(200, { ok: true, source: 'post1' });
        }
        await wait2;
        return response(200, { ok: true, source: 'post2' });
      }
      return response(200, { ok: true });
    }, {
      Date: fakeDate,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => {
            bridgeCalls += 1;
            if (bridgeCalls === 1) return 'token-A';
            return 'token-B';
          },
          getCurrentUserId: async () => 'user-1',
        },
      },
    });

    const p1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && calls.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, 'Bearer token-A');

    const p2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && calls.length < 2; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    resolve1();
    resolve2();
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(calls.length, 2, 'expected a second POST carrying Bearer B');
    assert.equal(calls[0].headers.Authorization, 'Bearer token-A');
    assert.equal(calls[1].headers.Authorization, 'Bearer token-B');
    assert.equal(r1.source, 'post1');
    assert.equal(r2.source, 'post2');
  }

  // 3. Session change: call 1 is in flight. Change the award session id through the existing auth path: give the fixture a window.SupabaseAuth = { onAuthChange(fn){ handler = fn } } mock, call handler('TOKEN_REFRESHED', user) (handleAuthChange regenerates the award session id), then start call 2. Expect 2 POSTs with different sessionId in the bodies.
  {
    const startedCalls = [];
    let authHandler = null;
    let resolve1;
    const wait1 = new Promise(resolve => { resolve1 = resolve; });
    let resolve2;
    const wait2 = new Promise(resolve => { resolve2 = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        const item = { url, headers: opts?.headers || {}, body };
        startedCalls.push(item);
        if (startedCalls.length === 1) {
          await wait1;
        } else {
          await wait2;
        }
        return response(200, { ok: true, status: 'statusOnly', sessionId: body.sessionId });
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuth: {
          onAuthChange(fn) { authHandler = fn; },
        },
        SupabaseAuthBridge: {
          getAccessToken: async () => 'test-token-session',
          getCurrentUserId: async () => 'user-session',
        },
      },
    });

    assert.equal(typeof authHandler, 'function', 'SupabaseAuth.onAuthChange must be bound');

    const p1 = XPClient.fetchStatus();
    const p1b = XPClient.fetchStatus();
    for (let i = 0; i < 20 && startedCalls.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Call auth handler to regenerate award session id
    authHandler('TOKEN_REFRESHED', { id: 'user-session' });

    const p2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && startedCalls.length < 2; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    resolve1();
    resolve2();
    const [r1, r1b, r2] = await Promise.all([p1, p1b, p2]);

    assert.equal(startedCalls.length, 2, 'expected exactly 2 POSTs for the started calls');
    assert.notEqual(startedCalls[0].body.sessionId, startedCalls[1].body.sessionId, 'expected different sessionId in bodies');
    assert.deepStrictEqual(r1, r1b);
    assert.equal(r1.sessionId, startedCalls[0].body.sessionId);
    assert.equal(r2.sessionId, startedCalls[1].body.sessionId);
  }

  // 4. Token expiry: fake Date past 60 s. If the re-read token is the same string, a concurrent call shares; if it is different, a new POST.
  {
    // 4a. Same token re-read after expiry shares in-flight request
    {
      const calls = [];
      let bridgeReads = 0;
      let currentTime = 1_000_000;
      const fakeDate = function(...args) { return new Date(...args); };
      fakeDate.now = () => currentTime;
      Object.setPrototypeOf(fakeDate, Date);

      let resolve1;
      const wait1 = new Promise(resolve => { resolve1 = resolve; });

      const XPClient = await loadClientWithFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        if (body.operation === 'status') {
          calls.push({ url, headers: opts?.headers || {}, body });
          await wait1;
          return response(200, { ok: true, status: 'statusOnly' });
        }
        return response(200, { ok: true });
      }, {
        Date: fakeDate,
        window: {
          SupabaseAuthBridge: {
            getAccessToken: async () => {
              bridgeReads += 1;
              return 'same-token';
            },
            getCurrentUserId: async () => 'user-same',
          },
        },
      });

      const p1 = XPClient.fetchStatus();
      for (let i = 0; i < 20 && calls.length === 0; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      currentTime += 65_000; // advance past 60 s cache TTL
      const p2 = XPClient.fetchStatus();
      for (let i = 0; i < 20; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      resolve1();
      const [r1, r2] = await Promise.all([p1, p2]);

      assert.equal(calls.length, 1, 'concurrent call with same token after expiry must share');
      assert.equal(bridgeReads, 2, 'bridge getter must be called again after TTL');
      assert.deepStrictEqual(r1, r2);
    }

    // 4b. Different token re-read after expiry sends a new POST
    {
      const calls = [];
      let currentToken = 'token-initial';
      let currentTime = 1_000_000;
      const fakeDate = function(...args) { return new Date(...args); };
      fakeDate.now = () => currentTime;
      Object.setPrototypeOf(fakeDate, Date);

      let resolve1;
      const wait1 = new Promise(resolve => { resolve1 = resolve; });
      let resolve2;
      const wait2 = new Promise(resolve => { resolve2 = resolve; });

      const XPClient = await loadClientWithFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        if (body.operation === 'status') {
          calls.push({ url, headers: opts?.headers || {}, body });
          if (calls.length === 1) await wait1;
          else await wait2;
          return response(200, { ok: true, status: 'statusOnly' });
        }
        return response(200, { ok: true });
      }, {
        Date: fakeDate,
        window: {
          SupabaseAuthBridge: {
            getAccessToken: async () => currentToken,
            getCurrentUserId: async () => 'user-test',
          },
        },
      });

      const p1 = XPClient.fetchStatus();
      for (let i = 0; i < 20 && calls.length === 0; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      currentToken = 'token-rotated';
      currentTime += 65_000;
      const p2 = XPClient.fetchStatus();
      for (let i = 0; i < 20 && calls.length < 2; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      resolve1();
      resolve2();
      await Promise.all([p1, p2]);

      assert.equal(calls.length, 2, 'concurrent call with different token after expiry must send new POST');
      assert.equal(calls[0].headers.Authorization, 'Bearer token-initial');
      assert.equal(calls[1].headers.Authorization, 'Bearer token-rotated');
    }
  }

  // 5. Error: the shared request returns HTTP 500 → every joined caller rejects with the same error. A call made after that sends a new POST.
  {
    const calls = [];
    let resolve1;
    const wait1 = new Promise(resolve => { resolve1 = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        calls.push({ url, headers: opts?.headers || {}, body });
        if (calls.length === 1) {
          await wait1;
          return response(500, { error: 'server_error' });
        }
        return response(200, { ok: true, status: 'statusOnly' });
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => 'error-token',
          getCurrentUserId: async () => 'user-error',
        },
      },
    });

    const p1 = XPClient.fetchStatus();
    const p2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && calls.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    resolve1();

    let err1 = null;
    let err2 = null;
    try { await p1; } catch (e) { err1 = e; }
    try { await p2; } catch (e) { err2 = e; }

    assert.ok(err1 && /XP status failed \(500\)/.test(err1.message), 'call 1 must reject with 500 error');
    assert.ok(err2 && /XP status failed \(500\)/.test(err2.message), 'call 2 must reject with 500 error');
    assert.equal(err1.message, err2.message, 'joined callers must receive identical error message');
    assert.equal(calls.length, 1, 'joined callers must share the single failing POST');

    // A call made after settlement sends a new POST
    const r3 = await XPClient.fetchStatus();
    assert.equal(calls.length, 2, 'call made after error settlement must send a new POST');
    assert.equal(r3.status, 'statusOnly');
  }

  // 6. Retry after settlement: a call made after the shared request resolved → a new POST (no finished-answer reuse).
  {
    const calls = [];
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        calls.push({ url, headers: opts?.headers || {}, body });
        return response(200, { ok: true, status: 'statusOnly', totalLifetime: calls.length * 10 });
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => 'settle-token',
          getCurrentUserId: async () => 'user-settle',
        },
      },
    });

    const p1 = XPClient.fetchStatus();
    const p2 = XPClient.fetchStatus();
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(calls.length, 1, 'concurrent callers must share 1 POST');
    assert.deepStrictEqual(r1, r2);
    assert.equal(r1.totalLifetime, 10);

    // Call made after settlement
    const r3 = await XPClient.fetchStatus();
    assert.equal(calls.length, 2, 'call after settlement must send a new POST');
    assert.equal(r3.totalLifetime, 20);
  }

  console.log('xp-client contract tests passed');
})();
