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

  const store = options.store || new Map();
  let randomId = 0;
  const baseLocalStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const baseWindow = {
    localStorage: baseLocalStorage,
    atob: typeof atob !== 'undefined' ? atob : undefined,
  };
  const mergedWindow = Object.assign(baseWindow, options.window || {});
  if (options.window && options.window.localStorage) {
    mergedWindow.localStorage = options.window.localStorage;
  }
  const ctx = {
    window: mergedWindow,
    fetch: fetchImpl,
    crypto: options.crypto || { randomUUID: () => `uuid-test-${++randomId}` },
    Date: options.Date || Date, setTimeout, clearTimeout, console, JSON,
    atob: typeof atob !== 'undefined' ? atob : undefined,
    Buffer: typeof Buffer !== 'undefined' ? Buffer : undefined,
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
    // Literal JSON text: JSON.stringify would turn -0 into 0, and the test needs a real -0 in the wire body.
    const rawResponseText = '{"ok":true,"status":"statusOnly","totalLifetime":100,"capDelta":-0}';
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        calls.push({ url, headers: opts?.headers || {}, body });
        await networkPromise;
        return {
          status: 200,
          ok: true,
          async text() { return rawResponseText; },
          async json() { return JSON.parse(rawResponseText); },
        };
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
    assert.deepEqual(r1, { ok: true, status: 'statusOnly', totalLifetime: 100, capDelta: -0 });
    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
    assert.ok(Object.is(r1.capDelta, -0), 'leader must receive Object.is(capDelta, -0) === true');
    assert.ok(Object.is(r2.capDelta, -0), 'joined caller must receive Object.is(capDelta, -0) === true');
    assert.ok(Object.is(r3.capDelta, -0), 'joined caller must receive Object.is(capDelta, -0) === true');
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

  // F2(a): A POST with token A is in flight. A new call starts whose first token read returns A from cache,
  // then cache expires and buildAuthHeaders calls getter for B → second POST carrying Bearer B.
  {
    const calls = [];
    let currentTime = 1_000_000;
    const fakeDate = function(...args) { return new Date(...args); };
    fakeDate.now = () => currentTime;
    Object.setPrototypeOf(fakeDate, Date);

    let resolve1;
    let post1Settled = false;
    const wait1 = new Promise(resolve => { resolve1 = resolve; });
    let resolve2;
    const wait2 = new Promise(resolve => { resolve2 = resolve; });

    let bridgeReads = 0;
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        const item = { url, headers: opts?.headers || {}, body };
        calls.push(item);
        if (calls.length === 1) {
          await wait1;
          post1Settled = true;
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
            bridgeReads += 1;
            if (bridgeReads === 1) return 'token-A';
            return 'token-B';
          },
          getCurrentUserId: async () => 'user-1',
        },
      },
    });

    // Call 1 starts and its POST is held in flight
    const p1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && calls.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, 'Bearer token-A');
    assert.equal(bridgeReads, 1, 'call 1 must have called bridge getter once');

    // Call 2 starts: its first token read is served from the fresh cache (A)
    const p2 = XPClient.fetchStatus();
    assert.equal(bridgeReads, 1, 'call 2 first token read must be served from fresh cache (no extra getter call)');

    // Expire the cache: single explicit advance step right after call 2 passed its first check
    currentTime += 65_000;

    // Wait until POST 2 has started while POST 1 is still held in flight
    for (let i = 0; i < 20 && calls.length < 2; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    assert.equal(calls.length, 2, 'expected a second POST carrying Bearer B');
    assert.equal(post1Settled, false, 'POST 1 must still be held when POST 2 starts');
    assert.equal(bridgeReads, 2, 'buildAuthHeaders must call bridge getter exactly once more');
    assert.equal(calls[0].headers.Authorization, 'Bearer token-A');
    assert.equal(calls[1].headers.Authorization, 'Bearer token-B');

    // Now release both in-flight requests
    resolve1();
    resolve2();
    const [r1, r2] = await Promise.all([p1, p2]);

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

  // 5b. Malformed JSON response rejects both leader and joiner with SyntaxError
  {
    const calls = [];
    let resolve1;
    const wait1 = new Promise(resolve => { resolve1 = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        calls.push({ url, headers: opts?.headers || {}, body });
        await wait1;
        return {
          status: 200,
          ok: true,
          async text() { return 'not valid json {'; },
          async json() { return JSON.parse('not valid json {'); },
        };
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => 'error-token-json',
          getCurrentUserId: async () => 'user-error-json',
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

    assert.ok(err1 instanceof SyntaxError, 'leader must reject with SyntaxError on malformed JSON');
    assert.ok(err2 instanceof SyntaxError, 'joiner must reject with SyntaxError on malformed JSON');
    assert.equal(calls.length, 1, 'joined callers share single POST even on JSON parse error');
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

  function makeJwt(sub) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return `${header}.${payload}.fake_signature`;
  }

  function createFakeDate(initialTime = 1_000_000) {
    let currentTime = initialTime;
    const fakeDate = function(...args) { return new Date(...args); };
    fakeDate.now = () => currentTime;
    fakeDate.advance = (ms) => { currentTime += ms; };
    Object.setPrototypeOf(fakeDate, Date);
    return fakeDate;
  }

  // SC-001: 1. The first signed-in status sends anonId; after a 200 with anonConversionChecked, next status and award omit it
  {
    const statusCalls = [];
    const awardCalls = [];
    const jwtA = makeJwt('user-A');
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        statusCalls.push({ url, headers: opts?.headers || {}, body });
        return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
      }
      awardCalls.push({ url, headers: opts?.headers || {}, body });
      return response(200, { ok: true, awarded: 10, totalToday: 10, sessionTotal: 10, cap: 400, capDelta: 240, anonConversionChecked: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });

    // 1st status: sends anonId
    await XPClient.fetchStatus();
    assert.equal(statusCalls.length, 1);
    assert.ok(statusCalls[0].body.anonId, 'first signed-in status must send anonId');

    // 2nd status: omits anonId
    await XPClient.fetchStatus();
    assert.equal(statusCalls.length, 2);
    assert.equal(statusCalls[1].body.anonId, undefined, 'second status must omit anonId');

    // Next award: omits userId
    await XPClient.postWindowServerCalc(semanticWindow(10));
    assert.equal(awardCalls.length, 1);
    assert.equal(awardCalls[0].body.userId, undefined, 'subsequent award must omit userId');
  }

  // SC-001: 2. A 200 without the field, another 2xx, a non-2xx, a body parse error or a throw does not set the marker
  {
    const jwtA = makeJwt('user-A');

    // 2a: 200 without anonConversionChecked
    {
      const calls = [];
      const XPClient = await loadClientWithFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        calls.push({ url, body });
        return response(200, { ok: true, status: 'statusOnly' });
      }, {
        window: {
          SupabaseAuthBridge: {
            getAccessToken: async () => jwtA,
            getCurrentUserId: async () => 'user-A',
          },
        },
      });
      await XPClient.fetchStatus();
      await XPClient.fetchStatus();
      assert.equal(calls.length, 2);
      assert.ok(calls[0].body.anonId, 'call 1 sends anonId');
      assert.ok(calls[1].body.anonId, 'call 2 still sends anonId when 200 lacked anonConversionChecked');
    }

    // 2b: another 2xx (201 Created)
    {
      const calls = [];
      const XPClient = await loadClientWithFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        calls.push({ url, body });
        return response(201, { ok: true, anonConversionChecked: true });
      }, {
        window: {
          SupabaseAuthBridge: {
            getAccessToken: async () => jwtA,
            getCurrentUserId: async () => 'user-A',
          },
        },
      });
      await XPClient.fetchStatus();
      await XPClient.fetchStatus();
      assert.equal(calls.length, 2);
      assert.ok(calls[0].body.anonId, 'call 1 sends anonId');
      assert.ok(calls[1].body.anonId, 'call 2 still sends anonId after 201 response');
    }

    // 2c: non-2xx (500)
    {
      const calls = [];
      const XPClient = await loadClientWithFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        calls.push({ url, body });
        if (calls.length === 1) return response(500, { error: 'server_error' });
        return response(200, { ok: true, status: 'statusOnly' });
      }, {
        window: {
          SupabaseAuthBridge: {
            getAccessToken: async () => jwtA,
            getCurrentUserId: async () => 'user-A',
          },
        },
      });
      await assert.rejects(() => XPClient.fetchStatus(), /500/);
      await XPClient.fetchStatus();
      assert.equal(calls.length, 2);
      assert.ok(calls[1].body.anonId, 'call 2 still sends anonId after 500 error');
    }

    // 2d: body parse error (malformed JSON)
    {
      const calls = [];
      const XPClient = await loadClientWithFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        calls.push({ url, body });
        if (calls.length === 1) {
          return {
            status: 200,
            ok: true,
            async text() { return '{ malformed json'; },
            async json() { return JSON.parse('{ malformed json'); },
          };
        }
        return response(200, { ok: true, status: 'statusOnly' });
      }, {
        window: {
          SupabaseAuthBridge: {
            getAccessToken: async () => jwtA,
            getCurrentUserId: async () => 'user-A',
          },
        },
      });
      await assert.rejects(() => XPClient.fetchStatus(), SyntaxError);
      await XPClient.fetchStatus();
      assert.equal(calls.length, 2);
      assert.ok(calls[1].body.anonId, 'call 2 still sends anonId after body parse error');
    }

    // 2e: throw (network failure)
    {
      const calls = [];
      const XPClient = await loadClientWithFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        calls.push({ url, body });
        if (calls.length === 1) throw new Error('network failure');
        return response(200, { ok: true, status: 'statusOnly' });
      }, {
        window: {
          SupabaseAuthBridge: {
            getAccessToken: async () => jwtA,
            getCurrentUserId: async () => 'user-A',
          },
        },
      });
      await assert.rejects(() => XPClient.fetchStatus(), /network failure/);
      await XPClient.fetchStatus();
      assert.equal(calls.length, 2);
      assert.ok(calls[1].body.anonId, 'call 2 still sends anonId after network throw');
    }
  }

  // SC-001: 3. An anonymous request clears the marker
  {
    const statusCalls = [];
    const awardCalls = [];
    let currentToken = makeJwt('user-A');
    const store = new Map();
    const fakeDate = createFakeDate();
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        statusCalls.push({ url, headers: opts?.headers || {}, body });
        return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
      }
      awardCalls.push({ url, headers: opts?.headers || {}, body });
      return response(200, { ok: true, awarded: 10 });
    }, {
      store,
      Date: fakeDate,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => currentToken,
          getCurrentUserId: async () => (currentToken ? 'user-A' : null),
        },
      },
    });

    // 1. Signed-in status sets marker
    await XPClient.fetchStatus();
    assert.ok(statusCalls[0].body.anonId);
    assert.ok(store.has('kcswh:xpAnonConvertedFor'), 'marker must be stored');

    // 2. Next signed-in status omits anonId
    await XPClient.fetchStatus();
    assert.equal(statusCalls[1].body.anonId, undefined);

    // 3. Anonymous request
    currentToken = null;
    fakeDate.advance(65_000);
    await XPClient.postWindowServerCalc(semanticWindow(5));
    assert.equal(store.has('kcswh:xpAnonConvertedFor'), false, 'anonymous request must clear conversion marker');

    // 4. User signs in again: next signed-in status sends anonId again
    currentToken = makeJwt('user-A');
    fakeDate.advance(65_000);
    await XPClient.fetchStatus();
    assert.ok(statusCalls[2].body.anonId, 'signed-in status after anonymous play must send anonId again');
  }

  // SC-001: 4. A delayed signed-in response that completes after an anonymous request does not set it
  {
    let resolveSignedIn;
    const signedInHold = new Promise(resolve => { resolveSignedIn = resolve; });
    const store = new Map();
    const jwtA = makeJwt('user-A');

    // Tab 1: signed in
    const tab1Client = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        await signedInHold;
        return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
      }
      return response(200, { ok: true, awarded: 5, totalToday: 5 });
    }, {
      store,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });

    // Tab 2: anonymous
    const tab2Client = await loadClientWithFetch(async (url, opts) => {
      return response(200, { ok: true, awarded: 5, status: 'statusOnly' });
    }, { store });

    // Signed-in status starts and captures act token, but is held in flight
    const signedInPromise = tab1Client.fetchStatus();
    await new Promise(resolve => setTimeout(resolve, 10));

    // Anonymous request runs and settles while signed-in response is pending
    await tab2Client.postWindowServerCalc(semanticWindow(5));

    // Release signed-in response
    resolveSignedIn();
    await signedInPromise;

    // Marker must NOT be set because activity token was bumped during request
    assert.equal(store.has('kcswh:xpAnonConvertedFor'), false, 'delayed signed-in response must not set marker if anon request happened');

    // Next signed-in request still sends anonId
    let secondBody = null;
    const tab1Client2 = await loadClientWithFetch(async (url, opts) => {
      secondBody = JSON.parse(opts?.body || '{}');
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      store,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });
    await tab1Client2.fetchStatus();
    assert.ok(secondBody.anonId, 'subsequent signed-in request must still send anonId');
  }

  // SC-001: 5a. Anonymous award starts before signed-in status and settles after it invalidates marker (single tab)
  {
    let resolveAnonAward;
    const anonHold = new Promise(resolve => { resolveAnonAward = resolve; });
    let currentToken = null;
    const store = new Map();
    const fakeDate = createFakeDate();

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation !== 'status' && !opts?.headers?.Authorization) {
        await anonHold;
        return response(200, { ok: true, awarded: 10 });
      }
      return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
    }, {
      store,
      Date: fakeDate,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => currentToken,
          getCurrentUserId: async () => (currentToken ? 'user-A' : null),
        },
      },
    });

    // 1. Anonymous award starts and is held
    const anonPromise = XPClient.postWindowServerCalc(semanticWindow(10));
    await new Promise(resolve => setTimeout(resolve, 10));

    // 2. User signs in, status runs and completes
    currentToken = makeJwt('user-A');
    fakeDate.advance(65_000);
    await XPClient.fetchStatus();

    // Marker was written at this moment
    assert.ok(store.has('kcswh:xpAnonConvertedFor'), 'status wrote marker');

    // 3. Anonymous award settles
    resolveAnonAward();
    await anonPromise;

    // Settle bumped activity token; next signed-in request must find marker invalid and send anonId
    let nextBody = null;
    const XPClientNext = await loadClientWithFetch(async (url, opts) => {
      nextBody = JSON.parse(opts?.body || '{}');
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      store,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => currentToken,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });
    await XPClientNext.fetchStatus();
    assert.ok(nextBody.anonId, 'must send anonId because anonymous settle invalidated marker');
  }

  // SC-001: 5b. Anonymous award in Tab 2 starts before Tab 1 signed-in status and settles after it (two tabs)
  {
    let resolveAnonAward;
    const anonHold = new Promise(resolve => { resolveAnonAward = resolve; });
    const sharedStore = new Map();

    // Tab 2: anonymous client
    const tab2Client = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation !== 'status') {
        await anonHold;
        return response(200, { ok: true, awarded: 10 });
      }
      return response(200, { ok: true, status: 'statusOnly' });
    }, { store: sharedStore });

    // Tab 1: signed-in client
    const jwtA = makeJwt('user-A');
    const tab1Calls = [];
    const tab1Client = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      tab1Calls.push(body);
      return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
    }, {
      store: sharedStore,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });

    // 1. Tab 2 starts anonymous award (bumps activity at start)
    const tab2AwardPromise = tab2Client.postWindowServerCalc(semanticWindow(10));
    await new Promise(resolve => setTimeout(resolve, 10));

    // 2. Tab 1 runs signed-in status and completes
    await tab1Client.fetchStatus();
    assert.ok(tab1Calls[0].anonId, 'Tab 1 first status sends anonId');
    assert.ok(sharedStore.has('kcswh:xpAnonConvertedFor'), 'Tab 1 wrote marker');

    // 3. Tab 2 anonymous award settles (bumps activity at settle)
    resolveAnonAward();
    await tab2AwardPromise;

    // 4. Tab 1 makes another request: marker is invalid because activity token changed in Tab 2
    await tab1Client.fetchStatus();
    assert.ok(tab1Calls[1].anonId, 'Tab 1 must send anonId again because Tab 2 award settle invalidated marker');
  }

  // SC-001: 6. Two simulated tabs where an anonymous award settles before a delayed signed-in response is handled
  {
    let resolveTab1Status;
    const tab1Hold = new Promise(resolve => { resolveTab1Status = resolve; });
    const sharedStore = new Map();
    const jwtA = makeJwt('user-A');

    // Tab 1: signed in
    const tab1Client = await loadClientWithFetch(async (url, opts) => {
      await tab1Hold;
      return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
    }, {
      store: sharedStore,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });

    // Tab 2: anonymous
    const tab2Client = await loadClientWithFetch(async (url, opts) => {
      return response(200, { ok: true, awarded: 10 });
    }, { store: sharedStore });

    // 1. Tab 1 starts signed-in status (captures initial activity token) and is held
    const tab1Promise = tab1Client.fetchStatus();
    await new Promise(resolve => setTimeout(resolve, 10));

    // 2. Tab 2 starts and settles anonymous award
    await tab2Client.postWindowServerCalc(semanticWindow(10));

    // 3. Tab 1 response resolves
    resolveTab1Status();
    await tab1Promise;

    // Marker must NOT have been written
    assert.equal(sharedStore.has('kcswh:xpAnonConvertedFor'), false, 'no marker written because Tab 2 settled during Tab 1 flight');

    // Tab 1 next call sends anonId
    let nextBody = null;
    const tab1Client2 = await loadClientWithFetch(async (url, opts) => {
      nextBody = JSON.parse(opts?.body || '{}');
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      store: sharedStore,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });
    await tab1Client2.fetchStatus();
    assert.ok(nextBody.anonId, 'Tab 1 sends anonId on subsequent call');
  }

  // SC-001: 7. Both activity writes fail during anonymous activity, and next signed-in request still sends anonId
  {
    const store = new Map();
    let failActivityWrites = false;
    const jwtA = makeJwt('user-A');
    let currentToken = null;
    const calls = [];

    const customLocalStorage = {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => {
        if (failActivityWrites && k === 'kcswh:xpAnonActivity') {
          throw new Error('localStorage write failure');
        }
        store.set(k, String(v));
      },
      removeItem: k => store.delete(k),
    };

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      calls.push(body);
      return response(200, { ok: true, status: 'statusOnly', awarded: 5, anonConversionChecked: true });
    }, {
      window: {
        localStorage: customLocalStorage,
        SupabaseAuthBridge: {
          getAccessToken: async () => currentToken,
          getCurrentUserId: async () => (currentToken ? 'user-A' : null),
        },
      },
    });

    // Make activity writes fail during anonymous activity
    failActivityWrites = true;
    await XPClient.postWindowServerCalc(semanticWindow(5));

    // Now restore storage capability and sign in
    failActivityWrites = false;
    currentToken = jwtA;

    // Next signed-in request in that tab must still send anonId due to tab-local anonStorageFailed
    await XPClient.fetchStatus();
    assert.ok(calls[calls.length - 1].anonId, 'must send anonId after anonymous storage failure');
  }

  // SC-001: 8. A token for another sub sends the id
  {
    const calls = [];
    const store = new Map();
    let currentToken = makeJwt('user-A');
    const fakeDate = createFakeDate();

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      calls.push(body);
      return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
    }, {
      store,
      Date: fakeDate,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => currentToken,
          getCurrentUserId: async () => (currentToken === makeJwt('user-A') ? 'user-A' : 'user-B'),
        },
      },
    });

    // 1. User A status -> sets marker for user-A
    await XPClient.fetchStatus();
    assert.ok(calls[0].anonId);

    // User A next status -> omits anonId
    await XPClient.fetchStatus();
    assert.equal(calls[1].anonId, undefined);

    // 2. Switch to User B token
    currentToken = makeJwt('user-B');
    fakeDate.advance(65_000);
    await XPClient.fetchStatus();
    assert.ok(calls[2].anonId, 'user B status must send anonId despite marker for user A');
  }

  // SC-001: 9. A localStorage failure sends it
  {
    const store = new Map();
    const jwtA = makeJwt('user-A');
    let throwOnGet = false;
    const calls = [];

    const customLocalStorage = {
      getItem: k => {
        if (throwOnGet) throw new Error('SecurityError: storage disabled');
        return store.get(k) ?? null;
      },
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    };

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      calls.push(body);
      return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
    }, {
      window: {
        localStorage: customLocalStorage,
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });

    // First request sets marker
    await XPClient.fetchStatus();
    assert.ok(calls[0].anonId);

    // Now localStorage fails on read
    throwOnGet = true;
    await XPClient.fetchStatus();
    assert.ok(calls[1].anonId, 'must send anonId when localStorage throws');
  }

  // SC-001: 10. Concurrent status calls share one request only with an identical Authorization and body
  {
    const calls = [];
    const jwtA = makeJwt('user-A');
    let resolveBatch;
    const batchPromise = new Promise(resolve => { resolveBatch = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        calls.push({ url, headers: opts?.headers || {}, body });
        await batchPromise;
        return response(200, { ok: true, status: 'statusOnly', totalLifetime: 200, anonConversionChecked: true });
      }
      return response(200, { ok: true });
    }, {
      store: new Map([
        ['kcswh:xpAnonConvertedFor', JSON.stringify({ sub: 'user-A', act: 'act-fixed' })],
        ['kcswh:xpAnonActivity', 'act-fixed'],
      ]),
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => jwtA,
          getCurrentUserId: async () => 'user-A',
        },
      },
    });

    const p1 = XPClient.fetchStatus();
    const p2 = XPClient.fetchStatus();
    const p3 = XPClient.fetchStatus();

    resolveBatch();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.equal(calls.length, 1, '3 concurrent status calls sharing identical auth and body must share 1 request');
    assert.equal(calls[0].body.anonId, undefined, 'body must omit anonId');
    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
  }

  console.log('xp-client contract tests passed');
  console.log('xp-client SC-001 contract tests passed');
})();
