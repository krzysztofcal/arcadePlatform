// Data-driven portal using games.json (English as default language)
(function(){
  const grid = document.getElementById('gamesGrid');
  if (!grid) return;

  function getLang(){ return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'en'; }
  function t(key){ return (window.I18N && window.I18N.t && window.I18N.t(key)) || key; }

  function titleOf(item, lang){
    return (item.title && (item.title[lang] || item.title.en)) || item.title || '';
  }
  function descriptionOf(item, lang){
    return (item.description && (item.description[lang] || item.description.en)) || '';
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

  function renderList(list){
    const lang = getLang();
    grid.innerHTML = '';
    // Insert a CLS-safe ad placeholder card at the top of the grid
    const promo = document.createElement('article');
    promo.className = 'card slot-card';
    promo.setAttribute('aria-label', 'Promotional');
    promo.innerHTML = '<span class="slot-badge">Promo</span><div class="slot-box">Reserved slot</div>';
    grid.appendChild(promo);
    for (const item of list){
      const href = playableHref(item, lang);
      if (href){
        grid.appendChild(cardPlayable(item, lang, href));
      } else {
        grid.appendChild(cardPlaceholder(item, lang));
      }
    }
  }

  async function loadGames(){
    try {
      const res = await fetch('js/games.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('Failed to load games.json');
      const data = await res.json();
      if (data && Array.isArray(data.games)) return data.games;
      if (Array.isArray(data)) return data; // fallback if array-only
    } catch (e) {
      // Fallback to old global if present
      if (Array.isArray(window.GAMES)) {
        // Map legacy shape to new minimal shape
        return window.GAMES.map(g=>({
          id: g.id || g.slug || 'game-'+Math.random().toString(36).slice(2),
          slug: g.slug || (g.id || ''),
          title: g.title,
          description: g.subtitle ? g.subtitle : { en: '', pl: '' },
          source: g.href ? { type: 'self', page: g.href } : { type: 'placeholder' }
        }));
      }
      console.error(e);
    }
    return [];
  }

  async function init(){
    const list = await loadGames();
    renderList(list);
    document.addEventListener('langchange', ()=> renderList(list));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
