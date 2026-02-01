(function(){
  const doc = document;
  const sidebar = doc.getElementById('sidebar');
  const btn = doc.getElementById('sbToggle');
  if (!sidebar || !btn) return;

  function insertPokerLink(){
    const list = sidebar.querySelector('.sb-list');
    if (!list) return;
    if (list.querySelector('a[data-i18n="navPoker"], a[data-i18n="poker"], a[href="/poker/"], a[href="/poker"]')) return;
    const favoritesLink = list.querySelector('a[data-i18n="favorites"]') || list.querySelector('a[aria-label="Favorites"]') || list.querySelector('a[href*="favorites"]');
    if (!favoritesLink) return;
    const favoritesItem = favoritesLink.closest('li') || favoritesLink.parentNode;
    if (!favoritesItem || !favoritesItem.parentNode) return;

    const item = doc.createElement('li');
    item.className = 'sb-item';

    const link = doc.createElement('a');
    link.className = 'sb-link';
    if (window.location && typeof window.location.pathname === 'string' && window.location.pathname.indexOf('/poker') === 0){
      link.classList.add('is-active');
    }
    link.setAttribute('href', '/poker/');
    link.setAttribute('aria-label', 'Poker');
    link.setAttribute('tabindex', '0');

    const icon = doc.createElement('span');
    icon.className = 'sb-ico';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>';

    const label = doc.createElement('span');
    label.className = 'sb-label';
    label.setAttribute('data-i18n', 'navPoker');
    label.textContent = 'Poker';

    link.appendChild(icon);
    link.appendChild(label);
    item.appendChild(link);
    favoritesItem.parentNode.insertBefore(item, favoritesItem.nextSibling);

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

  insertPokerLink();
  btn.addEventListener('click', toggle);
  window.addEventListener('resize', applyInitial);
  applyInitial();
})();
