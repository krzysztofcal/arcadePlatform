/**
 * FavoriteButton - Star button component for adding/removing games from favorites
 * Shows filled star when favorited, outline star when not
 * Only visible for authenticated users
 */
(function(global){
  'use strict';

  const STAR_FILLED = '★';
  const STAR_OUTLINE = '☆';

  /**
   * Create and manage a favorite button for a game
   * @param {Object} options
   * @param {string} options.gameId - The game ID
   * @param {HTMLElement} options.container - Container to insert the button into
   * @param {string} [options.insertPosition='beforeend'] - Where to insert ('beforeend', 'afterbegin', etc.)
   * @param {string} [options.className='btnIcon btnFavorite'] - CSS classes for the button
   * @returns {Object} FavoriteButton instance
   */
  function FavoriteButton(options) {
    const gameId = options.gameId;
    const container = options.container;
    const insertPosition = options.insertPosition || 'beforeend';
    const className = options.className || 'btnIcon btnFavorite';

    let button = null;
    let isFavorite = false;
    let isLoading = false;
    let isAuthenticated = false;

    /**
     * Create the button element
     */
    function createButton() {
      button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('title', 'Add to favorites');
      button.setAttribute('aria-label', 'Add to favorites');
      button.textContent = STAR_OUTLINE;
      button.style.display = 'none'; // Hidden by default until we check auth

      button.addEventListener('click', handleClick);

      return button;
    }

    /**
     * Update the button UI based on favorite state
     */
    function updateUI() {
      if (!button) return;

      if (isLoading) {
        button.disabled = true;
        button.style.opacity = '0.6';
        return;
      }

      button.disabled = false;
      button.style.opacity = '1';
      button.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
      button.textContent = isFavorite ? STAR_FILLED : STAR_OUTLINE;

      // Update title/aria-label based on i18n if available
      const titleKey = isFavorite ? 'removeFromFavorites' : 'addToFavorites';
      const title = (global.I18N && global.I18N.t(titleKey)) ||
                   (isFavorite ? 'Remove from favorites' : 'Add to favorites');
      button.setAttribute('title', title);
      button.setAttribute('aria-label', title);

      // Visual styling
      if (isFavorite) {
        button.style.color = '#fbbf24'; // Golden star color
      } else {
        button.style.color = ''; // Reset to default
      }
    }

    /**
     * Handle button click
     */
    async function handleClick(e) {
      e.preventDefault();
      e.stopPropagation();

      console.debug('[FavoriteButton] handleClick: gameId=', gameId, 'favoritesService=', !!global.favoritesService, 'isLoading=', isLoading);

      if (!global.favoritesService || isLoading) {
        console.debug('[FavoriteButton] handleClick: early return');
        return;
      }

      isLoading = true;
      updateUI();

      try {
        const result = await global.favoritesService.toggleFavorite(gameId);
        console.debug('[FavoriteButton] handleClick: result=', result);
        if (result.success) {
          isFavorite = result.isFavorite;
        }
      } catch (err) {
        console.error('[FavoriteButton] Failed to toggle favorite:', err);
      } finally {
        isLoading = false;
        updateUI();
      }
    }

    /**
     * Check authentication status and favorite state
     */
    async function checkStatus() {
      if (!global.favoritesService) {
        console.debug('[FavoriteButton] FavoritesService not available');
        return;
      }

      try {
        isAuthenticated = await global.favoritesService.isAuthenticated();

        if (!button) return;

        if (isAuthenticated) {
          button.style.display = '';

          // Check if game is favorite
          await global.favoritesService.init(false);
          isFavorite = global.favoritesService.isFavoriteSync(gameId);
          updateUI();

          // Fetch fresh data from API
          const freshFavorites = await global.favoritesService.getFavorites(true);
          isFavorite = freshFavorites.includes(gameId);
          updateUI();
        } else {
          button.style.display = 'none';
        }
      } catch (err) {
        console.error('[FavoriteButton] Failed to check status:', err);
      }
    }

    /**
     * Initialize the button
     */
    function init() {
      if (!gameId || !container) {
        console.error('[FavoriteButton] Missing gameId or container');
        return null;
      }

      // Create button
      button = createButton();

      // Insert into container
      container.insertAdjacentElement(insertPosition, button);

      // Check status after a short delay to allow services to load
      setTimeout(checkStatus, 100);

      // Listen for auth changes
      if (global.SupabaseAuth && typeof global.SupabaseAuth.onAuthChange === 'function') {
        global.SupabaseAuth.onAuthChange(async (event, user) => {
          isAuthenticated = !!user;
          if (button) {
            button.style.display = isAuthenticated ? '' : 'none';
          }
          if (isAuthenticated) {
            await checkStatus();
          } else {
            isFavorite = false;
            updateUI();
          }
        });
      }

      // Listen for favorites changes (from other tabs or components)
      if (global.favoritesService) {
        global.favoritesService.addListener((favorites) => {
          isFavorite = favorites.includes(gameId);
          updateUI();
        });
      }

      // Re-check on language change
      document.addEventListener('langchange', updateUI);

      return {
        button,
        refresh: checkStatus,
        destroy: () => {
          if (button && button.parentNode) {
            button.parentNode.removeChild(button);
          }
          document.removeEventListener('langchange', updateUI);
        }
      };
    }

    return init();
  }

  /**
   * Auto-initialize favorite buttons on game pages
   * Looks for data-game-id attribute on body and .actions container in .titleBar
   */
  function autoInit() {
    // Prevent double initialization
    if (global.__favoriteButtonInitialized) {
      return;
    }

    const body = document.body;
    const gameId = body.dataset.gameId || body.dataset.gameSlug;

    if (!gameId) {
      console.debug('[FavoriteButton] No game ID found on body');
      return;
    }

    // Look for the actions container in titleBar
    const actionsContainer = document.querySelector('.titleBar .actions');
    if (!actionsContainer) {
      console.debug('[FavoriteButton] No .titleBar .actions container found');
      return;
    }

    // Check if button already exists
    if (actionsContainer.querySelector('.btnFavorite')) {
      console.debug('[FavoriteButton] Button already exists');
      return;
    }

    // Mark as initialized
    global.__favoriteButtonInitialized = true;

    // Create the favorite button
    FavoriteButton({
      gameId: gameId,
      container: actionsContainer,
      insertPosition: 'afterbegin' // Insert at the beginning of actions
    });

    console.debug('[FavoriteButton] Initialized for game:', gameId);
  }

  // Expose globally
  global.FavoriteButton = FavoriteButton;

  // Auto-initialize on DOM ready (only once)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit, { once: true });
  } else {
    // Small delay to ensure services are loaded
    setTimeout(autoInit, 50);
  }

})(window);
