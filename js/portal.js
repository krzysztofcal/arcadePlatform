// Portal bootstrap wiring the PortalApp class to the DOM.
(function(){
  const grid = document.getElementById('gamesGrid');
  if (!grid || !window.PortalApp) return;

  const app = new window.PortalApp({
    grid,
    categoryBar: document.getElementById('categoryBar'),
    analytics: window.Analytics,
    catalog: window.ArcadeCatalog,
    i18n: window.I18N,
    fetchImpl: (url, options) => window.fetch(url, Object.assign({ cache: 'no-cache' }, options)),
    win: window,
    doc: document
  });

  function start(){
    app.init().catch(err => {
      if (window.console && typeof window.console.error === 'function'){
        window.console.error(err);
      }
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
