(function(){
  const doc = document;
  const sidebar = doc.getElementById('sidebar');
  const btn = doc.getElementById('sbToggle');
  if (!sidebar || !btn) return;

  const model = window.SidebarModel;
  const items = model && typeof model.getItems === 'function' ? model.getItems() : [];

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
      if (isActive(item.href)) link.classList.add('is-active');

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

    if (window.I18N && typeof window.I18N.apply === 'function'){
      const lang = typeof window.I18N.getLang === 'function' ? window.I18N.getLang() : 'en';
      window.I18N.apply(lang, 'api');
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
})();
