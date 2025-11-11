(function (window, document) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const DEFAULT_TICK_MS = 1500;

  function asObject(value) {
    return value && typeof value === "object" ? value : {};
  }

  function noop() {}

  function init(options) {
    const bridge = window.GameXpBridge;
    if (!bridge || typeof bridge.isActiveGameWindow !== "function") {
      return { active: false, destroy: noop };
    }
    if (!bridge.isActiveGameWindow()) {
      return { active: false, destroy: noop };
    }

    const opts = asObject(options);
    const interval = Number(opts.intervalMs);
    const tickMs = Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_TICK_MS;
    const onTick = typeof opts.onTick === "function" ? opts.onTick : null;
    const onTearDown = typeof opts.onTearDown === "function" ? opts.onTearDown : null;
    let destroyed = false;
    let timerId = null;

    function teardown() {
      if (destroyed) return;
      destroyed = true;
      if (timerId != null && typeof window.clearInterval === "function") {
        try { window.clearInterval(timerId); } catch (_) {}
      }
      timerId = null;
      if (typeof document.removeEventListener === "function") {
        try { document.removeEventListener("xp:hidden", handleHidden); } catch (_) {}
      }
      if (onTearDown) {
        try { onTearDown(); } catch (_) {}
      }
    }

    function handleHidden() {
      teardown();
    }

    function tick() {
      if (destroyed) return;
      if (!bridge.isActiveGameWindow()) {
        teardown();
        return;
      }
      if (onTick) {
        try { onTick(); } catch (_) {}
      }
    }

    if (typeof document.addEventListener === "function") {
      try { document.addEventListener("xp:hidden", handleHidden, { passive: true }); }
      catch (_) { try { document.addEventListener("xp:hidden", handleHidden); } catch (_) {} }
    }

    if (typeof window.setInterval === "function") {
      try { timerId = window.setInterval(tick, tickMs); } catch (_) { timerId = null; }
    }
    if (timerId == null) {
      tick();
    }

    return {
      active: true,
      destroy: teardown,
      isDestroyed: function () { return destroyed; },
    };
  }

  window.XPOverlay = Object.assign({}, window.XPOverlay || {}, {
    init,
  });
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
