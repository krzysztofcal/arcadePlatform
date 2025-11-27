/**
 * Bootstrap script for initializing search popup on non-main pages
 */
(function(){
  'use strict';

  function initSearchPopup(){
    const searchInput = document.querySelector('.search-box input[type="search"]');

    if (!searchInput) {
      console.debug('Search popup: No search input found');
      return;
    }

    if (!window.SearchPopup) {
      console.error('Search popup: SearchPopup class not available');
      return;
    }

    // Only initialize on non-main pages (pages without gamesGrid)
    const gamesGrid = document.getElementById('gamesGrid');
    if (gamesGrid) {
      console.debug('Search popup: Skipping initialization on main page');
      return; // Main page already has inline search
    }

    console.debug('Search popup: Initializing on non-main page');

    try {
      const popup = new window.SearchPopup({
        searchInput,
        catalog: window.ArcadeCatalog,
        i18n: window.I18N,
        analytics: window.Analytics,
        fetchImpl: (url, options) => window.fetch(url, Object.assign({ cache: 'no-cache' }, options)),
        gamesEndpoint: '/js/games.json',
        win: window,
        doc: document
      });

      popup.init().then(() => {
        console.debug('Search popup: Initialization complete');
      }).catch(err => {
        console.error('Search popup: Failed to initialize:', err);
      });
    } catch (err) {
      console.error('Search popup: Error creating instance:', err);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initSearchPopup, { once: true });
  } else {
    initSearchPopup();
  }
})();
