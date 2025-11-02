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
// Fallback: never leave badge stuck in "loading" if status fetch fails early.
document.addEventListener('DOMContentLoaded', function () {
  try {
    var badge = document.getElementById('xpBadge') || document.querySelector('.xp-badge');
    if (badge) {
      badge.classList.remove('xp-badge--loading');
      badge.setAttribute('aria-busy', 'false');
    }
  } catch (_) {}
});
// --- XP badge hardening: clear "Syncing XP…" reliably ---
(function () {
  var clearedOnce = false;

  function getBadge() {
    return document.getElementById('xpBadge') || document.querySelector('.xp-badge');
  }
  function getLabel(badge) {
    return badge ? badge.querySelector('.xp-badge__label') : null;
  }
  function setBadgeLoading(on) {
    var badge = getBadge();
    if (!badge) return;
    badge.classList.toggle('xp-badge--loading', !!on);
    badge.setAttribute('aria-busy', on ? 'true' : 'false');
    var label = getLabel(badge);
    if (on && label && !label.textContent.trim()) {
      label.textContent = 'Syncing XP…';
    }
  }
  // Make available if your existing code wants to call it
  window.XPUI = window.XPUI || {};
  if (!window.XPUI.setBadgeLoading) window.XPUI.setBadgeLoading = setBadgeLoading;

  // 1) Fallback: clear loading after 3s even if fetch fails (prevents infinite spinner)
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      if (!clearedOnce) { setBadgeLoading(false); }
    }, 3000);
  });

  // 2) Clear loading on first XP heartbeat from the page (resume/start)
  window.addEventListener('xp:tick', function () {
    if (!clearedOnce) { setBadgeLoading(false); clearedOnce = true; }
  });

  // 3) If your code dispatches a status event, clear there too
  window.addEventListener('xp:status', function (e) {
    setBadgeLoading(false);
    clearedOnce = true;
    // Optional: if status payload has text, update label
    try {
      var badge = getBadge(), label = getLabel(badge);
      if (badge && label && e && e.detail && e.detail.text) {
        label.textContent = e.detail.text;
      }
    } catch (_){}
  });

})();
