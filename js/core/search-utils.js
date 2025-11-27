/**
 * Search utility module for filtering games by name
 * Supports internationalization (i18n) for game titles and descriptions
 */

/**
 * Filters a list of games by search query
 * @param {Array} games - Array of game objects
 * @param {string} query - Search query string
 * @param {string} lang - Current language code (e.g., 'en', 'pl')
 * @returns {Array} - Filtered array of games matching the query
 */
function filterGamesBySearch(games, query, lang = 'en') {
  if (!query || typeof query !== 'string') {
    return games;
  }

  const normalizedQuery = query.toLowerCase().trim();

  if (normalizedQuery.length === 0) {
    return games;
  }

  return games.filter(game => {
    if (!game) return false;

    // Search in localized title
    const title = (game.title && typeof game.title === 'object')
      ? (game.title[lang] || game.title.en || '')
      : (typeof game.title === 'string' ? game.title : '');

    if (title.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    // Search in localized description
    const description = (game.description && typeof game.description === 'object')
      ? (game.description[lang] || game.description.en || '')
      : (typeof game.description === 'string' ? game.description : '');

    if (description.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    // Search in tags (not localized)
    if (Array.isArray(game.tags)) {
      const matchesTag = game.tags.some(tag =>
        typeof tag === 'string' && tag.toLowerCase().includes(normalizedQuery)
      );
      if (matchesTag) {
        return true;
      }
    }

    // Search in categories (not localized)
    if (Array.isArray(game.category)) {
      const matchesCategory = game.category.some(cat =>
        typeof cat === 'string' && cat.toLowerCase().includes(normalizedQuery)
      );
      if (matchesCategory) {
        return true;
      }
    }

    // Search in slug/id as fallback
    if (game.slug && typeof game.slug === 'string' && game.slug.toLowerCase().includes(normalizedQuery)) {
      return true;
    }
    if (game.id && typeof game.id === 'string' && game.id.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    return false;
  });
}

/**
 * Debounces a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GameSearch = {
    filterGamesBySearch,
    debounce
  };
}
