// Portal bootstrap wiring the PortalApp class to the DOM.
(function(){
  const grid = document.getElementById('gamesGrid');
  if (!grid || !window.PortalApp) return;

  const app = new window.PortalApp({
    grid,
    categoryBar: document.getElementById('categoryBar'),
    searchInput: document.getElementById('searchInput'),
    analytics: window.Analytics,
    catalog: window.ArcadeCatalog,
    i18n: window.I18N,
    fetchImpl: (url, options) => window.fetch(url, Object.assign({ cache: 'no-cache' }, options)),
    win: window,
    doc: document
  });

  function start(){
    app.init().catch(err => {
      try {
        if (window.KLog && typeof window.KLog.log === 'function'){
          window.KLog.log('portal:init_error', { message: err && err.message ? String(err.message) : 'error' });
        }
      } catch (_err){}
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
