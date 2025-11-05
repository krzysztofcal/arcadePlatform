import { getStore } from '@netlify/blobs';

// 1 Hz acceptance per (user, game); XP ≤ 1 per accepted call
const MIN_GAP_MS = 1000;
const STORE = 'xp-state-v2';

// Default 1:1; override high/low scoring games here
// e.g., 'trex': 0.2 (5 score -> 1 XP), '2048': 0.01 (100 -> 1 XP)
const GAME_RATIOS = {
  // 'tetris': 1,
  // 'trex': 0.2,
  // 'pacman': 0.5,
};

export default async (req) => {
  if (req.method !== 'POST') return res({ error:'method-not-allowed' }, 405);
  const userId = getUserId(req);
  if (!userId) return res({ error:'unauthorized' }, 401);

  let body;
  try { body = await req.json(); }
  catch { return res({ error:'invalid-json' }, 400); }

  const { gameId, mode, score, active } = body || {};
  if (!gameId || !/^[a-z0-9_\-:.]{2,64}$/i.test(gameId))
    return res({ error:'bad-gameId' }, 400);

  const store = getStore({ name: STORE, consistency:'strong' });
  const key = `u:${userId}|g:${gameId}`;
  const now = Date.now();
  const state = (await store.get(key, { type:'json' })) || {
    lastAwardAt: 0,
    bestScore: 0
  };

  // Global 1 Hz cap
  if (now - (state.lastAwardAt || 0) < MIN_GAP_MS) {
    return res({ rejected:'min-gap' });
  }

  let awardedXp = 0;

  if (mode === 'score') {
    // Accept only when score improves
    const s = Number(score || 0);
    if (!Number.isFinite(s) || s < 0) return res({ error:'bad-score' }, 400);
    if (s <= (state.bestScore || 0)) {
      // no progress, but persist best just in case
      state.bestScore = Math.max(state.bestScore || 0, s);
      await store.setJSON(key, state);
      return res({ rejected:'no-progress', bestScore: state.bestScore });
    }
    const ratio = getRatio(gameId);
    const delta = s - (state.bestScore || 0);
    const xpFloat = delta * ratio;
    // Award at most 1 / sec
    awardedXp = Math.max(0, Math.min(1, Math.floor(xpFloat)));
    // Even if xp rounds to 0 (very small ratio), still advance bestScore
    state.bestScore = s;
  } else if (mode === 'time') {
    // Time-based only when actively playing
    if (!active) return res({ rejected:'inactive' });
    awardedXp = 1; // 1 per second at most
  } else {
    return res({ error:'bad-mode' }, 400);
  }

  // Persist timing & bestScore; real XP ledger write would go here as well
  state.lastAwardAt = now;
  await store.setJSON(key, state);

  // TODO: persist awardedXp to your user profile/store if needed
  return res({ ok:true, awardedXp, bestScore: state.bestScore || 0 });
};

function getUserId(req){
  const h = req.headers.get('x-user-id');
  if (h && /^[a-zA-Z0-9:_\-]{8,}$/.test(h)) return h;
  return null;
}

function getRatio(gameId){
  const v = GAME_RATIOS[gameId];
  if (typeof v === 'number' && v >= 0) return v;
  return 1; // default 1:1
}

function res(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type':'application/json' }
  });
}
