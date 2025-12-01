(function(global){
  'use strict';

  /**
   * Recently Played Tracker - Tracks games when they are viewed/played
   * Works with both anonymous and logged-in users
   * Uses KLog for proper logging to the debug system
   */

  let catalogCache = null;
  const LOG_PREFIX = 'recently_played';

  function klog(kind, data) {
    try {
      if (global.KLog && typeof global.KLog.log === 'function') {
        global.KLog.log(`${LOG_PREFIX}_${kind}`, data || {});
      }
    } catch (err) {
      // Fallback to console if KLog not available
      try {
        console.log(`[${LOG_PREFIX}] ${kind}:`, data);
      } catch (_) {}
    }
  }

  async function loadCatalog() {
    if (catalogCache) return catalogCache;

    try {
      const res = await fetch('/js/games.json', { cache: 'no-cache' });
      const data = await res.json();
      const games = Array.isArray(data) ? data : (Array.isArray(data.games) ? data.games : []);
      catalogCache = games;
      klog('catalog_loaded', { count: games.length });
      return games;
    } catch (err) {
      klog('catalog_error', { error: err.message });
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
        klog('service_unavailable', { slug, attempts });
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
        klog('tracked', { slug, id: game.id });
      } else {
        klog('game_not_found', { slug, catalogSize: games.length });
      }
    } catch (err) {
      klog('track_error', { slug, error: err.message });
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
        klog('initialized', {
          analyticsViewGame: analyticsViewGameHooked,
          analyticsStartGame: analyticsStartGameHooked,
          xpStartSession: xpStartSessionHooked,
          attempts: attempts
        });
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
        setTimeout(() => {
          klog('url_track_attempt', { slug });
          trackGame(slug);
        }, 500);
      }
    } catch (err) {
      klog('url_track_error', { error: err.message });
    }
  }

  // Track from game ID in window object (for games-open)
  function trackFromWindowGameId() {
    try {
      if (global.__GAME_ID__ && typeof global.__GAME_ID__ === 'string') {
        const gameId = global.__GAME_ID__;
        // Small delay to ensure service is loaded
        setTimeout(() => {
          klog('window_game_id_track', { gameId });
          trackGame(gameId);
        }, 500);
      }
    } catch (err) {
      klog('window_game_id_error', { error: err.message });
    }
  }

  // Initialize
  function init() {
    klog('init_start', { url: window.location.pathname });
    setupHooks();
    trackFromURL();
    trackFromWindowGameId();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
