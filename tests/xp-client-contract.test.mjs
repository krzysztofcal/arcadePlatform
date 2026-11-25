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
    navigator: options.navigator || (typeof navigator !== 'undefined' ? navigator : undefined),
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
    Blob: options.Blob || (typeof Blob !== 'undefined' ? Blob : undefined),
    navigator: options.navigator || mergedWindow.navigator || (typeof navigator !== 'undefined' ? navigator : undefined),
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

  // SC-001 helpers
  const makeJwt = (sub) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  };

  function createFakeDate(t = 1_000_000) {
    let now = t;
    const d = function(...args) { return new Date(...args); };
    d.now = () => now; d.advance = (ms) => { now += ms; };
    Object.setPrototypeOf(d, Date);
    return d;
  }

  function assertBodyHasAnonId(call, expected = true, msg) {
    const b = call?.body || call || {};
    assert.equal(Boolean(b.anonId || b.userId), expected, msg || (expected ? 'expected anon id' : 'expected no anon id'));
  }

  function createSharedStorage(initialEntries = []) {
    const store = new Map(initialEntries);
    let throwGet = false, throwSetKey = null;
    return {
      store,
      get throwGet() { return throwGet; }, set throwGet(v) { throwGet = v; },
      get throwSetKey() { return throwSetKey; }, set throwSetKey(v) { throwSetKey = v; },
      getItem: (k) => { if (throwGet) throw new Error('storage read error'); return store.get(k) ?? null; },
      setItem: (k, v) => { if (throwSetKey && (throwSetKey === true || throwSetKey === k)) throw new Error('storage write error'); store.set(k, String(v)); },
      removeItem: (k) => store.delete(k),
    };
  }

  function createRecorder(handler) {
    const calls = [];
    const fn = async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      const entry = { url, headers: opts?.headers || {}, body, opts };
      calls.push(entry);
      if (handler) return handler(entry, calls.length);
      const isStatus = body.operation === 'status';
      return response(200, isStatus
        ? { ok: true, status: 'statusOnly', totalLifetime: 100, anonConversionChecked: true }
        : { ok: true, awarded: 10, totalToday: 10, sessionTotal: 10, cap: 400, capDelta: 240, anonConversionChecked: true });
    };
    return { calls, fn };
  }

  function authOpts(sub, extra = {}) {
    const storage = extra.storage || (extra.store ? { store: extra.store } : null);
    return {
      ...(extra.store ? { store: extra.store } : {}),
      ...(extra.Date ? { Date: extra.Date } : {}),
      ...(extra.navigator ? { navigator: extra.navigator } : {}),
      window: {
        ...(storage ? { localStorage: storage } : {}),
        ...(extra.navigator ? { navigator: extra.navigator } : {}),
        ...(extra.window || {}),
        SupabaseAuthBridge: sub ? {
          getAccessToken: async () => (typeof sub === 'function' ? sub() : (sub ? makeJwt(sub) : null)),
          getCurrentUserId: async () => (typeof sub === 'function' ? (sub() ? 'user-A' : null) : sub),
        } : undefined,
      },
    };
  }

  // SC-001: 1. The first signed-in status sends anonId; after a 200 with anonConversionChecked, next status and award omit it
  {
    const rec = createRecorder();
    const XPClient = await loadClientWithFetch(rec.fn, authOpts('user-A'));
    await XPClient.fetchStatus();
    assertBodyHasAnonId(rec.calls[0], true, 'first signed-in status sends anonId');
    await XPClient.fetchStatus();
    assertBodyHasAnonId(rec.calls[1], false, 'second status omits anonId');
    await XPClient.postWindowServerCalc(semanticWindow(10));
    assertBodyHasAnonId(rec.calls[2], false, 'subsequent award omits userId');
  }

  // SC-001: 2. A 200 without the field, another 2xx, a non-2xx, a body parse error or a throw does not set the marker
  {
    const cases = [
      ['200 without flag', () => response(200, { ok: true, status: 'statusOnly' }), false],
      ['201 created', () => response(201, { ok: true, anonConversionChecked: true }), false],
      ['500 error', (c, n) => n === 1 ? response(500, { error: 'err' }) : response(200, { ok: true }), /500/],
      ['parse error', (c, n) => n === 1 ? { status: 200, ok: true, async text() { return '{ bad json'; } } : response(200, { ok: true }), SyntaxError],
      ['throw', (c, n) => { if (n === 1) throw new Error('network failure'); return response(200, { ok: true }); }, /network failure/],
    ];
    for (const [name, fn, reject] of cases) {
      const rec = createRecorder(fn);
      const client = await loadClientWithFetch(rec.fn, authOpts('user-A'));
      if (reject) await assert.rejects(() => client.fetchStatus(), reject);
      else await client.fetchStatus();
      await client.fetchStatus();
      assertBodyHasAnonId(rec.calls[rec.calls.length - 1], true, `call 2 sends anonId after ${name}`);
    }
  }

  // SC-001: 3. An anonymous request clears the marker
  {
    let currentToken = makeJwt('user-A');
    const storage = createSharedStorage(), fakeDate = createFakeDate(), rec = createRecorder();
    const XPClient = await loadClientWithFetch(rec.fn, authOpts(() => currentToken, { store: storage.store, storage, Date: fakeDate }));
    await XPClient.fetchStatus();
    assertBodyHasAnonId(rec.calls[0], true);
    assert.ok(storage.store.has('kcswh:xpAnonConvertedFor'));
    await XPClient.fetchStatus();
    assertBodyHasAnonId(rec.calls[1], false);
    currentToken = null;
    fakeDate.advance(65_000);
    await XPClient.postWindowServerCalc(semanticWindow(5));
    assert.equal(storage.store.has('kcswh:xpAnonConvertedFor'), false, 'anonymous request must clear marker');
    currentToken = makeJwt('user-A');
    fakeDate.advance(65_000);
    await XPClient.fetchStatus();
    assertBodyHasAnonId(rec.calls[rec.calls.length - 1], true, 'signed-in status sends anonId again');
  }

  // SC-001: 3b. An anonymous status read (cannot add anonymous XP) keeps the marker
  {
    let currentToken = makeJwt('user-A');
    const storage = createSharedStorage(), fakeDate = createFakeDate(), rec = createRecorder();
    const XPClient = await loadClientWithFetch(rec.fn, authOpts(() => currentToken, { store: storage.store, storage, Date: fakeDate }));
    await XPClient.fetchStatus();
    assert.ok(storage.store.has('kcswh:xpAnonConvertedFor'));
    currentToken = null;
    fakeDate.advance(65_000);
    await XPClient.fetchStatus();
    currentToken = makeJwt('user-A');
    fakeDate.advance(65_000);
    await XPClient.fetchStatus();
    assertBodyHasAnonId(rec.calls[rec.calls.length - 1], false, 'marker survives an anonymous status read');
  }

  // SC-001: 4. A delayed signed-in response that completes after an anonymous request does not set it
  {
    let resolveSignedIn;
    const signedInHold = new Promise(r => { resolveSignedIn = r; });
    const storage = createSharedStorage();
    const tab1Rec = createRecorder(async (c) => {
      if (c.body.operation === 'status') { await signedInHold; return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true }); }
      return response(200, { ok: true });
    });
    const tab2Rec = createRecorder();
    const tab1 = await loadClientWithFetch(tab1Rec.fn, authOpts('user-A', { store: storage.store, storage }));
    const tab2 = await loadClientWithFetch(tab2Rec.fn, { store: storage.store, window: { localStorage: storage } });
    const p1 = tab1.fetchStatus();
    await new Promise(r => setTimeout(r, 10));
    await tab2.postWindowServerCalc(semanticWindow(5));
    resolveSignedIn();
    await p1;
    assert.equal(storage.store.has('kcswh:xpAnonConvertedFor'), false, 'delayed response must not set marker');
    const tab1Next = await loadClientWithFetch(tab1Rec.fn, authOpts('user-A', { store: storage.store, storage }));
    await tab1Next.fetchStatus();
    assertBodyHasAnonId(tab1Rec.calls[tab1Rec.calls.length - 1], true);
  }

  // SC-001: 5a. Anonymous award starts before signed-in status and settles after it (single tab)
  {
    let resolveAnon;
    const anonHold = new Promise(r => { resolveAnon = r; });
    let currentToken = null;
    const storage = createSharedStorage(), fakeDate = createFakeDate();
    const rec = createRecorder(async (c) => {
      if (c.body.operation !== 'status' && !c.headers?.Authorization) { await anonHold; return response(200, { ok: true, awarded: 10 }); }
      return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
    });
    const XPClient = await loadClientWithFetch(rec.fn, authOpts(() => currentToken, { store: storage.store, storage, Date: fakeDate }));
    const pAnon = XPClient.postWindowServerCalc(semanticWindow(10));
    await new Promise(r => setTimeout(r, 10));
    currentToken = makeJwt('user-A');
    fakeDate.advance(65_000);
    await XPClient.fetchStatus();
    assert.ok(storage.store.has('kcswh:xpAnonConvertedFor'));
    resolveAnon();
    await pAnon;
    const XPClientNext = await loadClientWithFetch(rec.fn, authOpts('user-A', { store: storage.store, storage }));
    await XPClientNext.fetchStatus();
    assertBodyHasAnonId(rec.calls[rec.calls.length - 1], true);
  }

  // SC-001: 5b. Anonymous award in Tab 2 starts before Tab 1 signed-in status and settles after it (two tabs)
  {
    let resolveAnon;
    const anonHold = new Promise(r => { resolveAnon = r; });
    const storage = createSharedStorage();
    const tab2Rec = createRecorder(async (c) => {
      if (c.body.operation !== 'status') { await anonHold; return response(200, { ok: true, awarded: 10 }); }
      return response(200, { ok: true, status: 'statusOnly' });
    });
    const tab1Rec = createRecorder();
    const tab2 = await loadClientWithFetch(tab2Rec.fn, { store: storage.store, window: { localStorage: storage } });
    const tab1 = await loadClientWithFetch(tab1Rec.fn, authOpts('user-A', { store: storage.store, storage }));
    const pAnon = tab2.postWindowServerCalc(semanticWindow(10));
    await new Promise(r => setTimeout(r, 10));
    await tab1.fetchStatus();
    assertBodyHasAnonId(tab1Rec.calls[0], true);
    assert.equal(storage.store.has('kcswh:xpAnonConvertedFor'), false, 'pending anonymous award blocks the marker');
    resolveAnon();
    await pAnon;
    await tab1.fetchStatus();
    assertBodyHasAnonId(tab1Rec.calls[1], true);
  }

  // SC-001: 6. Two simulated tabs where an anonymous award settles before a delayed signed-in response is handled
  {
    let resolveTab1;
    const tab1Hold = new Promise(r => { resolveTab1 = r; });
    const storage = createSharedStorage();
    const tab1Rec = createRecorder(async () => { await tab1Hold; return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true }); });
    const tab2Rec = createRecorder();
    const tab1 = await loadClientWithFetch(tab1Rec.fn, authOpts('user-A', { store: storage.store, storage }));
    const tab2 = await loadClientWithFetch(tab2Rec.fn, { store: storage.store, window: { localStorage: storage } });
    const p1 = tab1.fetchStatus();
    await new Promise(r => setTimeout(r, 10));
    await tab2.postWindowServerCalc(semanticWindow(10));
    resolveTab1();
    await p1;
    assert.equal(storage.store.has('kcswh:xpAnonConvertedFor'), false);
    const tab1Next = await loadClientWithFetch(tab1Rec.fn, authOpts('user-A', { store: storage.store, storage }));
    await tab1Next.fetchStatus();
    assertBodyHasAnonId(tab1Rec.calls[tab1Rec.calls.length - 1], true);
  }

  // SC-001: 7. Both activity writes fail during anonymous activity, and next signed-in request still sends anonId
  {
    const storage = createSharedStorage();
    let currentToken = null;
    const rec = createRecorder();
    const client = await loadClientWithFetch(rec.fn, authOpts(() => currentToken, { store: storage.store, storage }));
    storage.throwSetKey = 'kcswh:xpAnonActivity';
    await client.postWindowServerCalc(semanticWindow(5));
    storage.throwSetKey = null;
    currentToken = makeJwt('user-A');
    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[rec.calls.length - 1], true);
  }

  // SC-001: 8. A token for another sub sends the id
  {
    let currentToken = makeJwt('user-A');
    const fakeDate = createFakeDate(), rec = createRecorder();
    const client = await loadClientWithFetch(rec.fn, authOpts(() => currentToken, { Date: fakeDate }));
    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[0], true);
    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[1], false);
    currentToken = makeJwt('user-B');
    fakeDate.advance(65_000);
    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[2], true);
  }

  // SC-001: 9. A localStorage failure sends it
  {
    const storage = createSharedStorage(), rec = createRecorder();
    const client = await loadClientWithFetch(rec.fn, authOpts('user-A', { store: storage.store, storage }));
    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[0], true);
    storage.throwGet = true;
    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[1], true);
  }

  // SC-001: 10. Concurrent status calls share one request only with an identical Authorization and body
  {
    let resolveBatch;
    const batchPromise = new Promise(r => { resolveBatch = r; });
    const rec = createRecorder(async (c) => {
      if (c.body.operation === 'status') {
        await batchPromise;
        return response(200, { ok: true, status: 'statusOnly', totalLifetime: 200, anonConversionChecked: true });
      }
      return response(200, { ok: true });
    });
    const storage = createSharedStorage([
      ['kcswh:xpAnonConvertedFor', JSON.stringify({ sub: 'user-A', act: 'act-fixed' })],
      ['kcswh:xpAnonActivity', 'act-fixed'],
    ]);
    const client = await loadClientWithFetch(rec.fn, authOpts('user-A', { store: storage.store, storage }));
    const [p1, p2, p3] = [client.fetchStatus(), client.fetchStatus(), client.fetchStatus()];
    resolveBatch();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.equal(rec.calls.length, 1);
    assertBodyHasAnonId(rec.calls[0], false);
    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
  }

  // SC-001: 11. Beacon fallback: signed-in user with valid marker whose keepalive fetch throws falls back to beacon
  {
    const storage = createSharedStorage([
      ['kcswh:xpAnonConvertedFor', JSON.stringify({ sub: 'user-A', act: 'act-fixed' })],
      ['kcswh:xpAnonActivity', 'act-fixed'],
      ['kcswh:userId', 'anon-browser-id-123'],
    ]);
    const beaconCalls = [];
    const fakeNavigator = {
      sendBeacon: (url, payload) => {
        beaconCalls.push({ url, payload });
        return true;
      },
    };
    const rec = createRecorder(async (c) => {
      if (c.body.operation === 'status') {
        return response(200, { ok: true, status: 'statusOnly', anonConversionChecked: true });
      }
      throw new Error('keepalive network failure');
    });

    const client = await loadClientWithFetch(rec.fn, authOpts('user-A', {
      store: storage.store,
      storage,
      navigator: fakeNavigator,
    }));

    const res = await client.postWindowServerCalc(semanticWindow(5), { keepalive: true, allowBeacon: true });
    assert.equal(res?._transport, 'beacon');
    assert.equal(beaconCalls.length, 1);

    const rawPayload = beaconCalls[0].payload;
    const beaconBody = typeof rawPayload?.text === 'function'
      ? JSON.parse(await rawPayload.text())
      : JSON.parse(String(rawPayload));
    assert.equal(beaconBody.userId, 'anon-browser-id-123', 'beacon payload must include userId');
    assert.equal(storage.store.has('kcswh:xpAnonConvertedFor'), false, 'marker must be removed after beacon send');

    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[rec.calls.length - 1], true, 'subsequent signed-in request must send anonId');
  }

  // SC-001: 12. Pending window for unload sends: keepalive award blocks marker within 15s; after 15s confirmation sets it
  {
    let currentToken = null;
    const storage = createSharedStorage();
    const fakeDate = createFakeDate(1_000_000);
    const rec = createRecorder();
    const client = await loadClientWithFetch(rec.fn, authOpts(() => currentToken, {
      store: storage.store,
      storage,
      Date: fakeDate,
    }));

    // 1. Anonymous keepalive award sets pending until now + 15000
    await client.postWindowServerCalc(semanticWindow(5), { keepalive: true });
    assert.equal(storage.store.get('kcswh:xpAnonPendingUntil'), '1015000');

    // 2. User signs in; confirmation within 15s (t = 1005000) writes NO marker
    currentToken = makeJwt('user-A');
    fakeDate.advance(5_000);
    await client.fetchStatus();
    assert.equal(storage.store.has('kcswh:xpAnonConvertedFor'), false, 'no marker within 15s of keepalive award');

    // 3. Confirmation after 15s (advance to t = 1016000) DOES write marker
    fakeDate.advance(11_000);
    await client.fetchStatus();
    assert.equal(storage.store.has('kcswh:xpAnonConvertedFor'), true, 'marker written after 15s elapsed');

    // 4. Subsequent request omits anonId
    await client.fetchStatus();
    assertBodyHasAnonId(rec.calls[rec.calls.length - 1], false, 'subsequent request omits anonId');
  }

  console.log('xp-client contract tests passed');
  console.log('xp-client SC-001 contract tests passed');
})();
