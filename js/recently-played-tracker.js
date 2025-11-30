(function(global){
  'use strict';

  /**
   * Recently Played Tracker - Tracks games when they are viewed/played
   * Works with both anonymous and logged-in users
   */

  let catalogCache = null;

  async function loadCatalog() {
    if (catalogCache) return catalogCache;

    try {
      const res = await fetch('js/games.json', { cache: 'no-cache' });
      const data = await res.json();
      const games = Array.isArray(data) ? data : (Array.isArray(data.games) ? data.games : []);
      catalogCache = games;
      return games;
    } catch (err) {
      console.error('Failed to load game catalog for tracking:', err);
      return [];
    }
  }

  async function trackGame(slug) {
    if (!slug) return;

    try {
      // Wait for RecentlyPlayedService to be available
      let attempts = 0;
      while (!global.recentlyPlayed && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!global.recentlyPlayed) {
        console.warn('RecentlyPlayedService not available');
        return;
      }

      // Load catalog and find game
      const games = await loadCatalog();
      const game = games.find(g => g.slug === slug || g.id === slug);

      if (game) {
        global.recentlyPlayed.addGame({
          id: game.id || game.slug,
          slug: game.slug || game.id,
          title: game.title,
          thumbnail: game.thumbnail
        });
        console.log('Tracked game:', slug);
      } else {
        console.warn('Game not found in catalog:', slug);
      }
    } catch (err) {
      console.error('Failed to track game:', slug, err);
    }
  }

  function setupHooks() {
    // Hook into Analytics.viewGame
    const setupAnalyticsViewGame = () => {
      if (global.Analytics && typeof global.Analytics.viewGame === 'function') {
        const original = global.Analytics.viewGame;
        global.Analytics.viewGame = function(params) {
          const result = original.apply(this, arguments);
          if (params && params.slug) {
            trackGame(params.slug);
          }
          return result;
        };
        return true;
      }
      return false;
    };

    // Hook into Analytics.startGame
    const setupAnalyticsStartGame = () => {
      if (global.Analytics && typeof global.Analytics.startGame === 'function') {
        const original = global.Analytics.startGame;
        global.Analytics.startGame = function(params) {
          const result = original.apply(this, arguments);
          if (params && params.slug) {
            trackGame(params.slug);
          }
          return result;
        };
        return true;
      }
      return false;
    };

    // Hook into XP.startSession
    const setupXPStartSession = () => {
      if (global.XP && typeof global.XP.startSession === 'function') {
        const original = global.XP.startSession;
        global.XP.startSession = function(slug) {
          const result = original.apply(this, arguments);
          if (slug) {
            trackGame(slug);
          }
          return result;
        };
        return true;
      }
      return false;
    };

    // Try to set up hooks immediately
    let analyticsViewGameHooked = setupAnalyticsViewGame();
    let analyticsStartGameHooked = setupAnalyticsStartGame();
    let xpStartSessionHooked = setupXPStartSession();

    // Keep trying to set up hooks if they're not available yet
    let attempts = 0;
    const maxAttempts = 50;
    const interval = setInterval(() => {
      attempts++;

      if (!analyticsViewGameHooked) {
        analyticsViewGameHooked = setupAnalyticsViewGame();
      }
      if (!analyticsStartGameHooked) {
        analyticsStartGameHooked = setupAnalyticsStartGame();
      }
      if (!xpStartSessionHooked) {
        xpStartSessionHooked = setupXPStartSession();
      }

      if ((analyticsViewGameHooked && analyticsStartGameHooked && xpStartSessionHooked) || attempts >= maxAttempts) {
        clearInterval(interval);
        console.log('Recently played tracker initialized');
      }
    }, 100);
  }

  // Also track games directly from URL parameters
  function trackFromURL() {
    try {
      const params = new URLSearchParams(window.location.search);
      const slug = params.get('slug') || params.get('id');

      if (slug) {
        // Small delay to ensure service is loaded
        setTimeout(() => trackGame(slug), 500);
      }
    } catch (err) {
      console.error('Failed to track from URL:', err);
    }
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupHooks();
      trackFromURL();
    });
  } else {
    setupHooks();
    trackFromURL();
  }

})(window);
