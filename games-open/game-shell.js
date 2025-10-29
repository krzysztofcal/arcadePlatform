(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const doc = document;

  function cleanupFactory(state){
    let cleaned = false;
    return function cleanup(){
      if (cleaned) return;
      cleaned = true;
      const trackerRef = state.tracker;
      if (trackerRef && typeof trackerRef.stop === 'function'){
        try { trackerRef.stop(); } catch (_){ /* noop */ }
      }
      if (typeof window !== 'undefined' && trackerRef && window.activityTracker === trackerRef){
        try { window.activityTracker = null; } catch (_){ /* noop */ }
      }
      state.tracker = null;
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
          const tickSeconds = (service && service.options && service.options.tickSeconds) || 15;
          if (typeof window !== 'undefined' && window.activityTracker && typeof window.activityTracker.stop === 'function'){
            try { window.activityTracker.stop(); } catch (_){ /* noop */ }
          }
          const messageType = 'kcswh:activity';
          const allowedOrigins = [];
          try {
            if (typeof window !== 'undefined' && window.location && window.location.origin){
              allowedOrigins.push(window.location.origin);
            }
          } catch (_){ /* noop */ }
          state.tracker = points.createActivityTracker(doc, seconds => {
            if (!state.service || typeof state.service.tick !== 'function') return;
            const ticks = seconds && tickSeconds ? Math.max(1, Math.round(seconds / tickSeconds)) : 1;
            try { state.service.tick(ticks); } catch (_){ /* noop */ }
          }, { tickSeconds, messageType, allowedOrigins });
          if (typeof window !== 'undefined'){
            try { window.activityTracker = state.tracker; } catch (_){ /* noop */ }
          }
        } catch (_){ state.tracker = null; }
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
