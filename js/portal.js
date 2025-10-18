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

  function playableHref(item){
    if (!item || !item.source) return null;
    if (item.source.type === 'self' && item.source.page) return item.source.page;
    if (item.source.type === 'distributor' && item.source.embedUrl) return item.source.embedUrl;
    return null;
  }

  function cardPlayable(item, lang){
    const a = document.createElement('a');
    a.className = 'card';
    const href = playableHref(item);
    const url = new URL(href, location.href);
    url.searchParams.set('lang', lang);
    a.href = url.toString();
    a.innerHTML = `
      <div class="thumb"></div>
      <span class="label">${t('playChip')}</span>
      <div class="title">${titleOf(item, lang)}</div>
      <div class="subtitle">${descriptionOf(item, lang)}</div>
    `;
    return a;
  }

  function cardPlaceholder(item, lang){
    const el = document.createElement('article');
    el.className = 'card';
    const desc = descriptionOf(item, lang) || (lang==='pl'?'W przygotowaniu':'Under construction');
    el.innerHTML = `
      <div class="thumb"></div>
      <div class="title">${titleOf(item, lang)}</div>
      <div class="subtitle">${desc}</div>
      <div class="uc">${desc}</div>
    `;
    return el;
  }

  function renderList(list){
    const lang = getLang();
    grid.innerHTML = '';
    for (const item of list){
      const href = playableHref(item);
      const node = href ? cardPlayable(item, lang) : cardPlaceholder(item, lang);
      grid.appendChild(node);
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
