(function(global){
  'use strict';

  const DEFAULT_CATEGORIES = Object.freeze(['All', 'Arcade', 'Puzzle', 'Shooter', 'Racing']);
  const SHARED_GAME_UTILS = global.GameUtils && typeof global.GameUtils === 'object'
    ? global.GameUtils
    : null;
  const SEARCH_UTILS = global.GameSearch && typeof global.GameSearch === 'object'
    ? global.GameSearch
    : null;

  function isNonEmptyString(value){
    return typeof value === 'string' && value.trim().length > 0;
  }

  function asLocaleBlock(value){
    if (!value) return { en: '', pl: '' };
    if (typeof value === 'string'){
      const trimmed = value.trim();
      return { en: trimmed, pl: trimmed };
    }
    if (typeof value === 'object'){
      const out = { en: '', pl: '' };
      if (isNonEmptyString(value.en)) out.en = value.en.trim();
      if (isNonEmptyString(value.pl)) out.pl = value.pl.trim();
      if (!out.en && out.pl) out.en = out.pl;
      if (!out.pl && out.en) out.pl = out.en;
      return out;
    }
    return { en: '', pl: '' };
  }

  function klog(kind, data){
    try {
      if (global && global.KLog && typeof global.KLog.log === 'function'){
        global.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  class PortalApp {
    constructor(options){
      if (!options || !options.grid){
        throw new Error('PortalApp requires a grid element');
      }
      this.grid = options.grid;
      this.categoryBar = options.categoryBar || null;
      this.analytics = options.analytics || null;
      this.catalog = options.catalog || null;
      this.i18n = options.i18n || null;
      this.fetchImpl = typeof options.fetchImpl === 'function'
        ? options.fetchImpl
        : (url, fetchOptions) => global.fetch(url, fetchOptions);
      this.categoryItems = Array.isArray(options.categoryItems) && options.categoryItems.length
        ? options.categoryItems.slice()
        : DEFAULT_CATEGORIES.slice();
      this.defaultCategory = this.categoryItems[0];
      this.categoryButtons = new Map();
      this.activeCategory = this.defaultCategory;
      this.searchQuery = '';
      this.searchInput = options.searchInput || null;
      this.promoTracked = false;
      this.allGames = [];
      this.gamesEndpoint = isNonEmptyString(options.gamesEndpoint)
        ? options.gamesEndpoint.trim()
        : 'js/games.json';
      this.window = options.win || global;
      this.document = options.doc || global.document;
      this.gameUtils = SHARED_GAME_UTILS;
      this.searchUtils = SEARCH_UTILS;
      this.onLangChange = () => this.renderCurrentList('langchange');
    }

    refreshCategoryItemsFromCatalog(){
      const preferred = ['All', 'Arcade', 'Puzzle', 'Shooter', 'Card', 'Action', 'Racing'];
      const discovered = new Set();
      this.allGames.forEach(item => {
        if (!item || !Array.isArray(item.category)) return;
        item.category.forEach(name => {
          if (isNonEmptyString(name)) discovered.add(name.trim());
        });
      });
      const next = [];
      preferred.forEach(name => {
        if (name === this.defaultCategory || discovered.has(name)) next.push(name);
      });
      Array.from(discovered).sort((a, b) => a.localeCompare(b)).forEach(name => {
        if (!next.includes(name)) next.push(name);
      });
      this.categoryItems = next.length ? next : DEFAULT_CATEGORIES.slice();
      this.defaultCategory = this.categoryItems[0] || 'All';
    }

    showLoadingSkeleton(count = 6){
      if (!this.grid) return;
      this.grid.classList.add('is-loading');
      this.grid.setAttribute('aria-busy', 'true');
      const frag = this.document.createDocumentFragment();
      for (let i = 0; i < count; i++){
        const card = this.document.createElement('article');
        card.className = 'card skeleton-card';
        const thumb = this.document.createElement('div');
        thumb.className = 'skeleton-thumb';
        const l1 = this.document.createElement('div');
        l1.className = 'skeleton-line lg';
        const l2 = this.document.createElement('div');
        l2.className = 'skeleton-line';
        const l3 = this.document.createElement('div');
        l3.className = 'skeleton-line sm';
        card.appendChild(thumb);
        card.appendChild(l1);
        card.appendChild(l2);
        card.appendChild(l3);
        frag.appendChild(card);
      }
      this.grid.innerHTML = '';
      this.grid.appendChild(frag);
    }

    clearLoadingSkeleton(){
      if (!this.grid) return;
      this.grid.classList.remove('is-loading');
      this.grid.removeAttribute('aria-busy');
      this.grid.innerHTML = '';
    }

    getLang(){
      if (this.i18n && typeof this.i18n.getLang === 'function'){
        try {
          return this.i18n.getLang();
        } catch (err) {}
      }
      return 'en';
    }

    t(key){
      if (this.i18n && typeof this.i18n.t === 'function'){
        try {
          return this.i18n.t(key);
        } catch (err) {}
      }
      return key;
    }

    normalizeList(rawList){
      if (this.catalog && typeof this.catalog.normalizeGameList === 'function'){
        return this.catalog.normalizeGameList(rawList);
      }
      if (!Array.isArray(rawList)) return [];
      return rawList.filter(Boolean);
    }

    resolveTitle(item, lang){
      if (!item) return '';
      const block = asLocaleBlock(item.title);
      return block[lang] || block.en || '';
    }

    resolveDescription(item, lang){
      if (!item) return '';
      const block = asLocaleBlock(item.description);
      return block[lang] || block.en || '';
    }

    isPlayable(item){
      if (this.gameUtils && typeof this.gameUtils.isPlayable === 'function'){
        return this.gameUtils.isPlayable(item, this.window.location.href);
      }
      if (!item || !item.source) return false;
      if (item.source.type === 'placeholder') return false;
      if (isNonEmptyString(item.source.page)){
        return !!this.sanitizeSelfPage(item.source.page);
      }
      if (item.source.type === 'distributor'){
        const embed = item.source.embedUrl || item.source.url;
        if (!isNonEmptyString(embed)) return false;
        try {
          const parsed = new URL(embed, this.window.location.href);
          return ['http:', 'https:'].includes(parsed.protocol);
        } catch (err) {
          return false;
        }
      }
      return false;
    }

    sortGames(list){
      if (!Array.isArray(list)) return [];
      const lang = this.getLang();
      return list.slice().sort((a, b) => {
        const aPlayable = this.isPlayable(a);
        const bPlayable = this.isPlayable(b);
        if (aPlayable !== bPlayable) return aPlayable ? -1 : 1;
        const titleA = this.resolveTitle(a, lang).toLowerCase();
        const titleB = this.resolveTitle(b, lang).toLowerCase();
        return titleA.localeCompare(titleB);
      });
    }

    safeImageUrl(url){
      if (!isNonEmptyString(url)) return null;
      try {
        const parsed = new URL(url, this.window.location.href);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        return parsed.href;
      } catch (err) {
        return null;
      }
    }

    applyThumbnail(el, item){
      if (!el) return;
      const url = item && item.thumbnail ? this.safeImageUrl(item.thumbnail) : null;
      if (url){
        el.style.setProperty('--thumb-image', `url("${url.replace(/"/g, '%22')}")`);
      } else {
        el.style.removeProperty('--thumb-image');
      }
    }

    sanitizeSelfPage(page){
      if (this.gameUtils && typeof this.gameUtils.sanitizeSelfPage === 'function'){
        return this.gameUtils.sanitizeSelfPage(page, this.window.location.href);
      }
      if (!isNonEmptyString(page)) return null;
      try {
        const url = new URL(page, this.window.location.href);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        if (url.origin !== this.window.location.origin) return null;
        return url;
      } catch (err){ return null; }
    }

    playableHref(item, lang){
      if (!item || !item.source) return null;
      const slug = item.slug || item.id || '';
      if (item.source.page){
        const url = this.sanitizeSelfPage(item.source.page);
        if (!url) return null;
        url.searchParams.set('lang', lang);
        if (slug) url.searchParams.set('slug', slug);
        return url.toString();
      }
      if (item.source.type === 'distributor'){
        try {
          const url = new URL('game.html', this.window.location.href);
          url.searchParams.set('slug', slug);
          url.searchParams.set('lang', lang);
          return url.toString();
        } catch (err){ return null; }
      }
      return null;
    }

    createPlayableCard(item, lang, href){
      const link = this.document.createElement('a');
      link.className = 'card';
      link.href = href;

      const thumb = this.document.createElement('div');
      thumb.className = 'thumb';
      this.applyThumbnail(thumb, item);
      link.appendChild(thumb);

      const body = this.document.createElement('div');
      body.className = 'card-body';

      const title = this.document.createElement('div');
      title.className = 'title';
      title.textContent = this.resolveTitle(item, lang);
      body.appendChild(title);

      const subtitle = this.document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = this.resolveDescription(item, lang);
      body.appendChild(subtitle);

      const meta = this.document.createElement('div');
      meta.className = 'card-meta';
      const category = this.document.createElement('span');
      category.className = 'label';
      category.textContent = item && Array.isArray(item.category) && item.category[0] ? item.category[0] : this.t('playChip');
      meta.appendChild(category);
      body.appendChild(meta);

      const action = this.document.createElement('span');
      action.className = 'play-button';
      action.textContent = this.t('playChip') || 'PLAY';

      link.appendChild(body);
      link.appendChild(action);

      return link;
    }

    createPlaceholderCard(item, lang){
      const el = this.document.createElement('article');
      el.className = 'card';
      const ucText = lang === 'pl' ? 'Więcej informacji wkrótce' : 'More details available soon';

      const thumb = this.document.createElement('div');
      thumb.className = 'thumb';
      this.applyThumbnail(thumb, item);
      el.appendChild(thumb);

      const body = this.document.createElement('div');
      body.className = 'card-body';

      const title = this.document.createElement('div');
      title.className = 'title';
      title.textContent = this.resolveTitle(item, lang);
      body.appendChild(title);

      const subtitle = this.document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = this.resolveDescription(item, lang) || ucText;
      body.appendChild(subtitle);

      const meta = this.document.createElement('div');
      meta.className = 'card-meta';
      const category = this.document.createElement('span');
      category.className = 'label';
      category.textContent = item && Array.isArray(item.category) && item.category[0] ? item.category[0] : 'Soon';
      meta.appendChild(category);
      body.appendChild(meta);

      el.appendChild(body);

      const uc = this.document.createElement('div');
      uc.className = 'uc';
      uc.textContent = ucText;
      el.appendChild(uc);

      return el;
    }

    createHeroCard(featured, lang){
      const href = featured ? this.playableHref(featured, lang) : null;
      const promo = this.document.createElement(href ? 'a' : 'article');
      promo.className = 'hero-card';
      promo.setAttribute('aria-label', 'Featured arcade game');
      if (href) promo.href = href;

      const copy = this.document.createElement('div');
      copy.className = 'hero-copy';

      const kicker = this.document.createElement('span');
      kicker.className = 'hero-kicker';
      kicker.textContent = lang === 'pl' ? 'Dzienny bonus' : 'Daily Bonus';
      copy.appendChild(kicker);

      const title = this.document.createElement('h2');
      title.textContent = featured ? this.resolveTitle(featured, lang) : 'Arcade Hub';
      copy.appendChild(title);

      const text = this.document.createElement('p');
      text.textContent = featured ? this.resolveDescription(featured, lang) : (lang === 'pl' ? 'Wybierz grę i wskocz do akcji.' : 'Pick a game and jump into the action.');
      copy.appendChild(text);

      const action = this.document.createElement('span');
      action.className = 'hero-action';
      action.textContent = this.t('playChip') || 'PLAY';
      copy.appendChild(action);

      promo.appendChild(copy);

      const art = this.document.createElement('div');
      art.className = 'hero-art';
      if (featured) this.applyThumbnail(art, featured);
      promo.appendChild(art);

      return promo;
    }

    trackAdImpression(){
      if (this.promoTracked) return;
      this.promoTracked = true;
      if (this.analytics && typeof this.analytics.adImpression === 'function'){
        this.analytics.adImpression({ slot: 'portal_promo', page: 'index' });
      }
    }

    renderList(list, reason, category){
      if (!this.grid) return;
      this.grid.classList.remove('is-loading');
      this.grid.removeAttribute('aria-busy');
      const lang = this.getLang();
      const sortedList = this.sortGames(list);
      const fragment = this.document.createDocumentFragment();
      fragment.appendChild(this.createHeroCard(sortedList[0] || null, lang));
      for (const item of sortedList){
        const href = this.playableHref(item, lang);
        fragment.appendChild(href ? this.createPlayableCard(item, lang, href) : this.createPlaceholderCard(item, lang));
      }
      this.grid.innerHTML = '';
      this.grid.appendChild(fragment);
      this.trackAdImpression();
      if (this.analytics && typeof this.analytics.viewGameList === 'function'){
        this.analytics.viewGameList({
          game_count: sortedList.length,
          lang,
          reason: reason || 'refresh',
          category: category || this.defaultCategory
        });
      }
    }

    normalizeCategory(raw){
      if (!isNonEmptyString(raw)) return this.defaultCategory;
      const match = this.categoryItems.find(name => name.toLowerCase() === raw.trim().toLowerCase());
      return match || this.defaultCategory;
    }

    filterByCategory(list, category){
      if (!Array.isArray(list)) return [];
      if (!category || category === this.defaultCategory) return list;
      return list.filter(item => item && Array.isArray(item.category) && item.category.includes(category));
    }

    filterBySearch(list, query){
      if (!Array.isArray(list)) return [];
      if (!query || typeof query !== 'string' || !query.trim()) return list;
      if (this.searchUtils && typeof this.searchUtils.filterGamesBySearch === 'function'){
        const lang = this.getLang();
        return this.searchUtils.filterGamesBySearch(list, query, lang);
      }
      return list;
    }

    filterGames(list, category, searchQuery){
      let filtered = this.filterByCategory(list, category);
      filtered = this.filterBySearch(filtered, searchQuery);
      return filtered;
    }

    updateCategoryButtons(){
      if (!this.categoryButtons.size) return;
      this.categoryButtons.forEach((button, name) => {
        const isActive = name === this.activeCategory;
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.classList.toggle('is-active', isActive);
      });
    }

    updateUrl(category, searchQuery){
      try {
        const params = new URLSearchParams(this.window.location.search);
        if (category && category !== this.defaultCategory){
          params.set('category', category);
        } else {
          params.delete('category');
        }
        if (searchQuery && searchQuery.trim()){
          params.set('search', searchQuery.trim());
        } else {
          params.delete('search');
        }
        const query = params.toString();
        const newUrl = `${this.window.location.pathname}${query ? `?${query}` : ''}${this.window.location.hash}`;
        if (this.window.history && typeof this.window.history.replaceState === 'function'){
          this.window.history.replaceState(null, '', newUrl);
        }
      } catch (err) {
        klog('portal:url_update_error', { message: err && err.message ? String(err.message) : 'error' });
      }
    }

    currentCategoryList(){
      return this.filterGames(this.allGames, this.activeCategory, this.searchQuery);
    }

    renderCurrentList(reason){
      this.renderList(this.currentCategoryList(), reason, this.activeCategory);
    }

    handleCategorySelect(name){
      const normalized = this.normalizeCategory(name);
      if (normalized === this.activeCategory) return;
      this.activeCategory = normalized;
      this.updateCategoryButtons();
      this.updateUrl(this.activeCategory, this.searchQuery);
      this.renderCurrentList('category');
      if (this.analytics && typeof this.analytics.event === 'function'){
        this.analytics.event('select_content', { category: this.activeCategory });
      }
    }

    handleSearchInput(value){
      const query = typeof value === 'string' ? value : '';
      if (query === this.searchQuery) return;
      this.searchQuery = query;
      this.updateUrl(this.activeCategory, this.searchQuery);
      this.renderCurrentList('search');
      if (this.analytics && typeof this.analytics.event === 'function'){
        this.analytics.event('search', { search_term: this.searchQuery });
      }
    }

    setupSearchInput(){
      if (!this.searchInput) return;
      const debounced = this.searchUtils && typeof this.searchUtils.debounce === 'function'
        ? this.searchUtils.debounce((value) => this.handleSearchInput(value), 300)
        : (value) => this.handleSearchInput(value);
      this.searchInput.addEventListener('input', (e) => {
        if (e && e.target) debounced(e.target.value);
      });
      this.searchInput.addEventListener('search', (e) => {
        if (e && e.target) this.handleSearchInput(e.target.value);
      });
    }

    getInitialSearch(){
      try {
        const params = new URLSearchParams(this.window.location.search);
        return params.get('search') || '';
      } catch (err) {
        return '';
      }
    }

    buildCategoryBar(){
      if (!this.categoryBar) return;
      this.categoryBar.setAttribute('role', 'toolbar');
      this.categoryBar.innerHTML = '';
      this.categoryButtons.clear();
      this.categoryItems.forEach(name => {
        const button = this.document.createElement('button');
        button.type = 'button';
        button.className = 'category-button';
        button.textContent = name;
        button.dataset.category = name;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => this.handleCategorySelect(name));
        this.categoryButtons.set(name, button);
        this.categoryBar.appendChild(button);
      });
    }

    getInitialCategory(){
      try {
        const params = new URLSearchParams(this.window.location.search);
        return this.normalizeCategory(params.get('category'));
      } catch (err) {
        return this.defaultCategory;
      }
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

renderForCategory(category, reason){
      const target = category || this.defaultCategory;
      const list = this.filterByCategory(this.allGames, target);
      this.renderList(list, reason || 'category', target);
    }

    async init(){
      let catalogError = false;

      this.showLoadingSkeleton(8);

      try {
        // Single source of truth: js/games.json
        this.allGames = await this.loadGames(); // { cache: 'no-cache' } inside
      } catch (err) {
        catalogError = true;
        klog('portal:catalog_load_error', { message: err && err.message ? String(err.message) : 'error' });
        this.allGames = [];
      }

      // Build the category bar even if the catalog failed (keeps UI usable)
      if (!catalogError) this.refreshCategoryItemsFromCatalog();
      this.buildCategoryBar();
      if (catalogError){
        this.clearLoadingSkeleton();
        return;
      }

      this.activeCategory = this.getInitialCategory();
      this.searchQuery = this.getInitialSearch();
      this.updateCategoryButtons();
      this.updateUrl(this.activeCategory, this.searchQuery);

      // Set initial search input value from URL
      if (this.searchInput && this.searchQuery) {
        this.searchInput.value = this.searchQuery;
      }

      // Setup search input event listeners
      this.setupSearchInput();

      this.clearLoadingSkeleton();

      // Ensure homepage grid renders immediately
      this.renderCurrentList('init');

      // Re-render on language change
      this.document.addEventListener('langchange', this.onLangChange);
    }
  }

  // Expose on window (tests read window.PortalApp and DEFAULT_CATEGORIES)
  PortalApp.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
  global.PortalApp = PortalApp;
})(window);
