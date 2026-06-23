(function(){
  const doc = document;
  const sidebar = doc.getElementById('sidebar');
  const btn = doc.getElementById('sbToggle');
  if (!sidebar || !btn) return;

  const model = window.SidebarModel;
  const state = { isAdmin: false, authWired: false, adminRequestId: 0, bottomNavReady: false, randomInFlight: false };

  function klog(kind, data){
    try {
      if (window && window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function getItems(){
    return model && typeof model.getItems === 'function' ? model.getItems({ isAdmin: state.isAdmin }) : [];
  }

  function getAuthBridge(){
    if (window.SupabaseAuthBridge && typeof window.SupabaseAuthBridge.getAccessToken === 'function'){
      return window.SupabaseAuthBridge;
    }
    return null;
  }

  function getSupabaseClient(){
    if (window.supabaseClient && window.supabaseClient.auth){
      return window.supabaseClient;
    }
    return null;
  }

  async function getAccessToken(){
    try {
      const bridge = getAuthBridge();
      if (bridge){
        return await bridge.getAccessToken();
      }
      const client = getSupabaseClient();
      if (client && client.auth && typeof client.auth.getSession === 'function'){
        const res = await client.auth.getSession();
        const session = res && res.data ? res.data.session : null;
        return session && session.access_token ? session.access_token : null;
      }
    } catch (_err){}
    return null;
  }

  async function refreshAdminVisibility(){
    const requestId = ++state.adminRequestId;
    const token = await getAccessToken();
    if (requestId !== state.adminRequestId) return;
    if (!token){
      if (state.isAdmin){
        state.isAdmin = false;
        render();
      }
      return;
    }
    let nextIsAdmin = false;
    try {
      const res = await fetch('/.netlify/functions/admin-me', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      });
      nextIsAdmin = res.status === 200;
    } catch (err){
      klog('sidebar:admin_check_error', { message: err && err.message ? String(err.message) : 'error' });
    }
    if (requestId !== state.adminRequestId) return;
    if (state.isAdmin !== nextIsAdmin){
      state.isAdmin = nextIsAdmin;
      render();
    }
  }

  function wireAdminVisibility(){
    if (state.authWired) return;
    if (!window.SupabaseAuth || typeof window.SupabaseAuth.onAuthChange !== 'function'){
      setTimeout(wireAdminVisibility, 200);
      return;
    }
    state.authWired = true;
    window.SupabaseAuth.onAuthChange(function(){
      refreshAdminVisibility();
    });
  }

  function ensureList(){
    let nav = sidebar.querySelector('.sb-nav');
    if (!nav){
      nav = doc.createElement('nav');
      nav.className = 'sb-nav';
      sidebar.appendChild(nav);
    }
    let list = nav.querySelector('.sb-list');
    if (!list){
      list = doc.createElement('ul');
      list.className = 'sb-list';
      nav.appendChild(list);
    }
    return list;
  }

  function resolveLabel(item){
    const key = item.labelKey;
    if (key && window.ArcadeI18n && typeof window.ArcadeI18n.t === 'function'){
      const translated = window.ArcadeI18n.t(key);
      if (translated) return translated;
    }
    if (key && window.I18N && typeof window.I18N.t === 'function'){
      const translated = window.I18N.t(key);
      if (translated) return translated;
    }
    return item.fallbackLabel || '';
  }

  function isActive(href){
    if (!href || !window.location || typeof window.location.pathname !== 'string') return false;
    const path = window.location.pathname;
    if (href === '/index.html' && (path === '/' || path === '/index.html')) return true;
    if (href === '/poker/' && (path === '/poker' || path === '/poker/' || path.indexOf('/poker/') === 0)) return true;
    if (href === '/about.en.html' && path.indexOf('/about.') === 0) return true;
    return path === href;
  }

  function render(){
    const list = ensureList();
    const items = getItems();
    list.innerHTML = '';
    items.forEach((item)=>{
      const li = doc.createElement('li');
      li.className = 'sb-item';

      const link = doc.createElement('a');
      link.className = 'sb-link';
      if (item.className) link.classList.add(item.className);
      link.setAttribute('href', item.href || '#');
      link.setAttribute('tabindex', '0');
      if (item.hrefEn) link.setAttribute('data-href-en', item.hrefEn);
      if (item.hrefPl) link.setAttribute('data-href-pl', item.hrefPl);
      if (item.id) link.setAttribute('data-nav-id', item.id);
      if (isActive(item.href)) link.classList.add('is-active');
      if (item.id === 'random'){
        link.addEventListener('click', handleRandomGameClick);
      }

      const icon = doc.createElement('span');
      icon.className = 'sb-ico';
      icon.setAttribute('aria-hidden', 'true');
      if (item.iconSvg) icon.innerHTML = item.iconSvg;

      const label = doc.createElement('span');
      label.className = 'sb-label';
      if (item.labelKey) label.setAttribute('data-i18n', item.labelKey);
      label.textContent = resolveLabel(item);

      link.appendChild(icon);
      link.appendChild(label);
      li.appendChild(link);
      list.appendChild(li);
    });

    renderBottomNav(items);

    if (window.I18N && typeof window.I18N.apply === 'function'){
      const lang = typeof window.I18N.getLang === 'function' ? window.I18N.getLang() : 'en';
      window.I18N.apply(lang, 'api');
    }
  }


  function bottomNavItems(items){
    const wanted = ['home', 'search', 'favorites', 'poker', 'profile'];
    const byId = {};
    items.forEach(function(item){ byId[item.id] = item; });
    byId.search = {
      id: 'search',
      labelKey: 'search',
      fallbackLabel: 'Search',
      href: '#search',
      iconSvg: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m20.7 19.3-4.1-4.1a7.5 7.5 0 1 0-1.4 1.4l4.1 4.1 1.4-1.4ZM5 10.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Z"/></svg>'
    };
    return wanted.map(function(id){ return byId[id]; }).filter(Boolean);
  }

  function renderBottomNav(items){
    if (!doc.body || typeof doc.body.appendChild !== 'function') return;
    if (!doc.querySelector('.shell')) return;
    let nav = doc.getElementById('mobileBottomNav');
    if (!nav){
      nav = doc.createElement('nav');
      nav.id = 'mobileBottomNav';
      nav.className = 'mobile-bottom-nav';
      nav.setAttribute('aria-label', 'Mobile navigation');
      doc.body.appendChild(nav);
    }
    nav.innerHTML = '';
    bottomNavItems(items).forEach(function(item){
      const link = doc.createElement('a');
      link.className = 'mobile-bottom-nav__item';
      link.href = item.href || '#';
      link.setAttribute('data-nav-id', item.id);
      if (item.id !== 'search' && isActive(item.href)) link.classList.add('is-active');
      if (item.id === 'search'){
        link.addEventListener('click', handleBottomSearchClick);
      }

      const icon = doc.createElement('span');
      icon.className = 'mobile-bottom-nav__icon';
      icon.setAttribute('aria-hidden', 'true');
      if (item.iconSvg) icon.innerHTML = item.iconSvg;

      const label = doc.createElement('span');
      label.className = 'mobile-bottom-nav__label';
      if (item.labelKey) label.setAttribute('data-i18n', item.labelKey);
      label.textContent = resolveLabel(item);

      link.appendChild(icon);
      link.appendChild(label);
      nav.appendChild(link);
    });
  }

  function handleBottomSearchClick(event){
    event.preventDefault();
    const search = doc.getElementById('searchInput');
    if (!search) return;
    const box = search.closest ? search.closest('.search-box') : null;
    if (box) box.classList.add('is-expanded');
    search.focus();
  }

  function safeSelfPage(page){
    if (!page || typeof page !== 'string') return null;
    try {
      const url = new URL(page, window.location.href);
      if (url.origin !== window.location.origin) return null;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url;
    } catch (_err){ return null; }
  }

  function playableHref(item){
    if (!item || !item.source) return null;
    const slug = item.slug || item.id || '';
    if (item.source.page){
      const url = safeSelfPage(item.source.page);
      if (!url) return null;
      const lang = window.I18N && typeof window.I18N.getLang === 'function' ? window.I18N.getLang() : 'en';
      url.searchParams.set('lang', lang);
      if (slug) url.searchParams.set('slug', slug);
      return url.toString();
    }
    if (item.source.type === 'distributor'){
      const url = new URL('/game.html', window.location.href);
      if (slug) url.searchParams.set('slug', slug);
      const lang = window.I18N && typeof window.I18N.getLang === 'function' ? window.I18N.getLang() : 'en';
      url.searchParams.set('lang', lang);
      return url.toString();
    }
    return null;
  }

  async function handleRandomGameClick(event){
    event.preventDefault();
    if (state.randomInFlight) return;
    state.randomInFlight = true;
    try {
      const res = await fetch('/js/games.json', { cache: 'no-cache' });
      const data = res && typeof res.json === 'function' ? await res.json() : null;
      let games = data && Array.isArray(data.games) ? data.games : (Array.isArray(data) ? data : []);
      if (window.ArcadeCatalog && typeof window.ArcadeCatalog.normalizeGameList === 'function'){
        games = window.ArcadeCatalog.normalizeGameList(games);
      }
      const playable = games.map(playableHref).filter(Boolean);
      if (playable.length){
        window.location.href = playable[Math.floor(Math.random() * playable.length)];
      }
    } catch (err){
      klog('sidebar:random_game_error', { message: err && err.message ? String(err.message) : 'error' });
    } finally {
      state.randomInFlight = false;
    }
  }

  function isMobile(){ return matchMedia('(max-width: 820px)').matches; }

  function applyInitial(){
    if (isMobile()){
      sidebar.classList.remove('hidden');
      sidebar.classList.remove('collapsed');
      sidebar.classList.remove('expanded');
      // Closed by default on mobile (off-screen) handled by CSS transform; not expanded
    } else {
      // Desktop: icons visible (collapsed) by default
      sidebar.classList.remove('hidden');
      sidebar.classList.add('collapsed');
      sidebar.classList.remove('expanded');
    }
    btn.setAttribute('aria-expanded', sidebar.classList.contains('expanded') ? 'true' : 'false');
  }

  function toggle(){
    if (isMobile()){
      // Toggle drawer open/close
      sidebar.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', sidebar.classList.contains('expanded') ? 'true' : 'false');
    } else {
      // Desktop: toggle between collapsed (icons) and expanded (icons+labels overlay)
      if (sidebar.classList.contains('expanded')){
        sidebar.classList.remove('expanded');
        sidebar.classList.add('collapsed');
      } else {
        sidebar.classList.add('expanded');
        sidebar.classList.remove('collapsed');
      }
      btn.setAttribute('aria-expanded', sidebar.classList.contains('expanded') ? 'true' : 'false');
    }
  }

  render();
  btn.addEventListener('click', toggle);
  window.addEventListener('resize', applyInitial);
  applyInitial();
  wireAdminVisibility();
  refreshAdminVisibility();
})();
