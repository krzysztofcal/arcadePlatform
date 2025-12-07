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
  const baseWindow = { localStorage: {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  } };
  const ctx = {
    window: Object.assign(baseWindow, options.window || {}),
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

  // refreshBadgeFromServer applies status payload and bump meta
  {
    let applied = null;
    const calls = [];
    const XPClient = await loadClientWithFetch(async (_url, opts) => {
      calls.push(JSON.parse(opts?.body || '{}'));
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
    assert.equal(calls[0].statusOnly, true);
    assert.equal(applied.payload.totalLifetime, 777);
    assert.equal(applied.meta.bump, true);
  }

  console.log('xp-client contract tests passed');
})();
