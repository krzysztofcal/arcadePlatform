(function(){
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sbToggle');
  if (!sidebar || !btn) return;

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

  btn.addEventListener('click', toggle);
  window.addEventListener('resize', applyInitial);
  applyInitial();
})();
