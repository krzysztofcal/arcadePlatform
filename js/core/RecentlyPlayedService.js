(function(global){
  'use strict';

  const STORAGE_KEY = 'kcswh:recently-played';
  const MAX_GAMES = 20;

  /**
   * RecentlyPlayedService - Tracks recently played games for both anonymous and logged-in users
   * Stores game metadata (id, slug, title, thumbnail) with timestamps in localStorage
   */
  class RecentlyPlayedService {
    constructor(options = {}) {
      this.storageKey = options.storageKey || STORAGE_KEY;
      this.maxGames = options.maxGames || MAX_GAMES;
      this.localStorage = options.localStorage || global.localStorage;
    }

    /**
     * Load recently played games from storage
     * @returns {Array} Array of recently played game objects
     */
    load() {
      try {
        const stored = this.localStorage.getItem(this.storageKey);
        if (!stored) return [];
        const data = JSON.parse(stored);
        if (!Array.isArray(data)) return [];
        // Sort by timestamp descending (most recent first)
        return data.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      } catch (err) {
        console.error('Failed to load recently played games:', err);
        return [];
      }
    }

    /**
     * Save recently played games to storage
     * @param {Array} games - Array of game objects to save
     */
    save(games) {
      try {
        if (!Array.isArray(games)) return;
        this.localStorage.setItem(this.storageKey, JSON.stringify(games));
      } catch (err) {
        console.error('Failed to save recently played games:', err);
      }
    }

    /**
     * Add a game to the recently played list
     * @param {Object} gameData - Game data object with id, slug, title, thumbnail
     */
    addGame(gameData) {
      if (!gameData || !gameData.id) return;

      const games = this.load();
      const timestamp = Date.now();

      // Remove existing entry for this game if present
      const filtered = games.filter(g => g.id !== gameData.id);

      // Add new entry at the beginning
      const newEntry = {
        id: gameData.id,
        slug: gameData.slug || gameData.id,
        title: gameData.title || { en: '', pl: '' },
        thumbnail: gameData.thumbnail || null,
        timestamp: timestamp
      };

      filtered.unshift(newEntry);

      // Keep only the most recent MAX_GAMES entries
      const trimmed = filtered.slice(0, this.maxGames);

      this.save(trimmed);
    }

    /**
     * Get all recently played games
     * @returns {Array} Array of recently played games
     */
    getRecentGames() {
      return this.load();
    }

    /**
     * Get recently played game IDs (for quick lookup)
     * @returns {Array} Array of game IDs
     */
    getRecentGameIds() {
      return this.load().map(g => g.id);
    }

    /**
     * Check if a game has been played recently
     * @param {string} gameId - Game ID to check
     * @returns {boolean} True if game has been played recently
     */
    hasPlayed(gameId) {
      if (!gameId) return false;
      return this.load().some(g => g.id === gameId);
    }

    /**
     * Clear all recently played games
     */
    clear() {
      try {
        this.localStorage.removeItem(this.storageKey);
      } catch (err) {
        console.error('Failed to clear recently played games:', err);
      }
    }

    /**
     * Remove a specific game from recently played
     * @param {string} gameId - Game ID to remove
     */
    removeGame(gameId) {
      if (!gameId) return;
      const games = this.load();
      const filtered = games.filter(g => g.id !== gameId);
      this.save(filtered);
    }
  }

  // Expose globally
  global.RecentlyPlayedService = RecentlyPlayedService;

  // Create a default instance for convenience
  global.recentlyPlayed = new RecentlyPlayedService();

})(window);
