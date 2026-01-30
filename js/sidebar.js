(function(){
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  function isMobile(){ return matchMedia('(max-width: 820px)').matches; }

  function syncAria(btn){
    if (!btn) return;
    btn.setAttribute('aria-expanded', sidebar.classList.contains('expanded') ? 'true' : 'false');
  }

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
    syncAria(document.getElementById('sbToggle'));
  }

  function toggle(btn){
    if (isMobile()){
      // Toggle drawer open/close
      sidebar.classList.toggle('expanded');
      syncAria(btn);
    } else {
      // Desktop: toggle between collapsed (icons) and expanded (icons+labels overlay)
      if (sidebar.classList.contains('expanded')){
        sidebar.classList.remove('expanded');
        sidebar.classList.add('collapsed');
      } else {
        sidebar.classList.add('expanded');
        sidebar.classList.remove('collapsed');
      }
      syncAria(btn);
    }
  }

  document.addEventListener('click', function(event){
    const btn = event.target && event.target.closest ? event.target.closest('#sbToggle') : null;
    if (!btn) return;
    toggle(btn);
  });
  window.addEventListener('resize', applyInitial);
  applyInitial();
})();
