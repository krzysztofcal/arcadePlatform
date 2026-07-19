(function(){
  if (typeof document === 'undefined') return;

  function matchesSelector(node, selector){
    if (!node || !selector) return false;
    var fn = node.matches || node.msMatchesSelector || node.webkitMatchesSelector || node.mozMatchesSelector;
    if (!fn) return false;
    try { return fn.call(node, selector); } catch (_err) { return false; }
  }

  function findManageLink(start){
    var current = start;
    while (current && current !== document){
      if (matchesSelector(current, '#manageCookies, .manage-cookies, [data-manage-cookies]')) return current;
      current = current.parentElement;
    }
    return null;
  }

  function showManager(){
    if (window.ArcadeConsent && typeof window.ArcadeConsent.showManager === 'function') {
      return window.ArcadeConsent.showManager();
    }
    if (window.klaro && typeof window.klaro.show === 'function') {
      window.klaro.show(window.klaroConfig, true);
      return true;
    }
    return false;
  }

  function notifyUnavailable(){
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn('Consent manager not loaded yet.');
    }
    try { alert('Consent manager not loaded yet.'); } catch (_err) {}
  }

  function syncNetlifyDrawerState(){
    var active = !!document.querySelector('[data-netlify-deploy-id] iframe[src^="https://app.netlify.com/"]');
    document.documentElement.classList.toggle('netlify-drawer-active', active);
  }

  syncNetlifyDrawerState();
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(syncNetlifyDrawerState).observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('click', function(event){
    var link = findManageLink(event && event.target);
    if (!link) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!showManager()) notifyUnavailable();
  }, { passive: false });
})();
