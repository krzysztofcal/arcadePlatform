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

  function stop() {
    if (window.XP && typeof window.XP.stopSession === "function") {
      try { window.XP.stopSession({ flush: true }); } catch (_) { /* noop */ }
    }
  }

  function init() {
    if (typeof document === "undefined") return;
    const slug = document.body?.dataset?.gameSlug || document.body?.dataset?.gameId || "game";
    start(slug);

    const passive = { passive: true };
    window.addEventListener("keydown", nudge, passive);
    window.addEventListener("pointerdown", nudge, passive);
    window.addEventListener("touchstart", nudge, passive);

    const handlePageHide = (event) => {
      if (event && event.persisted) return;
      stop();
    };
    window.addEventListener("beforeunload", stop);
    window.addEventListener("pagehide", handlePageHide);

    // ensure XP tick timer stays aligned when tab becomes active
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) nudge();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
