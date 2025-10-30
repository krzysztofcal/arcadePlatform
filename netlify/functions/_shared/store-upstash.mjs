// Shared Upstash Redis KV connector for Netlify Functions
export function connectKV() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  async function doFetch(path, body) {
    const res = await fetch(`${url}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Upstash error ${res.status}: ${t}`);
    }
    return res.json();
  }
  return {
    async get(key) {
      const res = await doFetch('get', { key });
      return res.result ?? null;
    },
    async set(key, value, ttlSeconds) {
      const args = ttlSeconds ? { key, value, ex: ttlSeconds } : { key, value };
      await doFetch('set', args);
    },
    async incrby(key, n) {
      const res = await doFetch('incrby', { key, n });
      return res.result;
    }
  };
}
