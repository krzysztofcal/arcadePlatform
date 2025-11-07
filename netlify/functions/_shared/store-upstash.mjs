// Minimal Upstash REST client (no extra deps).
const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!BASE || !TOKEN) {
  console.warn("[store-upstash] Missing UPSTASH env; falling back to in-memory store.");
}

function createMemoryStore() {
  const memory = new Map();

  function sweep(key) {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiry && entry.expiry <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return entry;
  }

  function getValue(key) {
    const entry = sweep(key);
    return entry ? entry.value : null;
  }

  function setValue(key, value, ttlMs) {
    memory.set(key, {
      value: String(value),
      expiry: typeof ttlMs === "number" ? Date.now() + ttlMs : null,
    });
  }

  function remainingTtlMs(entry) {
    if (!entry || entry.expiry == null) return null;
    return Math.max(0, entry.expiry - Date.now());
  }

  return {
    async get(key) { return getValue(key); },
    async setex(key, seconds, value) { setValue(key, value, seconds * 1000); return "OK"; },
    async incrBy(key, delta) {
      const entry = sweep(key);
      const prev = Number(entry?.value ?? "0");
      const current = prev + Number(delta);
      setValue(key, current, remainingTtlMs(entry));
      return current;
    },
    async decrBy(key, delta) {
      const entry = sweep(key);
      const prev = Number(entry?.value ?? "0");
      const current = prev - Number(delta);
      setValue(key, current, remainingTtlMs(entry));
      return current;
    },
    async expire(key, seconds) {
      const entry = sweep(key);
      if (!entry) return 0;
      setValue(key, entry.value, seconds * 1000);
      return 1;
    },
    async ttl(key) {
      const entry = sweep(key);
      if (!entry) return -2;
      if (entry.expiry == null) return -1;
      const ttl = entry.expiry - Date.now();
      return ttl > 0 ? Math.ceil(ttl / 1000) : -2;
    },
    async eval(_script, keys = [], argv = []) {
      const [dailyKey, lastKey, idemKey, lockKey, totalKey] = keys;
      const now = Number(argv[0]);
      const chunk = Number(argv[1]);
      const step = Number(argv[2]);
      const cap = Number(argv[3]);
      const idemTtl = Number(argv[4]) * 1000;
      const endTs = Number(argv[5]);
      const lastTtl = Number(argv[6]) * 1000;
      const lockTtl = Number(argv[7]);

      const lockEntry = sweep(lockKey);
      if (lockEntry) {
        const current = Number(getValue(dailyKey) ?? "0");
        const lifetime = Number(getValue(totalKey) ?? "0");
        return [0, current, 4, lifetime];
      }
      setValue(lockKey, now, lockTtl);

      const release = () => { memory.delete(lockKey); };

      try {
        if (getValue(idemKey) != null) {
          const current = Number(getValue(dailyKey) ?? "0");
          const lifetime = Number(getValue(totalKey) ?? "0");
          return [0, current, 1, lifetime];
        }

        let current = Number(getValue(dailyKey) ?? "0");
        if (current >= cap) {
          setValue(idemKey, "1", idemTtl);
          const lifetime = Number(getValue(totalKey) ?? "0");
          return [0, current, 2, lifetime];
        }

        const lastOk = Number(getValue(lastKey) ?? "0");
        if ((endTs - lastOk) < chunk) {
          const lifetime = Number(getValue(totalKey) ?? "0");
          return [0, current, 3, lifetime];
        }

        const remaining = cap - current;
        const grant = Math.min(step, remaining);
        const newTotal = current + grant;
        setValue(dailyKey, newTotal, null);
        setValue(lastKey, endTs, lastTtl);
        setValue(idemKey, "1", idemTtl);
        const lifetime = Number(getValue(totalKey) ?? "0") + grant;
        setValue(totalKey, lifetime, null);
        return [grant, newTotal, 0, lifetime];
      } finally {
        release();
      }
    },
  };
}

async function call(cmd, ...args) {
  const url = `${BASE}/${cmd}/${args.map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${cmd} failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

const remoteStore = {
  async get(key) { return call("GET", key); },
  async setex(key, seconds, value) { return call("SETEX", key, String(seconds), String(value)); },
  async incrBy(key, delta) { return call("INCRBY", key, String(delta)); },
  async decrBy(key, delta) { return call("DECRBY", key, String(delta)); },
  async expire(key, seconds) { return call("EXPIRE", key, String(seconds)); },
  async ttl(key) { return call("TTL", key); },
  async eval(script, keys = [], argv = []) {
    const res = await fetch(`${BASE}/eval`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ script, keys, argv }),
    });
    if (!res.ok) throw new Error(`Upstash eval failed: ${res.status}`);
    const data = await res.json();
    return data.result;
  },
};

export const store = (!BASE || !TOKEN) ? createMemoryStore() : remoteStore;
