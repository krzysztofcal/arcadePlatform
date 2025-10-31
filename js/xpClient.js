// Minimal client for the Netlify XP function.
// Exposes window.XPClient.postWindow({ gameId, windowStart, windowEnd, visibilitySeconds, inputEvents })
(function () {
  const FN_URL = "/.netlify/functions/award-xp";

  function ids() {
    try {
      const ls = localStorage;
      let userId = ls.getItem("kcswh:userId");
      let sessionId = ls.getItem("kcswh:sessionId");
      if (!userId) { userId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)); ls.setItem("kcswh:userId", userId); }
      if (!sessionId) { sessionId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)); ls.setItem("kcswh:sessionId", sessionId); }
      return { userId, sessionId };
    } catch {
      return { userId: "anon", sessionId: "s_"+Date.now() };
    }
  }

  async function postWindow({ gameId, windowStart, windowEnd, visibilitySeconds, inputEvents }) {
    const { userId, sessionId } = ids();
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, gameId, sessionId, windowStart, windowEnd, visibilitySeconds, inputEvents }),
      credentials: "omit",
      cache: "no-store",
    });
    return res.json();
  }

  window.XPClient = { postWindow };
})();
