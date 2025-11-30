(function(global){
  'use strict';

  /**
   * Recently Played Tracker - Hooks into game navigation to track recently played games
   * Works with both anonymous and logged-in users
   */

  // Wait for dependencies to load
  function waitForDeps(callback) {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max wait

    function check() {
      if (global.recentlyPlayed && global.ArcadeCatalog) {
        callback();
        return;
      }

      if (attempts++ < maxAttempts) {
        setTimeout(check, 100);
      } else {
        console.warn('Recently played tracker: dependencies not loaded');
      }
    }

    check();
  }

  function trackGameView(gameData) {
    if (!gameData || !gameData.slug) return;

    try {
      const catalog = global.ArcadeCatalog;

      // Find the full game data from catalog if we only have a slug
      if (!gameData.title && catalog && typeof catalog.findGameBySlug === 'function') {
        // We'll need to fetch the catalog first
        loadAndTrackGame(gameData.slug);
        return;
      }

      // Add to recently played
      if (global.recentlyPlayed) {
        global.recentlyPlayed.addGame({
          id: gameData.id || gameData.slug,
          slug: gameData.slug,
          title: gameData.title,
          thumbnail: gameData.thumbnail
        });
      }
    } catch (err) {
      console.error('Failed to track recently played game:', err);
    }
  }

  async function loadAndTrackGame(slug) {
    try {
      const res = await fetch('js/games.json', { cache: 'no-cache' });
      const data = await res.json();
      const games = Array.isArray(data) ? data : (Array.isArray(data.games) ? data.games : []);
      const game = games.find(g => g.slug === slug || g.id === slug);

      if (game && global.recentlyPlayed) {
        global.recentlyPlayed.addGame({
          id: game.id || game.slug,
          slug: game.slug || game.id,
          title: game.title,
          thumbnail: game.thumbnail
        });
      }
    } catch (err) {
      console.error('Failed to load game catalog for tracking:', err);
    }
  }

  function hookIntoAnalytics() {
    // Hook into Analytics.viewGame if available
    if (global.Analytics && typeof global.Analytics.viewGame === 'function') {
      const originalViewGame = global.Analytics.viewGame;

      global.Analytics.viewGame = function(params) {
        // Call original function
        const result = originalViewGame.apply(this, arguments);

        // Track in recently played
        if (params && params.slug) {
          loadAndTrackGame(params.slug);
        }

        return result;
      };
    }

    // Hook into Analytics.startGame if available
    if (global.Analytics && typeof global.Analytics.startGame === 'function') {
      const originalStartGame = global.Analytics.startGame;

      global.Analytics.startGame = function(params) {
        // Call original function
        const result = originalStartGame.apply(this, arguments);

        // Track in recently played
        if (params && params.slug) {
          loadAndTrackGame(params.slug);
        }

        return result;
      };
    }
  }

  function hookIntoXP() {
    // Hook into XP.startSession if available
    if (global.XP && typeof global.XP.startSession === 'function') {
      const originalStartSession = global.XP.startSession;

      global.XP.startSession = function(slug) {
        // Call original function
        const result = originalStartSession.apply(this, arguments);

        // Track in recently played
        if (slug) {
          loadAndTrackGame(slug);
        }

        return result;
      };
    }
  }

  function init() {
    hookIntoAnalytics();
    hookIntoXP();
  }

  // Wait for dependencies and initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      waitForDeps(init);
    });
  } else {
    waitForDeps(init);
  }

})(window);
