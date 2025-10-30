import { connectKV } from '../_shared/store-upstash.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const hdr = event.headers || {};
  const apiKey = process.env.XP_SERVICE_API_KEY;
  if (!apiKey || hdr['x-api-key'] !== apiKey) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }
  const { userId, gameId, claimedAt } = payload;
  if (!userId || !gameId || !claimedAt) {
    return { statusCode: 400, body: 'Missing userId/gameId/claimedAt' };
  }
  const now = Date.now();
  if (Math.abs(now - Number(claimedAt)) > 90_000) {
    return { statusCode: 422, body: 'Timestamp out of allowed window' };
  }
  const kv = connectKV();
  const base = `xp:${userId}:${gameId}`;
  const lastKey = `${base}:lastok`;
  const lockKey = `${base}:lock`;
  const totalKey = `xp_total:${userId}`;
  const existing = await kv.get(lockKey);
  if (existing) {
    return { statusCode: 202, body: JSON.stringify({ accepted: true, reason: 'locked' }) };
  }
  await kv.set(lockKey, '1', 5);
  try {
    const lastOk = Number(await kv.get(lastKey) || 0);
    if (now - lastOk < 30_000) {
      return { statusCode: 409, body: 'Too soon' };
    }
    const xpStep = Number(process.env.XP_STEP || '10');
    const newTotal = await kv.incrby(totalKey, xpStep);
    await kv.set(lastKey, now, 24 * 3600);
    return { statusCode: 200, body: JSON.stringify({ ok: true, added: xpStep, total: newTotal }) };
  } finally {
    await kv.set(lockKey, '', 1);
  }
}
