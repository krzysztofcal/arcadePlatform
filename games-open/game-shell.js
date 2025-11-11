(function () {
  function nudge() {
    if (window.XP && typeof window.XP.nudge === "function") {
      try { window.XP.nudge(); } catch (_) { /* noop */ }
    }
  }

  function start(slug) {
    if (!window.XP) return;
    try { window.XP.stopSession({ flush: true }); } catch (_) { /* noop */ }
    if (typeof window.XP.startSession === "function") {
      try { window.XP.startSession(slug); } catch (_) { /* noop */ }
    }
  }

  function init() {
    if (typeof document === "undefined") return;
    const slug = document.body?.dataset?.gameSlug || document.body?.dataset?.gameId || "game";
    try {
      if (slug) window.__GAME_ID__ = slug;
    } catch (_) {}
    start(slug);

    const passive = { passive: true };
    window.addEventListener("keydown", nudge, passive);
    window.addEventListener("pointerdown", nudge, passive);
    window.addEventListener("touchstart", nudge, passive);

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

