(function () {
  const FN_URL = "/.netlify/functions/award-xp";
  const USER_KEY = "kcswh:userId";
  const SESSION_KEY = "kcswh:sessionId";

  function ensureIds() {
    try {
      const ls = window.localStorage;
      let userId = ls.getItem(USER_KEY);
      let sessionId = ls.getItem(SESSION_KEY);
      if (!userId) {
        userId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
        ls.setItem(USER_KEY, userId);
      }
      if (!sessionId) {
        sessionId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
        ls.setItem(SESSION_KEY, sessionId);
      }
      return { userId, sessionId };
    } catch (_) {
      const fallback = Math.random().toString(36).slice(2);
      return { userId: `anon-${fallback}`, sessionId: `sess-${Date.now()}` };
    }
  }

  async function postWindow(payload) {
    const { userId, sessionId } = ensureIds();
    const source = (payload && typeof payload === "object") ? payload : {};
    let delta = 0;
    if (typeof source.delta === "number") {
      delta = source.delta;
    } else if (typeof source.scoreDelta === "number") {
      delta = source.scoreDelta;
    } else if (typeof source.pointsPerPeriod === "number") {
      delta = source.pointsPerPeriod;
    }
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    delta = Math.floor(delta);

    let ts = Number(source.ts);
    if (!Number.isFinite(ts)) ts = Number(source.windowEnd);
    if (!Number.isFinite(ts)) ts = Date.now();

    const metadata = {};
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (key === "delta" || key === "ts") continue;
      metadata[key] = source[key];
    }

    const body = { userId, sessionId, delta, ts };
    if (Object.keys(metadata).length) {
      body.metadata = metadata;
    }
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`XP request failed (${res.status}) ${text}`.trim());
    }
    return res.json();
  }

  async function fetchStatus() {
    const { userId, sessionId } = ensureIds();
    const body = { userId, sessionId, gameId: "status", statusOnly: true };
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`XP status failed (${res.status}) ${text}`.trim());
    }
    return res.json();
  }

  window.XPClient = { postWindow, fetchStatus };
})();
