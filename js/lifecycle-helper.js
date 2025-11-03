// js/lifecycle-helper.js
(function () {
  if (typeof window === "undefined") return;
  if (window.__lifecycleWired) return;
  window.__lifecycleWired = true;
  if (!window.__lifecycleLogged) { window.__lifecycleLogged = true; console.info('[xp] lifecycle wired'); }

  let running = false;
  let retryTimer = null;

  function tryCall(fnName, arg) {
    try {
      const XP = window.XP;
      if (!XP || typeof XP[fnName] !== "function") return false;
      XP[fnName](arg);
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  // small, bounded retry to allow XP to initialize after defer scripts
  function retryResume(attempt = 0) {
    clearRetry();
    const ok = tryCall("resumeSession");
    if (ok) return;
    if (attempt >= 3) return; // give up after 3 short retries
    retryTimer = setTimeout(() => retryResume(attempt + 1), 150 * (attempt + 1));
  }

  function resume() {
    if (running) return;
    // prefer resumeSession; if missing, nudge (polyfilled on your side anyway)
    const ok = tryCall("resumeSession") || tryCall("nudge");
    if (ok) running = true;
    else retryResume(0);
  }

  function pause() {
    if (!running) return;
    const ok = tryCall("stopSession", { flush: true });
    // Even if stop throws/returns false, assume we're paused to avoid thrash
    running = false;
    clearRetry();
  }

  // Wire events (passive where applicable)
  window.addEventListener(
    "pagehide",
    (e) => {
      // Do NOT stop when going to BFCache
      if (e && e.persisted) return;
      pause();
    },
    { passive: true }
  );

  window.addEventListener(
    "pageshow",
    () => {
      // Restored from BFCache or normal show -> resume
      resume();
    },
    { passive: true }
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "visible") resume();
      else pause();
    },
    { passive: true }
  );

  // Best effort initial align after load
  // (defer scripts may make XP available slightly later)
  if (document.visibilityState === "visible") {
    setTimeout(resume, 0);
  }
})();
