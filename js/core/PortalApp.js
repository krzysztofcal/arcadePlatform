(function(global){
  'use strict';

  const DEFAULT_CATEGORIES = Object.freeze(['New/All', 'Arcade', 'Puzzle', 'Shooter', 'Racing']);

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
      this.promoTracked = false;
      this.allGames = [];
      this.gamesEndpoint = isNonEmptyString(options.gamesEndpoint)
        ? options.gamesEndpoint.trim()
        : 'js/games.json';
      this.window = options.win || global;
      this.document = options.doc || global.document;
      this.onLangChange = () => this.renderCurrentList('langchange');
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

      const label = this.document.createElement('span');
      label.className = 'label';
      label.textContent = this.t('playChip');
      link.appendChild(label);

      const title = this.document.createElement('div');
      title.className = 'title';
      title.textContent = this.resolveTitle(item, lang);
      link.appendChild(title);

      const subtitle = this.document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = this.resolveDescription(item, lang);
      link.appendChild(subtitle);

      return link;
    }

    createPlaceholderCard(item, lang){
      const el = this.document.createElement('article');
      el.className = 'card';
      const ucText = lang === 'pl' ? 'W przygotowaniu' : 'Under construction';

      const thumb = this.document.createElement('div');
      thumb.className = 'thumb';
      this.applyThumbnail(thumb, item);
      el.appendChild(thumb);

      const title = this.document.createElement('div');
      title.className = 'title';
      title.textContent = this.resolveTitle(item, lang);
      el.appendChild(title);

      const subtitle = this.document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = this.resolveDescription(item, lang) || ucText;
      el.appendChild(subtitle);

      const uc = this.document.createElement('div');
      uc.className = 'uc';
      uc.textContent = ucText;
      el.appendChild(uc);

      return el;
    }

    createPromoCard(){
      const promo = this.document.createElement('article');
      promo.className = 'card slot-card';
      promo.setAttribute('aria-label', 'Promotional');
      promo.innerHTML = '<span class="slot-badge">Promo</span><div class="slot-box">Reserved slot</div>';
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
      const lang = this.getLang();
      const sortedList = this.sortGames(list);
      const fragment = this.document.createDocumentFragment();
      fragment.appendChild(this.createPromoCard());
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

    updateCategoryButtons(){
      if (!this.categoryButtons.size) return;
      this.categoryButtons.forEach((button, name) => {
        const isActive = name === this.activeCategory;
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.classList.toggle('is-active', isActive);
      });
    }

    updateUrl(category){
      try {
        const params = new URLSearchParams(this.window.location.search);
        if (category && category !== this.defaultCategory){
          params.set('category', category);
        } else {
          params.delete('category');
        }
        const query = params.toString();
        const newUrl = `${this.window.location.pathname}${query ? `?${query}` : ''}${this.window.location.hash}`;
        if (this.window.history && typeof this.window.history.replaceState === 'function'){
          this.window.history.replaceState(null, '', newUrl);
        }
      } catch (err) {
        if (global.console && typeof global.console.debug === 'function'){
          global.console.debug('Failed to update category in URL', err);
        }
      }
    }

    currentCategoryList(){
      return this.filterByCategory(this.allGames, this.activeCategory);
    }

    renderCurrentList(reason){
      this.renderList(this.currentCategoryList(), reason, this.activeCategory);
    }

    handleCategorySelect(name){
      const normalized = this.normalizeCategory(name);
      if (normalized === this.activeCategory) return;
      this.activeCategory = normalized;
      this.updateCategoryButtons();
      this.updateUrl(this.activeCategory);
      this.renderCurrentList('category');
      if (this.analytics && typeof this.analytics.event === 'function'){
        this.analytics.event('select_content', { category: this.activeCategory });
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
      try {
        const res = await this.fetchImpl(this.gamesEndpoint, { cache: 'no-cache' });
        if (!res || (typeof res.ok === 'boolean' && !res.ok)){
          throw new Error('Failed to load games catalog');
        }
        const data = typeof res.json === 'function' ? await res.json() : null;
        if (data && Array.isArray(data.games)) return this.normalizeList(data.games);
        if (Array.isArray(data)) return this.normalizeList(data);
      } catch (err) {
        if (Array.isArray(global.GAMES)){
          const legacy = global.GAMES.map(g => ({
            id: g.id || g.slug || `game-${Math.random().toString(36).slice(2)}`,
            slug: g.slug || g.id || '',
            title: asLocaleBlock(g.title),
            description: asLocaleBlock(g.subtitle),
            thumbnail: g.thumb,
            orientation: g.orientation,
            category: Array.isArray(g.category) ? g.category.slice() : [],
            source: g.href
              ? { type: 'self', page: g.href }
              : { type: 'placeholder' }
          }));
          return this.normalizeList(legacy);
        }
        if (global.console && typeof global.console.error === 'function'){
          global.console.error(err);
        }
      }
      return [];
    }

    async init(){
      this.allGames = await this.loadGames();
      this.buildCategoryBar();
      this.activeCategory = this.getInitialCategory();
      this.updateCategoryButtons();
      this.updateUrl(this.activeCategory);
      this.renderCurrentList('initial');
      this.document.addEventListener('langchange', this.onLangChange);
    }
  }

  PortalApp.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
  global.PortalApp = PortalApp;
})(window);

