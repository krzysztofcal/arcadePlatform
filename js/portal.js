(function(){
  const grid = document.getElementById('gamesGrid');
  if (!grid || !Array.isArray(window.GAMES)) return;

  function getLang(){ return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'en'; }
  function t(key){ return (window.I18N && window.I18N.t && window.I18N.t(key)) || key; }

  function titleOf(item, lang){ return (item.title && (item.title[lang] || item.title.en || item.title.pl)) || item.title || ''; }
  function subtitleOf(item, lang){ return (item.subtitle && (item.subtitle[lang] || item.subtitle.en || item.subtitle.pl)) || item.subtitle || ''; }

  function cardPlayable(item, lang){
    const a = document.createElement('a');
    a.className = 'card';
    const url = new URL(item.href, location.href);
    url.searchParams.set('lang', lang);
    a.href = url.toString();
    a.innerHTML = `
      <div class="thumb"></div>
      <span class="label">${t('playChip')}</span>
      <div class="title">${titleOf(item, lang)}</div>
      <div class="subtitle">${subtitleOf(item, lang)}</div>
    `;
    return a;
  }

  function cardPlaceholder(item, lang){
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <div class="thumb"></div>
      <div class="title">${titleOf(item, lang)}</div>
      <div class="subtitle">${subtitleOf(item, lang) || (lang==='pl'?'W przygotowaniu':'Under construction')}</div>
      <div class="uc">${lang==='pl'?'W przygotowaniu':'Under construction'}</div>
    `;
    return el;
  }

  function render(){
    const lang = getLang();
    grid.innerHTML = '';
    for (const item of window.GAMES){
      const node = item.href ? cardPlayable(item, lang) : cardPlaceholder(item, lang);
      grid.appendChild(node);
    }
  }

  render();
  document.addEventListener('langchange', render);
})();
