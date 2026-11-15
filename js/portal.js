// Portal bootstrap wiring the PortalApp class to the DOM.
(function(){
  const grid = document.getElementById('gamesGrid');
  if (!grid || !window.PortalApp) return;

  const app = new window.PortalApp({
    grid,
    categoryBar: document.getElementById('categoryBar'),
    searchInput: document.getElementById('searchInput'),
    analytics: window.Analytics,
    catalog: window.ArcadeCatalog,
    i18n: window.I18N,
    fetchImpl: (url, options) => window.fetch(url, Object.assign({ cache: 'no-cache' }, options)),
    win: window,
    doc: document
  });

  function setupMobileSearch(){
    const mobileInput = document.getElementById('mobileSearchInput');
    const desktopInput = document.getElementById('searchInput');
    if (!mobileInput || !desktopInput) return;

    mobileInput.addEventListener('input', () => {
      if (desktopInput.value !== mobileInput.value){
        desktopInput.value = mobileInput.value;
        desktopInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    desktopInput.addEventListener('input', () => {
      if (mobileInput.value !== desktopInput.value){
        mobileInput.value = desktopInput.value;
      }
    });
  }

  function setupRandomGame(){
    const randomBtn = document.getElementById('homeRandomBtn');
    if (!randomBtn) return;
    randomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SidebarApp && typeof window.SidebarApp.playRandomGame === 'function'){
        window.SidebarApp.playRandomGame(e);
      } else {
        const link = document.querySelector('.sb-link[data-nav-id="random"]');
        if (link) link.click();
      }
    });
  }

  function renderRecentlyPlayed(){
    const container = document.getElementById('homeRecentlyPlayed');
    const recentGrid = document.getElementById('homeRecentlyPlayedGrid');
    if (!container || !recentGrid || !window.recentlyPlayed) return;

    const recents = window.recentlyPlayed.getRecentGames();
    if (!recents || !recents.length){
      container.hidden = true;
      recentGrid.innerHTML = '';
      return;
    }

    const lang = (window.I18N && window.I18N.getLang ? window.I18N.getLang() : 'pl');
    const slice = recents.slice(0, 6);
    recentGrid.innerHTML = '';
    slice.forEach(game => {
      const a = document.createElement('a');
      a.className = 'card';
      const slug = game.slug || game.id;
      a.href = (window.ArcadeCatalog && typeof window.ArcadeCatalog.playableHref === 'function')
        ? window.ArcadeCatalog.playableHref(game, lang)
        : `/game.html?id=${encodeURIComponent(slug)}`;

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (game.thumbnail){
        thumb.style.setProperty('--thumb-image', `url("${game.thumbnail}")`);
        thumb.style.backgroundImage = `url(${game.thumbnail})`;
      }
      a.appendChild(thumb);

      const body = document.createElement('div');
      body.className = 'card-body';
      const title = document.createElement('div');
      title.className = 'title';
      let name = '';
      if (game.title && typeof game.title === 'object'){
        name = game.title[lang] || game.title.en || game.title.pl || slug;
      } else {
        name = game.title || slug;
      }
      title.textContent = name;
      body.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = game.category || 'Arcade';
      meta.appendChild(label);
      body.appendChild(meta);

      a.appendChild(body);
      recentGrid.appendChild(a);
    });
    container.hidden = false;
  }

  function start(){
    setupMobileSearch();
    setupRandomGame();
    renderRecentlyPlayed();
    document.addEventListener('langchange', renderRecentlyPlayed);

    app.init().catch(err => {
      try {
        if (window.KLog && typeof window.KLog.log === 'function'){
          window.KLog.log('portal:init_error', { message: err && err.message ? String(err.message) : 'error' });
        }
      } catch (_err){}
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
