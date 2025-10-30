<<'EOF'
// Minimal Upstash REST client (no extra deps).
const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!BASE || !TOKEN) {
  // eslint-disable-next-line no-console
  console.warn("[store-upstash] Missing UPSTASH env; functions will fail until set.");
}

// Path-style GET commands for simple ops
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

export const store = {
  async get(key) { return call("GET", key); },
  async setex(key, seconds, value) { return call("SETEX", key, String(seconds), String(value)); },
  async incrBy(key, delta) { return call("INCRBY", key, String(delta)); },
  async ttl(key) { return call("TTL", key); },

  // Atomic Lua script via POST /eval
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
EOF


