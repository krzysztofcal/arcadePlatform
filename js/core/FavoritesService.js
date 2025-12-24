/**
 * FavoritesService - Manages user favorite games via the backend API
 * Requires authentication - only works for logged-in users
 * Cross-browser support via database storage
 */
(function(global){
  'use strict';

  const API_ENDPOINT = '/api/favorites';
  const CACHE_KEY = 'kcswh:favorites-cache';
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  function getAuthBridge(globalRef) {
    if (!globalRef || !globalRef.SupabaseAuthBridge) return null;

    if (typeof globalRef.SupabaseAuthBridge.getAccessToken === 'function') {
      return globalRef.SupabaseAuthBridge;
    }

    try {
      if (globalRef.parent
        && globalRef.parent !== globalRef
        && globalRef.parent.SupabaseAuthBridge
        && typeof globalRef.parent.SupabaseAuthBridge.getAccessToken === 'function') {
        return globalRef.parent.SupabaseAuthBridge;
      }
    } catch (_err) {}

    try {
      if (globalRef.opener
        && globalRef.opener.SupabaseAuthBridge
        && typeof globalRef.opener.SupabaseAuthBridge.getAccessToken === 'function') {
        return globalRef.opener.SupabaseAuthBridge;
      }
    } catch (_err) {}

    return null;
  }

  /**
   * FavoritesService class
   */
  class FavoritesService {
    constructor(options = {}) {
      this.apiEndpoint = options.apiEndpoint || API_ENDPOINT;
      this.localStorage = options.localStorage || global.localStorage;
      this.favorites = new Set();
      this.cacheTimestamp = 0;
      this.loading = false;
     this.listeners = [];
    }

    /**
     * Get the current user's access token
     * @returns {Promise<string|null>}
     */
    async getAccessToken() {
      const bridge = getAuthBridge(global);
      console.debug('[FavoritesService] getAccessToken: bridge=', !!bridge);
      if (bridge && typeof bridge.getAccessToken === 'function') {
        const token = await bridge.getAccessToken();
        console.debug('[FavoritesService] getAccessToken: bridge token=', !!token);
        if (token) return token;
      }

      if (global.SupabaseAuth && typeof global.SupabaseAuth.getAccessToken === 'function') {
        try {
          const token = await global.SupabaseAuth.getAccessToken();
          console.debug('[FavoritesService] getAccessToken: SupabaseAuth token=', !!token);
          if (token) return token;
        } catch (_err) {}
      }
      console.debug('[FavoritesService] getAccessToken: no token found');
      return null;
    }

    /**
     * Check if user is authenticated
     * @returns {Promise<boolean>}
     */
    async isAuthenticated() {
      const token = await this.getAccessToken();
      return !!token;
    }

    /**
     * Load favorites from cache if available and not expired
     */
    loadFromCache() {
      try {
        const cached = this.localStorage.getItem(CACHE_KEY);
        if (!cached) return false;

        const data = JSON.parse(cached);
        if (!data || !Array.isArray(data.favorites)) return false;

        const age = Date.now() - (data.timestamp || 0);
        if (age > CACHE_TTL_MS) return false;

        this.favorites = new Set(data.favorites);
        this.cacheTimestamp = data.timestamp;
        return true;
      } catch (err) {
        console.error('[FavoritesService] Failed to load from cache:', err);
        return false;
      }
    }

    /**
     * Save favorites to cache
     */
    saveToCache() {
      try {
        const data = {
          favorites: Array.from(this.favorites),
          timestamp: Date.now()
        };
        this.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch (err) {
        console.error('[FavoritesService] Failed to save to cache:', err);
      }
    }

    /**
     * Clear the cache
     */
    clearCache() {
      try {
        this.localStorage.removeItem(CACHE_KEY);
        this.favorites.clear();
        this.cacheTimestamp = 0;
      } catch (err) {
        console.error('[FavoritesService] Failed to clear cache:', err);
      }
    }

    /**
     * Fetch favorites from the API
     * @returns {Promise<string[]>} Array of game IDs
     */
    async fetchFavorites() {
      const token = await this.getAccessToken();
      if (!token) {
        this.clearCache();
        return [];
      }

      this.loading = true;

      try {
        const response = await fetch(this.apiEndpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        if (!data.ok || !Array.isArray(data.favorites)) {
          throw new Error('Invalid response format');
        }

        const gameIds = data.favorites.map(f => f.gameId);
        this.favorites = new Set(gameIds);
        this.saveToCache();
        this.notifyListeners();

        return gameIds;
      } catch (err) {
        console.error('[FavoritesService] Failed to fetch favorites:', err);
        // Try to use cache if API fails
        this.loadFromCache();
        return Array.from(this.favorites);
      } finally {
        this.loading = false;
      }
    }

    /**
     * Get all favorite game IDs
     * Uses cache if available and not expired, otherwise fetches from API
     * @param {boolean} forceRefresh - Force a fresh fetch from API
     * @returns {Promise<string[]>}
     */
    async getFavorites(forceRefresh = false) {
      if (!forceRefresh && this.loadFromCache()) {
        return Array.from(this.favorites);
      }
      return this.fetchFavorites();
    }

    /**
     * Check if a game is favorited
     * @param {string} gameId
     * @returns {Promise<boolean>}
     */
    async isFavorite(gameId) {
      if (!gameId) return false;

      // Check local cache first
      if (this.favorites.has(gameId)) return true;

      // If cache is stale or empty, refresh
      const cacheAge = Date.now() - this.cacheTimestamp;
      if (cacheAge > CACHE_TTL_MS || this.favorites.size === 0) {
        await this.getFavorites(true);
      }

      return this.favorites.has(gameId);
    }

    /**
     * Check if a game is favorited (sync version using cache only)
     * @param {string} gameId
     * @returns {boolean}
     */
    isFavoriteSync(gameId) {
      return this.favorites.has(gameId);
    }

    /**
     * Add a game to favorites
     * @param {string} gameId
     * @returns {Promise<boolean>}
     */
    async addFavorite(gameId) {
      console.debug('[FavoritesService] addFavorite called:', gameId);
      if (!gameId) {
        console.debug('[FavoritesService] addFavorite: no gameId');
        return false;
      }

      const token = await this.getAccessToken();
      if (!token) {
        console.warn('[FavoritesService] Cannot add favorite: not authenticated');
        return false;
      }

      console.debug('[FavoritesService] addFavorite: making API call to', this.apiEndpoint);
      try {
        const response = await fetch(this.apiEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ gameId })
        });

        console.debug('[FavoritesService] addFavorite: response status=', response.status);
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.debug('[FavoritesService] addFavorite: response data=', data);
        if (!data.ok) {
          throw new Error(data.error || 'Failed to add favorite');
        }

        // Update local cache
        this.favorites.add(gameId);
        this.saveToCache();
        this.notifyListeners();

        console.debug('[FavoritesService] addFavorite: success');
        return true;
      } catch (err) {
        console.error('[FavoritesService] Failed to add favorite:', err);
        return false;
      }
    }

    /**
     * Remove a game from favorites
     * @param {string} gameId
     * @returns {Promise<boolean>}
     */
    async removeFavorite(gameId) {
      if (!gameId) return false;

      const token = await this.getAccessToken();
      if (!token) {
        console.warn('[FavoritesService] Cannot remove favorite: not authenticated');
        return false;
      }

      try {
        const response = await fetch(this.apiEndpoint, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ gameId })
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        if (!data.ok) {
          throw new Error(data.error || 'Failed to remove favorite');
        }

        // Update local cache
        this.favorites.delete(gameId);
        this.saveToCache();
        this.notifyListeners();

        return true;
      } catch (err) {
        console.error('[FavoritesService] Failed to remove favorite:', err);
        return false;
      }
    }

    /**
     * Toggle favorite status for a game
     * @param {string} gameId
     * @returns {Promise<{success: boolean, isFavorite: boolean}>}
     */
    async toggleFavorite(gameId) {
      console.debug('[FavoritesService] toggleFavorite:', gameId);
      const currentlyFavorite = this.isFavoriteSync(gameId);
      console.debug('[FavoritesService] currentlyFavorite:', currentlyFavorite);

      if (currentlyFavorite) {
        const success = await this.removeFavorite(gameId);
        console.debug('[FavoritesService] removeFavorite result:', success);
        return { success, isFavorite: !success };
      } else {
        const success = await this.addFavorite(gameId);
        console.debug('[FavoritesService] addFavorite result:', success);
        return { success, isFavorite: success };
      }
    }

    /**
     * Add a listener for favorites changes
     * @param {function} callback
     */
    addListener(callback) {
      if (typeof callback === 'function') {
        this.listeners.push(callback);
      }
    }

    /**
     * Remove a listener
     * @param {function} callback
     */
    removeListener(callback) {
      this.listeners = this.listeners.filter(l => l !== callback);
    }

    /**
     * Notify all listeners of a change
     */
    notifyListeners() {
      const favorites = Array.from(this.favorites);
      this.listeners.forEach(callback => {
        try {
          callback(favorites);
        } catch (err) {
          console.error('[FavoritesService] Listener error:', err);
        }
      });
    }

    /**
     * Initialize the service - load from cache and optionally refresh
     * @param {boolean} refreshFromApi - Whether to immediately refresh from API
     * @returns {Promise<void>}
     */
    async init(refreshFromApi = true) {
      // Load from cache first for immediate availability
      this.loadFromCache();

      // Set up auth state change listener
      if (global.SupabaseAuth && typeof global.SupabaseAuth.onAuthChange === 'function') {
        global.SupabaseAuth.onAuthChange(async (event, user) => {
          if (user) {
            // User logged in - refresh favorites from API
            await this.fetchFavorites();
          } else {
            // User logged out - clear favorites
            this.clearCache();
            this.notifyListeners();
          }
        });
      }

      // Optionally refresh from API
      if (refreshFromApi) {
        const isAuth = await this.isAuthenticated();
        if (isAuth) {
          await this.fetchFavorites();
        }
      }
    }
  }

  // Expose globally
  global.FavoritesService = FavoritesService;

  // Create a default instance for convenience
  global.favoritesService = new FavoritesService();

})(window);
