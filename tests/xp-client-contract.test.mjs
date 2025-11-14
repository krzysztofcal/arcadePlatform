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

async function loadClientWithFetch(fetchImpl) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const src = await fs.readFile(path.join(__dirname, '..', 'js', 'xpClient.js'), 'utf8');

  const store = new Map();
  const ctx = {
    window: { localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    } },
    fetch: fetchImpl,
    crypto: { randomUUID: () => 'uuid-test' },
    Date, setTimeout, clearTimeout, console,
  };
  ctx.window.fetch = fetchImpl;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'xpClient.js' });
  return ctx.window.XPClient;
}

(async () => {
  // Success path
  {
    const XPClient = await loadClientWithFetch(async (_url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.statusOnly) return response(200, { ok: true, status: 'statusOnly' });
      return response(200, { ok: true, awarded: 10, totalToday: 10, sessionTotal: 10, lastSync: body.ts, cap: 400, capDelta: 240 });
    });
    const res = await XPClient.postWindow({ delta: 10, ts: 111 });
    assert.equal(res.awarded, 10);
  }

  // 422 with delta_out_of_range → throws
  {
    const XPClient = await loadClientWithFetch(async () =>
      response(422, { error: 'delta_out_of_range', capDelta: 123 })
    );
    await assert.rejects(
      () => XPClient.postWindow({ delta: 9999, ts: 222 }),
      /delta_out_of_range/i
    );
  }

  // 500 → throws
  {
    const XPClient = await loadClientWithFetch(async () =>
      response(500, { error: 'server_error' })
    );
    await assert.rejects(
      () => XPClient.postWindow({ delta: 1, ts: 333 }),
      /server_error|status 500/i
    );
  }

  // Network error → throws
  {
    const XPClient = await loadClientWithFetch(async () => {
      throw new Error('fetch failed');
    });
    await assert.rejects(
      () => XPClient.postWindow({ delta: 1, ts: 444 }),
      /fetch failed|XP request failed/i
    );
  }

  // fetchStatus prefers xp-status endpoint
  {
    const requests = [];
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      requests.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.includes('xp-status')) {
        return response(200, {
          cap: 3000,
          totalToday: 123,
          remaining: 2877,
          __serverHasDaily: true,
        });
      }
      return response(200, { ok: true });
    });
    const status = await XPClient.fetchStatus();
    assert.equal(requests.length, 1);
    assert.ok(requests[0].url.includes('xp-status'));
    assert.equal(status.totalToday, 123);
    assert.equal(status.remaining, 2877);
  }

  // fetchStatus falls back to award endpoint on failure
  {
    const requests = [];
    const XPClient = await loadClientWithFetch(async (url, opts) => {
      requests.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.includes('xp-status')) {
        return response(500, { error: 'status_fail' });
      }
      if (url.includes('award-xp')) {
        return response(200, {
          cap: 3000,
          totalToday: 50,
          remaining: 2950,
          __serverHasDaily: true,
        });
      }
      return response(404, { error: 'not_found' });
    });
    const status = await XPClient.fetchStatus();
    assert.equal(requests.length, 2);
    assert.ok(requests[0].url.includes('xp-status'));
    assert.ok(requests[1].url.includes('award-xp'));
    assert.equal(status.totalToday, 50);
    assert.equal(status.remaining, 2950);
  }

  console.log('xp-client contract tests passed');
})();
