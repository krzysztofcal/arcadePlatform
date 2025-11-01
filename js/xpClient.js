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
    const body = Object.assign({}, payload, { userId, sessionId });
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

  window.XPClient = { postWindow };
})();
