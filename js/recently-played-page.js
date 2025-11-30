(function(global){
  'use strict';

  /**
   * Recently Played Page - Renders recently played games using PortalApp
   */

  const grid = document.getElementById('gamesGrid');
  const emptyState = document.getElementById('emptyState');
  const searchInput = document.getElementById('searchInput');

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
        return;
      }

      // Use PortalApp to render the games
      const app = new global.PortalApp({
        grid: grid,
        categoryBar: null, // No category bar on recently played page
        searchInput: searchInput,
        analytics: global.Analytics,
        catalog: global.ArcadeCatalog,
        i18n: global.I18N,
        gamesEndpoint: 'js/games.json'
      });

      // Override allGames with our recently played games
      app.allGames = matchedGames;

      // Setup search input
      app.setupSearchInput();

      // Render the list
      app.renderList(matchedGames, 'recently_played', 'Recently Played');

      // Re-render on language change
      document.addEventListener('langchange', () => {
        app.renderList(matchedGames, 'recently_played', 'Recently Played');
      });

      // Hide empty state
      if (emptyState) {
        emptyState.hidden = true;
      }

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
