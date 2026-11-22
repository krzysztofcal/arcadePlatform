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
  const ctx = {
    window: Object.assign(baseWindow, options.window || {}),
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
        UserUiState: {
          markSliceApplied(_uid, _slice, appliedState) { markedState = appliedState; },
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
    assert.equal(result, null, 'refreshBadgeFromServer returns null on stale_identity');
    assert.equal(markedState, null, 'no error or stale state marked on stale_identity');
  }

  console.log('xp-client contract tests passed');
})();
