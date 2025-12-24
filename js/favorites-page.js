(function(global){
  'use strict';

  /**
   * Favorites Page - Renders favorite games using PortalApp
   * Requires authentication - shows login prompt for unauthenticated users
   */

  const grid = document.getElementById('gamesGrid');
  const emptyState = document.getElementById('emptyState');
  const loginPrompt = document.getElementById('loginPrompt');
  const searchInput = document.querySelector('.search-box input[type="search"]');

  let currentApp = null;

  async function init() {
    if (!grid) {
      console.error('Favorites page: grid element not found');
      return;
    }

    // Wait for dependencies
    if (!global.favoritesService || !global.PortalApp || !global.ArcadeCatalog) {
      console.error('Favorites page: dependencies not loaded');
      showLoginPrompt();
      return;
    }

    // Check authentication
    const isAuthenticated = await global.favoritesService.isAuthenticated();
    if (!isAuthenticated) {
      showLoginPrompt();
      initSearchPopup();
      return;
    }

    // Hide login prompt
    if (loginPrompt) {
      loginPrompt.hidden = true;
    }

    try {
      await renderFavorites();
      initSearchPopup();

      // Listen for auth changes
      if (global.SupabaseAuth && typeof global.SupabaseAuth.onAuthChange === 'function') {
        global.SupabaseAuth.onAuthChange(async (event, user) => {
          if (user) {
            if (loginPrompt) loginPrompt.hidden = true;
            await renderFavorites();
          } else {
            showLoginPrompt();
          }
        });
      }

      // Listen for favorites changes
      global.favoritesService.addListener(async () => {
        await renderFavorites();
      });

      // Track page view
      if (global.Analytics && typeof global.Analytics.event === 'function') {
        global.Analytics.event('page_view', {
          page_title: 'Favorites',
          page_location: window.location.href
        });
      }

    } catch (err) {
      console.error('Failed to load favorites page:', err);
      showEmptyState();
    }
  }

  async function renderFavorites() {
    try {
      // Initialize favorites service if not already done
      await global.favoritesService.init(true);

      // Get favorite game IDs
      const favoriteIds = await global.favoritesService.getFavorites();

      if (!favoriteIds || favoriteIds.length === 0) {
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

      // Match favorite games with catalog data
      const favoriteIdSet = new Set(favoriteIds);
      const matchedGames = catalog.filter(game => {
        return favoriteIdSet.has(game.id) || favoriteIdSet.has(game.slug);
      });

      // Sort by the order in favoriteIds (most recently added first)
      const gameIdToIndex = new Map();
      favoriteIds.forEach((id, index) => {
        gameIdToIndex.set(id, index);
      });

      matchedGames.sort((a, b) => {
        const aIndex = gameIdToIndex.get(a.id) ?? gameIdToIndex.get(a.slug) ?? Infinity;
        const bIndex = gameIdToIndex.get(b.id) ?? gameIdToIndex.get(b.slug) ?? Infinity;
        return aIndex - bIndex;
      });

      if (matchedGames.length === 0) {
        showEmptyState();
        return;
      }

      // Show grid, hide empty state
      if (grid) {
        grid.style.display = '';
      }
      if (emptyState) {
        emptyState.hidden = true;
      }

      // Use PortalApp to render the games
      if (!currentApp) {
        currentApp = new global.PortalApp({
          grid: grid,
          categoryBar: null,
          searchInput: null,
          analytics: global.Analytics,
          catalog: global.ArcadeCatalog,
          i18n: global.I18N,
          gamesEndpoint: 'js/games.json'
        });
      }

      // Override allGames with our favorite games
      currentApp.allGames = matchedGames;

      // Render the list
      currentApp.renderList(matchedGames, 'favorites', 'Favorites');

      // Re-render on language change
      document.addEventListener('langchange', () => {
        currentApp.renderList(matchedGames, 'favorites', 'Favorites');
      });

    } catch (err) {
      console.error('Failed to render favorites:', err);
      showEmptyState();
    }
  }

  function initSearchPopup() {
    if (!searchInput) {
      console.debug('Favorites: No search input found');
      return;
    }

    if (!global.SearchPopup) {
      console.error('Favorites: SearchPopup class not available');
      return;
    }

    try {
      console.debug('Favorites: Initializing search popup');

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
        console.debug('Favorites: Search popup initialized successfully');
      }).catch(err => {
        console.error('Favorites: Search popup initialization failed:', err);
      });
    } catch (err) {
      console.error('Favorites: Error creating search popup:', err);
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
    if (loginPrompt) {
      loginPrompt.hidden = true;
    }
  }

  function showLoginPrompt() {
    if (grid) {
      grid.innerHTML = '';
      grid.style.display = 'none';
    }
    if (emptyState) {
      emptyState.hidden = true;
    }
    if (loginPrompt) {
      loginPrompt.hidden = false;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
