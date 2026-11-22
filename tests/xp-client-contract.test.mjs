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
  const baseWindow = {
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    atob: (str) => Buffer.from(str, 'base64').toString('utf-8'),
  };
  const win = Object.defineProperties(
    baseWindow,
    Object.getOwnPropertyDescriptors(options.window || {})
  );
  const ctx = {
    window: win,
    fetch: fetchImpl,
    crypto: { randomUUID: () => `uuid-test-${++randomId}` },
    Date: options.Date || Date, setTimeout, clearTimeout, console,
    atob: (str) => Buffer.from(str, 'base64').toString('utf-8'),
    Buffer,
  };
  ctx.window.fetch = fetchImpl;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'xpClient.js' });
  return ctx.window.XPClient;
}

// #1313: an awaited promise that never settles must not exit 0 as a silent pass.
let contractCompleted = false;
process.on('exit', (code) => {
  if (code === 0 && !contractCompleted) {
    console.error('xp-client contract tests did not complete');
    process.exitCode = 1;
  }
});

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

  // N concurrent fetchStatus share 1 network fetch
  {
    let fetchCalls = 0;
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        await hold;
        return response(200, { ok: true, status: 'statusOnly', totalLifetime: 100 });
      }
      return response(200, { ok: true });
    });

    const calls = [
      XPClient.fetchStatus(),
      XPClient.fetchStatus(),
      XPClient.fetchStatus(),
      XPClient.fetchStatus(),
    ];
    release();
    const results = await Promise.all(calls);
    assert.equal(fetchCalls, 1, 'concurrent fetchStatus calls must share one network fetch');
    assert.equal(results.length, 4);
    assert.equal(results[0].totalLifetime, 100);
    assert.equal(results[1], results[0]);
  }

  // (a) While response 1 is pending, changing auth subject only starts a second POST before release
  {
    let fetchCalls = 0;
    let release1, release2;
    const hold1 = new Promise(resolve => { release1 = resolve; });
    const hold2 = new Promise(resolve => { release2 = resolve; });
    let token = null;

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          await hold1;
        } else {
          await hold2;
        }
        return response(200, { ok: true, status: 'statusOnly' });
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => token,
          getCurrentUserId: async () => (token ? 'user-1' : null),
        },
      },
    });

    const call1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1, 'first status POST must be in flight');

    // Change auth subject only (sign in with valid token) without bumping generation or rotating sessionId
    token = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url') + '.s';
    const call2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 1; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 2, 'second status POST must start before first response is released when auth subject changes');

    release1();
    release2();
    await Promise.all([call1.catch(() => {}), call2]);
  }

  // (b) While response 1 is pending, changing award sessionId only starts a second POST before release
  {
    let fetchCalls = 0;
    let release1, release2;
    const hold1 = new Promise(resolve => { release1 = resolve; });
    const hold2 = new Promise(resolve => { release2 = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          await hold1;
        } else {
          await hold2;
        }
        return response(200, { ok: true, status: 'statusOnly' });
      }
      return response(200, { ok: true });
    });

    const call1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1, 'first status POST must be in flight');

    // Change award sessionId only without bumping generation or changing auth subject
    XPClient.rotateAwardSession();
    const call2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 1; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 2, 'second status POST must start before first response is released when award sessionId changes');

    release1();
    release2();
    await Promise.all([call1.catch(() => {}), call2]);
  }

  // (c) While response 1 is pending, bumping generation only starts a second POST before release
  {
    let fetchCalls = 0;
    let release1, release2;
    const hold1 = new Promise(resolve => { release1 = resolve; });
    const hold2 = new Promise(resolve => { release2 = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          await hold1;
        } else {
          await hold2;
        }
        return response(200, { ok: true, status: 'statusOnly' });
      }
      return response(200, { ok: true });
    });

    const call1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1, 'first status POST must be in flight');

    // Bump generation only
    XPClient.clearServerSession();
    const call2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 1; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 2, 'second status POST must start before first response is released when generation bumps');

    release1();
    release2();
    await assert.rejects(call1, (err) => {
      assert.equal(err.code, 'stale_identity');
      return true;
    });
    await call2;
  }

  // F1: An old request returning 401 after generation change rejects with stale_identity, not the HTTP error
  {
    let fetchCalls = 0;
    let release;
    const hold = new Promise(resolve => { release = resolve; });

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        await hold;
        return response(401, { error: 'unauthorized', message: 'Token expired' });
      }
      return response(200, { ok: true });
    });

    const call1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1);

    XPClient.clearServerSession();
    release();

    await assert.rejects(call1, (err) => {
      assert.equal(err.code, 'stale_identity', 'must reject with stale_identity, not 401 HTTP error');
      return true;
    });
  }

  // F2: Caller awaiting token / identity across generation change does not overwrite newer entry; 3rd call joins newer request
  {
    let fetchCalls = 0;
    let releaseFetch2;
    const holdFetch2 = new Promise(resolve => { releaseFetch2 = resolve; });
    let releaseUser1;
    const holdUser1 = new Promise(resolve => { releaseUser1 = resolve; });
    let userCalls = 0;

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        await holdFetch2;
        return response(200, { ok: true, status: 'statusOnly' });
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => null,
          getCurrentUserId: async () => {
            userCalls += 1;
            if (userCalls === 1) {
              await holdUser1;
              return 'user-1';
            }
            return null;
          },
        },
      },
    });

    // Call 1 begins at generation 0 and pauses while awaiting identity before in-flight entry creation
    const call1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && userCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(userCalls, 1, 'call 1 must be awaiting identity check');
    assert.equal(fetchCalls, 0);

    // Generation advances to 1
    XPClient.clearServerSession();

    // Call 2 begins at generation 1, finishes auth checks immediately, starts fetch (held on holdFetch2)
    const call2 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1, 'call 2 must start fetch for generation 1');

    // Call 1 resumes after generation change: it must reject with stale_identity and NOT overwrite inFlightEntry
    releaseUser1();
    await assert.rejects(call1, (err) => {
      assert.equal(err.code, 'stale_identity');
      return true;
    });

    // Call 3 begins at generation 1: since Call 1 did not overwrite Call 2's inFlight entry, Call 3 joins Call 2
    const call3 = XPClient.fetchStatus();
    for (let i = 0; i < 20; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1, 'call 3 must join call 2 in-flight request (POST count remains 1)');

    releaseFetch2();
    await Promise.all([call2, call3]);
  }

  // Older answer resolving after generation change rejects with stale_identity and does not apply cap
  {
    let fetchCalls = 0;
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let globalCap = 300;
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        await hold;
        return response(200, { ok: true, status: 'statusOnly', capDelta: 999 });
      }
      return response(200, { ok: true });
    }, {
      window: {
        get XP_DELTA_CAP_CLIENT() { return globalCap; },
        set XP_DELTA_CAP_CLIENT(v) { globalCap = v; },
      },
    });

    const pending = XPClient.fetchStatus();
    for (let i = 0; i < 20 && fetchCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1);
    XPClient.clearServerSession();
    release();
    await assert.rejects(pending, (err) => {
      assert.equal(err.code, 'stale_identity');
      return true;
    });
    assert.equal(globalCap, 300, 'cap must remain unchanged after stale_identity');

    // Positive control: a current, non-stale answer DOES change the cap
    const normalRes = await XPClient.fetchStatus();
    assert.equal(normalRes.capDelta, 999);
    assert.equal(globalCap, 999, 'cap must be updated by non-stale answer');
  }

  // R2-F1: Late-resolving token read across auth change does not overwrite newer cached token
  {
    let releaseTokenA;
    const holdTokenA = new Promise(resolve => { releaseTokenA = resolve; });
    let tokenCalls = 0;
    let authChangeCb = null;
    let sentAuthHeader = null;

    const tokenA = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-a' })).toString('base64url') + '.s';
    const tokenB = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-b' })).toString('base64url') + '.s';

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const headers = opts?.headers || {};
      sentAuthHeader = headers.Authorization || null;
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => {
            tokenCalls++;
            if (tokenCalls === 1) {
              await holdTokenA;
              return tokenA;
            }
            return tokenB;
          },
          getCurrentUserId: async () => 'user-test',
        },
        SupabaseAuth: {
          onAuthChange(fn) { authChangeCb = fn; },
          getCurrentUser: async () => ({ id: 'user-test' }),
        },
      },
    });

    // Start token read A (held on holdTokenA)
    const pendingStatusA = XPClient.fetchStatus();
    for (let i = 0; i < 20 && tokenCalls === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(tokenCalls, 1, 'token read A must be pending');

    // Trigger auth change: increments authVersion, clears cached token and authPromise
    authChangeCb('SIGNED_IN');

    // Start token read B, which resolves immediately with tokenB
    const statusB = await XPClient.fetchStatus();
    assert.ok(statusB);
    assert.equal(sentAuthHeader, `Bearer ${tokenB}`, 'status B must send token B');

    // Now release token read A: it resolves with tokenA, but must NOT overwrite cached token
    releaseTokenA();
    await assert.rejects(pendingStatusA, (err) => {
      assert.equal(err.code, 'stale_identity');
      return true;
    });

    // Next fetchStatus should use cached token B, NOT token A
    sentAuthHeader = null;
    await XPClient.fetchStatus();
    assert.equal(sentAuthHeader, `Bearer ${tokenB}`, 'subsequent status must continue sending token B, not overwritten by late token A');
  }

  // R3/F1: In same authVersion, overlapping forced retries; late read does not overwrite token B, and late error does not null token B
  {
    let releaseA;
    const holdA = new Promise(resolve => { releaseA = resolve; });
    let tokenCalls = 0;
    let sentAuthHeader = null;
    const recordedPosts = [];

    const tokenA = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-a' })).toString('base64url') + '.s';
    const tokenB = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-b' })).toString('base64url') + '.s';

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const headers = opts?.headers || {};
      sentAuthHeader = headers.Authorization || null;
      recordedPosts.push(sentAuthHeader);
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => {
            tokenCalls++;
            if (tokenCalls === 1) return null;
            if (tokenCalls === 2) {
              await holdA;
              return tokenA;
            }
            if (tokenCalls === 3) return tokenB;
            return null;
          },
          getCurrentUserId: async () => 'user-test',
        },
      },
    });

    // Start two concurrent fetchStatus calls; both join read 1 (null), then retry with forced reads
    const call1 = XPClient.fetchStatus();
    const call2 = XPClient.fetchStatus();

    // Call 2 gets token B and finishes first
    const res2 = await call2;
    assert.ok(res2);
    assert.equal(sentAuthHeader, `Bearer ${tokenB}`, 'call 2 must send token B');

    // Then read 2 resolves with token A
    releaseA();
    await assert.rejects(call1, err => err.code === 'stale_identity', 'late caller must reject with stale_identity');
    assert.equal(recordedPosts.some(h => h === `Bearer ${tokenA}`), false, 'no POST with token A must be sent');

    // Subsequent fetchStatus must still send token B, not overwritten by late-resolving token A in same authVersion
    sentAuthHeader = null;
    await XPClient.fetchStatus();
    assert.equal(sentAuthHeader, `Bearer ${tokenB}`, 'subsequent fetchStatus must send token B, not overwritten by late-resolving token A in same authVersion');

    // Error branch test: a late-failing non-owner read must not null B's cached token
    let rejectErr;
    const holdErr = new Promise((_, reject) => { rejectErr = reject; });
    tokenCalls = 0;
    const XPClientErr = await loadClientWithFetch(async (url, opts) => {
      const headers = opts?.headers || {};
      sentAuthHeader = headers.Authorization || null;
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => {
            tokenCalls++;
            if (tokenCalls === 1) return null; // initial read
            if (tokenCalls === 2) return null; // call 1 retry 1
            if (tokenCalls === 3) return null; // call 2 retry 1
            if (tokenCalls === 4) {            // call 1 retry 2 (final retry held)
              await holdErr;
              throw new Error('late_read_failed');
            }
            if (tokenCalls === 5) return tokenB; // call 2 retry 2
            return null;
          },
          getCurrentUserId: async () => 'user-test',
        },
      },
    });

    const pendingCall1 = XPClientErr.fetchStatus();
    const pendingCall2 = XPClientErr.fetchStatus();

    // Call 2 gets token B on retry 2 and resolves
    const errRes2 = await pendingCall2;
    assert.ok(errRes2);
    assert.equal(sentAuthHeader, `Bearer ${tokenB}`);

    // Call 1 retry 2 rejects late: must not null token B
    rejectErr(new Error('fail'));
    await pendingCall1.catch(() => {});

    // Subsequent status must still send token B
    sentAuthHeader = null;
    await XPClientErr.fetchStatus();
    assert.equal(sentAuthHeader, `Bearer ${tokenB}`, 'late-failing read must not null token B');
  }

  // R2-F4: Old bootstrap ending with stale_identity does not clear newer bootstrap's promise
  {
    let release1;
    const hold1 = new Promise(resolve => { release1 = resolve; });
    let release2;
    const hold2 = new Promise(resolve => { release2 = resolve; });
    let fetchCalls = 0;

    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls++;
        if (fetchCalls === 1) {
          await hold1;
          return response(200, { ok: true, status: 'statusOnly' });
        }
        await hold2;
        return response(200, { ok: true, status: 'statusOnly' });
      }
      return response(200, { ok: true });
    });

    // Start bootstrap 1 (generation 0)
    XPClient.ensureStatusBootstrap(false);
    for (let i = 0; i < 20 && fetchCalls === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1, 'bootstrap 1 must start fetch');
    const promise1 = XPClient.getStatusBootstrapPromise();
    assert.ok(promise1, 'bootstrap 1 promise must be active');

    // Advance generation and start bootstrap 2
    XPClient.clearServerSession();
    XPClient.ensureStatusBootstrap(true);
    for (let i = 0; i < 20 && fetchCalls === 1; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 2, 'bootstrap 2 must start fetch');
    const promise2 = XPClient.getStatusBootstrapPromise();
    assert.ok(promise2, 'bootstrap 2 promise must be active');
    assert.notEqual(promise2, promise1, 'bootstrap 2 promise must be different from bootstrap 1');

    // Release bootstrap 1: it will reject with stale_identity and enter finally
    release1();
    await new Promise(resolve => setTimeout(resolve, 10));

    // Bootstrap 2's promise must STILL be active (not cleared by bootstrap 1's finally)
    assert.equal(XPClient.getStatusBootstrapPromise(), promise2, 'bootstrap 2 promise must remain active after bootstrap 1 completes with stale_identity');

    // Release bootstrap 2: now statusPromise clears
    release2();
    await promise2;
    assert.equal(XPClient.getStatusBootstrapPromise(), null, 'bootstrap promise must clear when bootstrap 2 finishes');
  }

  // A call after resolution performs a new fetch (no finished-answer cache)
  {
    let fetchCalls = 0;
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        return response(200, { ok: true, status: 'statusOnly', totalLifetime: fetchCalls * 10 });
      }
      return response(200, { ok: true });
    });

    const res1 = await XPClient.fetchStatus();
    assert.equal(res1.totalLifetime, 10);
    assert.equal(fetchCalls, 1);

    const res2 = await XPClient.fetchStatus();
    assert.equal(res2.totalLifetime, 20);
    assert.equal(fetchCalls, 2, 'second call after resolution must not reuse finished answer');
  }

  // stale_identity in refreshBadgeFromServer is treated as a silent no-op (no error, returns null)
  {
    let fetchCalls = 0;
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let markedState = null;
    let applied = null;
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') {
        fetchCalls += 1;
        await hold;
        return response(200, { ok: true, status: 'statusOnly', totalLifetime: 500 });
      }
      return response(200, { ok: true });
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => 'test-token',
          getCurrentUserId: async () => 'auth-user',
        },
        UserUiState: {
          hydrate: () => ({}),
          markSliceApplied(_uid, _slice, appliedState) { markedState = appliedState; },
        },
        XP: {
          refreshFromServerStatus(payload, meta) { applied = { payload, meta }; },
        },
      },
    });

    const pending = XPClient.refreshBadgeFromServer();
    for (let i = 0; i < 20 && fetchCalls === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fetchCalls, 1);
    XPClient.clearServerSession();
    release();
    const result = await pending;
    // Await async UI update in getAuthenticatedUserId().then()
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(result, null, 'refreshBadgeFromServer returns null on stale_identity');
    assert.equal(markedState, null, 'no error or stale state marked on stale_identity');
    assert.equal(applied, null, 'refreshFromServerStatus must not be called on stale_identity');

    // Positive control: normal error DOES call markSliceApplied with loading/stale
    markedState = null;
    const XPClientErr = await loadClientWithFetch(async () => {
      throw new Error('network_failure');
    }, {
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => 'test-token',
          getCurrentUserId: async () => 'auth-user',
        },
        UserUiState: {
          hydrate: () => ({}),
          markSliceApplied(_uid, _slice, appliedState) { markedState = appliedState; },
        },
      },
    });
    const errRes = await XPClientErr.refreshBadgeFromServer();
    assert.equal(errRes, null);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(markedState, 'loading', 'normal error must call markSliceApplied with loading');

    // Positive control: current, valid payload DOES update the XP state
    let validApplied = null;
    const XPClientValid = await loadClientWithFetch(async () => {
      return response(200, { ok: true, status: 'statusOnly', totalLifetime: 888 });
    }, {
      window: {
        XP: {
          refreshFromServerStatus(payload, meta) { validApplied = { payload, meta }; },
        },
      },
    });
    const validRes = await XPClientValid.refreshBadgeFromServer();
    assert.ok(validRes);
    assert.equal(validApplied?.payload?.totalLifetime, 888, 'valid payload must update XP state');
    assert.equal(validApplied?.meta?.source, 'status');
  }

  // R3/F2: Caller drops status payload if statusGeneration changed after fetchStatus resolved but before caller continuation
  {
    let applied = null;
    let bumpOnResolve = true;

    const XPClient = await loadClientWithFetch(async () => {
      const payload = {
        ok: true,
        status: 'statusOnly',
        totalLifetime: 1234,
        get capDelta() {
          if (bumpOnResolve) {
            queueMicrotask(() => {
              XPClient.clearServerSession();
            });
          }
          return 100;
        },
      };
      return {
        status: 200,
        ok: true,
        async json() { return payload; },
        async text() { return JSON.stringify(payload); },
      };
    }, {
      window: {
        XP: {
          refreshFromServerStatus(payload, meta) { applied = { payload, meta }; },
        },
      },
    });

    const res = await XPClient.refreshBadgeFromServer();
    assert.equal(res, null, 'refreshBadgeFromServer must return null when generation changed before continuation');
    assert.equal(applied, null, 'refreshFromServerStatus must not be called when generation changed before continuation');

    // Positive control: without the generation change, the payload is applied
    bumpOnResolve = false;
    applied = null;
    const posRes = await XPClient.refreshBadgeFromServer();
    assert.ok(posRes);
    assert.equal(applied?.payload?.totalLifetime, 1234, 'positive control: payload must be applied without generation change');
  }

  // R4/F2: rotateAwardSession bumps statusGeneration; caller drops status payload
  {
    let applied = null;
    let bumpOnResolve = true;

    const XPClient = await loadClientWithFetch(async () => {
      const payload = {
        ok: true,
        status: 'statusOnly',
        totalLifetime: 5678,
        get capDelta() {
          if (bumpOnResolve) {
            queueMicrotask(() => {
              XPClient.rotateAwardSession();
            });
          }
          return 100;
        },
      };
      return {
        status: 200,
        ok: true,
        async json() { return payload; },
        async text() { return JSON.stringify(payload); },
      };
    }, {
      window: {
        XP: {
          refreshFromServerStatus(payload, meta) { applied = { payload, meta }; },
        },
      },
    });

    const res = await XPClient.refreshBadgeFromServer();
    assert.equal(res, null, 'refreshBadgeFromServer must return null when rotateAwardSession changed generation before continuation');
    assert.equal(applied, null, 'refreshFromServerStatus must not be called when rotateAwardSession bumped generation');

    // Positive control: without rotateAwardSession, the payload is applied
    bumpOnResolve = false;
    applied = null;
    const posRes = await XPClient.refreshBadgeFromServer();
    assert.ok(posRes);
    assert.equal(applied?.payload?.totalLifetime, 5678, 'positive control: payload applied when rotateAwardSession did not run');
  }

  // R4/F2: token subject change bumps statusGeneration; same subject does not
  {
    let now = 1000000;
    const FakeDate = class extends Date {
      constructor(...args) {
        if (args.length) super(...args);
        else super(now);
      }
      static now() { return now; }
    };

    let currentToken = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-1', ver: 1 })).toString('base64url') + '.s';
    const XPClient = await loadClientWithFetch(async () => {
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      Date: FakeDate,
      window: {
        SupabaseAuthBridge: {
          getAccessToken: async () => currentToken,
          getCurrentUserId: async () => 'user-1',
        },
      },
    });

    await XPClient.fetchStatus();
    const gen1 = XPClient.getStatusGeneration();

    // Advance time past auth cache (AUTH_CACHE_MS is 60_000)
    now += 70_000;
    // Token string changes, but subject stays 'user-1'
    currentToken = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-1', ver: 2 })).toString('base64url') + '.s';
    await XPClient.fetchStatus();
    assert.equal(XPClient.getStatusGeneration(), gen1, 'same subject token change must not bump statusGeneration');

    // Advance time past auth cache again
    now += 70_000;
    // Subject changes to 'user-2'
    currentToken = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-2' })).toString('base64url') + '.s';
    // The call that discovers the identity switch during its own token read belongs to the old key.
    await assert.rejects(XPClient.fetchStatus(), (err) => { assert.equal(err.code, 'stale_identity'); return true; });
    assert.equal(XPClient.getStatusGeneration(), gen1 + 1, 'different subject must bump statusGeneration');
    const afterSwitch = await XPClient.fetchStatus();
    assert.equal(afterSwitch.status, 'statusOnly', 'the next call for the new identity proceeds');
  }

  // Auth change while the token is being read: the call is stale and no POST carries the old token
  {
    const tokenA = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-a' })).toString('base64url') + '.s';
    const tokenB = 'h.' + Buffer.from(JSON.stringify({ sub: 'user-b' })).toString('base64url') + '.s';
    let releaseA;
    const holdA = new Promise(resolve => { releaseA = resolve; });
    let tokenCalls = 0;
    let authHandler = null;
    const postedAuth = [];
    const XPClient = await loadClientWithFetch(async (_url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      if (body.operation === 'status') postedAuth.push((opts?.headers || {}).Authorization || null);
      return response(200, { ok: true, status: 'statusOnly' });
    }, {
      window: {
        SupabaseAuth: { onAuthChange: (fn) => { authHandler = fn; } },
        SupabaseAuthBridge: {
          getAccessToken: async () => {
            tokenCalls += 1;
            if (tokenCalls === 1) { await holdA; return tokenA; }
            return tokenB;
          },
          getCurrentUserId: async () => 'user-b',
        },
      },
    });
    assert.equal(typeof authHandler, 'function', 'XPClient must bind auth changes');

    const call1 = XPClient.fetchStatus();
    for (let i = 0; i < 20 && tokenCalls === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(tokenCalls, 1, 'call 1 must be reading token A');

    authHandler('SIGNED_IN', { id: 'user-b' });
    releaseA();
    await assert.rejects(call1, (err) => { assert.equal(err.code, 'stale_identity'); return true; });
    for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(!postedAuth.includes('Bearer ' + tokenA), 'no status POST may carry the previous identity token');
  }

  contractCompleted = true;
  console.log('xp-client contract tests passed');
})();
