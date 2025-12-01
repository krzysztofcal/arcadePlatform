(function(global){
  'use strict';

  /**
   * Recently Played Page - Renders recently played games using PortalApp
   */

  const grid = document.getElementById('gamesGrid');
  const emptyState = document.getElementById('emptyState');
  const searchInput = document.querySelector('.search-box input[type="search"]');

  async function init() {
    if (!grid) {
      console.error('Recently played page: grid element not found');
      return;
    }

    // Wait for dependencies
    if (!global.recentlyPlayed || !global.PortalApp || !global.ArcadeCatalog) {
      console.error('Recently played page: dependencies not loaded');
      showEmptyState();
      return;
    }

    try {
      // Load recently played game IDs
      const recentGames = global.recentlyPlayed.getRecentGames();

      if (!recentGames || recentGames.length === 0) {
        showEmptyState();
        // Still initialize search popup even if no recent games
        initSearchPopup();
        return;
      }

      // Load full game catalog
      const catalog = await loadCatalog();

      if (!catalog || catalog.length === 0) {
        console.error('Failed to load game catalog');
        showEmptyState();
        return;
      }

      // Match recently played games with catalog data
      const recentGameIds = new Set(recentGames.map(g => g.id || g.slug));
      const matchedGames = catalog.filter(game => {
        return recentGameIds.has(game.id) || recentGameIds.has(game.slug);
      });

      // Sort by recently played order
      const gameIdToTimestamp = new Map();
      recentGames.forEach(g => {
        gameIdToTimestamp.set(g.id || g.slug, g.timestamp || 0);
      });

      matchedGames.sort((a, b) => {
        const aTime = gameIdToTimestamp.get(a.id) || gameIdToTimestamp.get(a.slug) || 0;
        const bTime = gameIdToTimestamp.get(b.id) || gameIdToTimestamp.get(b.slug) || 0;
        return bTime - aTime; // Most recent first
      });

      if (matchedGames.length === 0) {
        showEmptyState();
        initSearchPopup();
        return;
      }

      // Use PortalApp to render the games
      // Note: We don't pass searchInput here - the global search popup will handle search
      const app = new global.PortalApp({
        grid: grid,
        categoryBar: null, // No category bar on recently played page
        searchInput: null, // Let global search popup handle search
        analytics: global.Analytics,
        catalog: global.ArcadeCatalog,
        i18n: global.I18N,
        gamesEndpoint: 'js/games.json'
      });

      // Override allGames with our recently played games
      app.allGames = matchedGames;

      // Render the list (don't call setupSearchInput - let search popup handle it)
      app.renderList(matchedGames, 'recently_played', 'Recently Played');

      // Re-render on language change
      document.addEventListener('langchange', () => {
        app.renderList(matchedGames, 'recently_played', 'Recently Played');
      });

      // Hide empty state
      if (emptyState) {
        emptyState.hidden = true;
      }

      // Initialize search popup manually (since bootstrap skips pages with gamesGrid)
      initSearchPopup();

      // Track page view
      if (global.Analytics && typeof global.Analytics.event === 'function') {
        global.Analytics.event('page_view', {
          page_title: 'Recently Played',
          page_location: window.location.href
        });
      }

    } catch (err) {
      console.error('Failed to load recently played page:', err);
      showEmptyState();
    }
  }

  function initSearchPopup() {
    if (!searchInput) {
      console.debug('Recently played: No search input found');
      return;
    }

    if (!global.SearchPopup) {
      console.error('Recently played: SearchPopup class not available');
      return;
    }

    try {
      console.debug('Recently played: Initializing search popup');

      const popup = new global.SearchPopup({
        searchInput: searchInput,
        catalog: global.ArcadeCatalog,
        i18n: global.I18N,
        analytics: global.Analytics,
        fetchImpl: (url, options) => global.fetch(url, Object.assign({ cache: 'no-cache' }, options)),
        gamesEndpoint: '/js/games.json',
        win: global,
        doc: document
      });

      popup.init().then(() => {
        console.debug('Recently played: Search popup initialized successfully');
      }).catch(err => {
        console.error('Recently played: Search popup initialization failed:', err);
      });
    } catch (err) {
      console.error('Recently played: Error creating search popup:', err);
    }
  }

  async function loadCatalog() {
    try {
      const res = await fetch('js/games.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('Failed to load games.json');
      const data = await res.json();

      let games = Array.isArray(data) ? data : (Array.isArray(data.games) ? data.games : []);

      // Normalize using catalog if available
      if (global.ArcadeCatalog && typeof global.ArcadeCatalog.normalizeGameList === 'function') {
        games = global.ArcadeCatalog.normalizeGameList(games);
      }

      return games;
    } catch (err) {
      console.error('Failed to load game catalog:', err);
      return [];
    }
  }

  function showEmptyState() {
    if (grid) {
      grid.innerHTML = '';
      grid.style.display = 'none';
    }
    if (emptyState) {
      emptyState.hidden = false;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
