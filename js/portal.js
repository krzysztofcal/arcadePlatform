// Data-driven portal using games.json (English as default language)
(function(){
  const grid = document.getElementById('gamesGrid');
  if (!grid) return;

  const categoryBar = document.getElementById('categoryBar');
  const CATEGORY_ITEMS = ['New/All', 'Arcade', 'Puzzle', 'Shooter', 'Racing'];
  const CATEGORY_DEFAULT = CATEGORY_ITEMS[0];
  const categoryButtons = new Map();
  let activeCategory = CATEGORY_DEFAULT;
  let allGames = [];

  const analytics = window.Analytics;
  const catalog = window.ArcadeCatalog;
  let promoTracked = false;

  function normalizeList(rawList){
    if (catalog && typeof catalog.normalizeGameList === 'function'){
      return catalog.normalizeGameList(rawList);
    }
    return Array.isArray(rawList) ? rawList.filter(Boolean) : [];
  }

  function getLang(){ return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'en'; }
  function t(key){ return (window.I18N && window.I18N.t && window.I18N.t(key)) || key; }

  function titleOf(item, lang){
    return (item.title && (item.title[lang] || item.title.en)) || item.title || '';
  }
  function descriptionOf(item, lang){
    return (item.description && (item.description[lang] || item.description.en)) || '';
  }

  function safeImageUrl(url){
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url, location.href);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      return parsed.href;
    } catch (e) {
      return null;
    }
  }

  function applyThumbnail(el, item){
    if (!el) return;
    const url = item && item.thumbnail ? safeImageUrl(item.thumbnail) : null;
    if (url){
      el.style.setProperty('--thumb-image', `url("${url.replace(/"/g, '%22')}")`);
    } else {
      el.style.removeProperty('--thumb-image');
    }
  }

  function sanitizeSelfPage(page){
    if (!page) return null;
    try {
      const url = new URL(page, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.origin !== location.origin) return null;
      return url;
    } catch (e) {
      return null;
    }
  }

  function playableHref(item, lang){
    if (!item || !item.source) return null;
    if (item.source.type === 'self' && item.source.page){
      const url = sanitizeSelfPage(item.source.page);
      if (!url) return null;
      url.searchParams.set('lang', lang);
      return url.toString();
    }
    if (item.source.type === 'distributor'){
      // Route distributor games through local frame page to keep header/CMP
      try {
        const url = new URL('game.html', location.href);
        url.searchParams.set('slug', item.slug || item.id || '');
        url.searchParams.set('lang', lang);
        return url.toString();
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function cardPlayable(item, lang, href){
    const a = document.createElement('a');
    a.className = 'card';
    a.href = href;

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    applyThumbnail(thumb, item);
    a.appendChild(thumb);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t('playChip');
    a.appendChild(label);

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = titleOf(item, lang);
    a.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = descriptionOf(item, lang);
    a.appendChild(subtitle);

    return a;
  }

  function cardPlaceholder(item, lang){
    const el = document.createElement('article');
    el.className = 'card';
    const desc = descriptionOf(item, lang) || '';
    const ucText = (lang==='pl'?'W przygotowaniu':'Under construction');
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    applyThumbnail(thumb, item);
    el.appendChild(thumb);

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = titleOf(item, lang);
    el.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = desc || ucText;
    el.appendChild(subtitle);

    const uc = document.createElement('div');
    uc.className = 'uc';
    uc.textContent = ucText;
    el.appendChild(uc);

    return el;
  }

  function trackAdImpression(){
    if (promoTracked) return;
    promoTracked = true;
    if (analytics && analytics.adImpression){
      analytics.adImpression({ slot: 'portal_promo', page: 'index' });
    }
  }

  function renderList(list, reason, category){
    const lang = getLang();
    grid.innerHTML = '';
    // Insert a CLS-safe ad placeholder card at the top of the grid
    const promo = document.createElement('article');
    promo.className = 'card slot-card';
    promo.setAttribute('aria-label', 'Promotional');
    promo.innerHTML = '<span class="slot-badge">Promo</span><div class="slot-box">Reserved slot</div>';
    grid.appendChild(promo);
    trackAdImpression();
    for (const item of list){
      const href = playableHref(item, lang);
      if (href){
        grid.appendChild(cardPlayable(item, lang, href));
      } else {
        grid.appendChild(cardPlaceholder(item, lang));
      }
    }
    if (analytics && analytics.viewGameList){
      analytics.viewGameList({
        game_count: list.length,
        lang,
        reason: reason || 'refresh',
        category: category || CATEGORY_DEFAULT
      });
    }
  }

  function normalizeCategory(raw){
    if (!raw || typeof raw !== 'string') return CATEGORY_DEFAULT;
    const match = CATEGORY_ITEMS.find(name => name.toLowerCase() === raw.trim().toLowerCase());
    return match || CATEGORY_DEFAULT;
  }

  function filterByCategory(list, category){
    if (!Array.isArray(list)) return [];
    if (!category || category === CATEGORY_DEFAULT) return list;
    return list.filter(item => item && Array.isArray(item.category) && item.category.includes(category));
  }

  function updateCategoryButtons(){
    if (!categoryButtons.size) return;
    categoryButtons.forEach((button, name) => {
      const isActive = name === activeCategory;
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      if (isActive){
        button.classList.add('is-active');
      } else {
        button.classList.remove('is-active');
      }
    });
  }

  function updateUrl(category){
    try {
      const params = new URLSearchParams(window.location.search);
      if (category && category !== CATEGORY_DEFAULT){
        params.set('category', category);
      } else {
        params.delete('category');
      }
      const query = params.toString();
      const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', newUrl);
    } catch (err) {
      if (typeof console !== 'undefined' && console && console.debug){
        console.debug('Failed to update category in URL', err);
      }
    }
  }

  function currentCategoryList(){
    return filterByCategory(allGames, activeCategory);
  }

  function rerender(reason){
    renderList(currentCategoryList(), reason, activeCategory);
  }

  function handleCategorySelect(name){
    const normalized = normalizeCategory(name);
    if (normalized === activeCategory) return;
    activeCategory = normalized;
    updateCategoryButtons();
    updateUrl(activeCategory);
    rerender('category');
    if (analytics && typeof analytics.event === 'function'){
      analytics.event('select_content', { category: activeCategory });
    }
  }

  function buildCategoryBar(){
    if (!categoryBar) return;
    categoryBar.setAttribute('role', 'toolbar');
    categoryBar.innerHTML = '';
    categoryButtons.clear();
    CATEGORY_ITEMS.forEach(name => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-button';
      button.textContent = name;
      button.setAttribute('aria-pressed', 'false');
      button.dataset.category = name;
      button.addEventListener('click', () => handleCategorySelect(name));
      categoryButtons.set(name, button);
      categoryBar.appendChild(button);
    });
  }

  function getInitialCategory(){
    try {
      const params = new URLSearchParams(window.location.search);
      return normalizeCategory(params.get('category'));
    } catch (err) {
      return CATEGORY_DEFAULT;
    }
  }

  async function loadGames(){
    try {
      const res = await fetch('js/games.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('Failed to load games.json');
      const data = await res.json();
      if (data && Array.isArray(data.games)) return normalizeList(data.games);
      if (Array.isArray(data)) return normalizeList(data); // fallback if array-only
    } catch (e) {
      // Fallback to old global if present
      if (Array.isArray(window.GAMES)) {
        // Map legacy shape to new minimal shape
        return normalizeList(window.GAMES.map(g=>({
          id: g.id || g.slug || 'game-'+Math.random().toString(36).slice(2),
          slug: g.slug || (g.id || ''),
          title: g.title,
          description: g.subtitle ? g.subtitle : { en: '', pl: '' },
          thumbnail: g.thumb,
          orientation: g.orientation,
          source: g.href ? { type: 'self', page: g.href } : { type: 'placeholder' }
        })));
      }
      console.error(e);
    }
    return [];
  }

  async function init(){
    allGames = await loadGames();
    buildCategoryBar();
    activeCategory = getInitialCategory();
    updateCategoryButtons();
    updateUrl(activeCategory);
    rerender('initial');
    document.addEventListener('langchange', ()=> rerender('langchange'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
