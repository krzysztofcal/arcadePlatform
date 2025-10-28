(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const doc = document;

  function cleanupFactory(state){
    let cleaned = false;
    return function cleanup(){
      if (cleaned) return;
      cleaned = true;
      if (state.tracker && typeof state.tracker.stop === 'function'){
        try { state.tracker.stop(); } catch (_){ /* noop */ }
        state.tracker = null;
      }
      if (state.service && typeof state.service.endSession === 'function'){
        try { state.service.endSession(); } catch (_){ /* noop */ }
      }
      state.service = null;
    };
  }

  function init(){
    const body = doc.body;
    if (!body) return;
    const slug = body.getAttribute('data-game-slug');
    if (!slug) return;

    const state = { service: null, tracker: null };
    const cleanup = cleanupFactory(state);

    function trySetup(attempt){
      const points = window.Points;
      if (!points || typeof points.getDefaultService !== 'function'){
        if (attempt < 10){
          window.setTimeout(() => trySetup(attempt + 1), 100);
        }
        return;
      }

      let service = null;
      try {
        service = points.getDefaultService();
      } catch (_){ /* noop */ }
      if (!service) return;
      state.service = service;

      try { service.startSession(slug); } catch (_){ /* noop */ }

      if (typeof points.createActivityTracker === 'function'){
        try {
          state.tracker = points.createActivityTracker(doc, ticks => {
            if (!state.service || typeof state.service.tick !== 'function') return;
            try { state.service.tick(ticks); } catch (_){ /* noop */ }
          });
        } catch (_){ state.tracker = null; }
      }

      if (state.tracker && typeof state.tracker.setWatchElement === 'function'){
        const focusTarget = doc.querySelector('[data-track-focus]') || doc.querySelector('.game-shell');
        if (focusTarget){
          try { state.tracker.setWatchElement(focusTarget); } catch (_){ /* noop */ }
        }
      }
    }

    const start = () => trySetup(0);

    if (doc.readyState === 'loading'){
      doc.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }

    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
  }

  init();
})();
