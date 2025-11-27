/**
 * Search popup component for game pages
 * Shows async search results in a dropdown with game icons and names
 */
(function(global){
  'use strict';

  const SEARCH_UTILS = global.GameSearch && typeof global.GameSearch === 'object'
    ? global.GameSearch
    : null;

  class SearchPopup {
    constructor(options){
      if (!options || !options.searchInput){
        throw new Error('SearchPopup requires a searchInput element');
      }
      this.searchInput = options.searchInput;
      this.catalog = options.catalog || null;
      this.i18n = options.i18n || null;
      this.analytics = options.analytics || null;
      this.searchUtils = SEARCH_UTILS;
      this.window = options.win || global;
      this.document = options.doc || global.document;
      this.fetchImpl = typeof options.fetchImpl === 'function'
        ? options.fetchImpl
        : (url, fetchOptions) => global.fetch(url, fetchOptions);
      this.gamesEndpoint = typeof options.gamesEndpoint === 'string' && options.gamesEndpoint.trim()
        ? options.gamesEndpoint.trim()
        : 'js/games.json';

      this.allGames = [];
      this.popup = null;
      this.isVisible = false;
      this.searchBoxContainer = this.searchInput.closest('.search-box');

      this.handleClickOutside = this.handleClickOutside.bind(this);
      this.handleEscape = this.handleEscape.bind(this);
    }

    getLang(){
      if (this.i18n && typeof this.i18n.getLang === 'function'){
        try {
          return this.i18n.getLang();
        } catch (err) {}
      }
      return 'en';
    }

    normalizeList(rawList){
      if (this.catalog && typeof this.catalog.normalizeGameList === 'function'){
        return this.catalog.normalizeGameList(rawList);
      }
      if (!Array.isArray(rawList)) return [];
      return rawList.filter(Boolean);
    }

    async loadGames(){
      const res = await this.fetchImpl(this.gamesEndpoint, { cache: 'no-cache' });
      if (!res || (typeof res.ok === 'boolean' && !res.ok)){
        throw new Error('Failed to load games catalog');
      }
      const data = typeof res.json === 'function' ? await res.json() : null;
      if (data && Array.isArray(data.games)) return this.normalizeList(data.games);
      if (Array.isArray(data)) return this.normalizeList(data);
      throw new Error('Unexpected games catalog format');
    }

    createPopup(){
      const popup = this.document.createElement('div');
      popup.className = 'search-popup';
      popup.setAttribute('hidden', '');
      popup.setAttribute('role', 'listbox');
      popup.setAttribute('aria-label', 'Search results');
      return popup;
    }

    getGameTitle(game, lang){
      if (!game || !game.title) return '';
      if (typeof game.title === 'object'){
        return game.title[lang] || game.title.en || '';
      }
      return typeof game.title === 'string' ? game.title : '';
    }

    getGameHref(game, lang){
      if (!game || !game.source) return null;
      const slug = game.slug || game.id || '';

      if (game.source.page){
        try {
          const url = new URL(game.source.page, this.window.location.href);
          if (url.origin !== this.window.location.origin) return null;
          url.searchParams.set('lang', lang);
          if (slug) url.searchParams.set('slug', slug);
          return url.toString();
        } catch (err) {
          return null;
        }
      }

      if (game.source.type === 'distributor'){
        try {
          const url = new URL('game.html', this.window.location.href);
          url.searchParams.set('slug', slug);
          url.searchParams.set('lang', lang);
          return url.toString();
        } catch (err) {
          return null;
        }
      }

      return null;
    }

    safeImageUrl(url){
      if (!url || typeof url !== 'string') return null;
      try {
        const parsed = new URL(url, this.window.location.href);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        return parsed.href;
      } catch (err) {
        return null;
      }
    }

    createResultItem(game, lang){
      const href = this.getGameHref(game, lang);
      if (!href) return null;

      const item = this.document.createElement('a');
      item.className = 'search-popup__item';
      item.href = href;
      item.setAttribute('role', 'option');

      const icon = this.document.createElement('div');
      icon.className = 'search-popup__icon';

      const thumbnailUrl = this.safeImageUrl(game.thumbnail);
      if (thumbnailUrl){
        if (thumbnailUrl.endsWith('.svg')){
          icon.style.backgroundImage = `url("${thumbnailUrl.replace(/"/g, '%22')}")`;
        } else {
          const img = this.document.createElement('img');
          img.src = thumbnailUrl;
          img.alt = '';
          img.loading = 'lazy';
          icon.appendChild(img);
        }
      } else {
        // Fallback icon
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
      }

      item.appendChild(icon);

      const name = this.document.createElement('div');
      name.className = 'search-popup__name';
      name.textContent = this.getGameTitle(game, lang);
      item.appendChild(name);

      item.addEventListener('click', () => {
        this.hidePopup();
        if (this.analytics && typeof this.analytics.event === 'function'){
          this.analytics.event('select_content', {
            content_type: 'game',
            item_id: game.slug || game.id,
            search_term: this.searchInput.value
          });
        }
      });

      return item;
    }

    renderResults(games){
      if (!this.popup) return;

      this.popup.innerHTML = '';

      if (!games || games.length === 0){
        const empty = this.document.createElement('div');
        empty.className = 'search-popup__empty';
        empty.textContent = 'No games found';
        this.popup.appendChild(empty);
        return;
      }

      const lang = this.getLang();
      const fragment = this.document.createDocumentFragment();

      // Limit to first 8 results to avoid overwhelming the dropdown
      const limitedGames = games.slice(0, 8);

      for (const game of limitedGames){
        const item = this.createResultItem(game, lang);
        if (item) fragment.appendChild(item);
      }

      this.popup.appendChild(fragment);
    }

    showPopup(){
      if (!this.popup) return;
      this.popup.removeAttribute('hidden');
      this.isVisible = true;

      // Add global event listeners
      this.document.addEventListener('click', this.handleClickOutside);
      this.document.addEventListener('keydown', this.handleEscape);
    }

    hidePopup(){
      if (!this.popup) return;
      this.popup.setAttribute('hidden', '');
      this.isVisible = false;

      // Remove global event listeners
      this.document.removeEventListener('click', this.handleClickOutside);
      this.document.removeEventListener('keydown', this.handleEscape);
    }

    handleClickOutside(event){
      if (!this.isVisible) return;
      if (!this.searchBoxContainer || !this.popup) return;

      const target = event.target;
      if (!this.searchBoxContainer.contains(target) && !this.popup.contains(target)){
        this.hidePopup();
      }
    }

    handleEscape(event){
      if (!this.isVisible) return;
      if (event.key === 'Escape' || event.keyCode === 27){
        this.hidePopup();
        if (this.searchInput) this.searchInput.blur();
      }
    }

    handleSearch(query){
      console.debug('SearchPopup: handleSearch called with query:', query);

      if (!query || typeof query !== 'string' || !query.trim()){
        this.hidePopup();
        return;
      }

      const lang = this.getLang();
      let filtered = [];

      if (this.searchUtils && typeof this.searchUtils.filterGamesBySearch === 'function'){
        filtered = this.searchUtils.filterGamesBySearch(this.allGames, query, lang);
      } else {
        // Fallback simple filtering
        const normalizedQuery = query.toLowerCase().trim();
        filtered = this.allGames.filter(game => {
          const title = this.getGameTitle(game, lang);
          return title.toLowerCase().includes(normalizedQuery);
        });
      }

      console.debug('SearchPopup: Found', filtered.length, 'matching games');
      this.renderResults(filtered);
      this.showPopup();

      if (this.analytics && typeof this.analytics.event === 'function'){
        this.analytics.event('search', { search_term: query });
      }
    }

    setupEventListeners(){
      if (!this.searchInput) return;

      const debounced = this.searchUtils && typeof this.searchUtils.debounce === 'function'
        ? this.searchUtils.debounce((value) => this.handleSearch(value), 300)
        : (value) => this.handleSearch(value);

      this.searchInput.addEventListener('input', (e) => {
        if (e && e.target) debounced(e.target.value);
      });

      this.searchInput.addEventListener('search', (e) => {
        if (e && e.target) this.handleSearch(e.target.value);
      });

      this.searchInput.addEventListener('focus', () => {
        if (this.searchInput.value && this.searchInput.value.trim()){
          this.handleSearch(this.searchInput.value);
        }
      });
    }

    async init(){
      console.debug('SearchPopup: Starting initialization');

      try {
        this.allGames = await this.loadGames();
        console.debug('SearchPopup: Loaded', this.allGames.length, 'games');
      } catch (err) {
        if (global.console && typeof global.console.error === 'function'){
          global.console.error('Failed to load games for search:', err);
        }
        this.allGames = [];
      }

      // Create and append popup to search box container
      if (this.searchBoxContainer){
        this.popup = this.createPopup();
        this.searchBoxContainer.appendChild(this.popup);
        console.debug('SearchPopup: Popup element created and appended');
      } else {
        console.error('SearchPopup: No search box container found');
      }

      this.setupEventListeners();
      console.debug('SearchPopup: Event listeners set up');
    }
  }

  // Expose on window
  global.SearchPopup = SearchPopup;
})(window);
