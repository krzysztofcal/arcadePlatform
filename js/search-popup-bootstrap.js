/**
 * Bootstrap script for initializing search popup on non-main pages
 */
(function(){
  'use strict';

  function initSearchPopup(){
    const searchInput = document.querySelector('.search-box input[type="search"]');
    if (!searchInput || !window.SearchPopup) return;

    // Only initialize on non-main pages (pages without gamesGrid)
    const gamesGrid = document.getElementById('gamesGrid');
    if (gamesGrid) return; // Main page already has inline search

    const popup = new window.SearchPopup({
      searchInput,
      catalog: window.ArcadeCatalog,
      i18n: window.I18N,
      analytics: window.Analytics,
      fetchImpl: (url, options) => window.fetch(url, Object.assign({ cache: 'no-cache' }, options)),
      gamesEndpoint: 'js/games.json',
      win: window,
      doc: document
    });

    popup.init().catch(err => {
      if (window.console && typeof window.console.error === 'function'){
        window.console.error('Failed to initialize search popup:', err);
      }
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initSearchPopup, { once: true });
  } else {
    initSearchPopup();
  }
})();
