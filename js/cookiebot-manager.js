(function(){
  if (typeof document === 'undefined') return;

  function matchesSelector(node, selector){
    if (!node || !selector) return false;
    var fn = node.matches || node.msMatchesSelector || node.webkitMatchesSelector || node.mozMatchesSelector;
    if (!fn) return false;
    try {
      return fn.call(node, selector);
    } catch (err) {
      return false;
    }
  }

  function findManageLink(start){
    var current = start;
    while (current && current !== document){
      if (matchesSelector(current, '#manageCookies, .manage-cookies')) return current;
      current = current.parentElement;
    }
    return null;
  }

  function reopenCookiebot(){
    if (typeof window === 'undefined') return false;
    if (!window.Cookiebot) return false;
    try {
      if (typeof window.Cookiebot.show === 'function') {
        window.Cookiebot.show();
        return true;
      }
      if (typeof window.Cookiebot.renew === 'function') {
        window.Cookiebot.renew();
        return true;
      }
    } catch (err) {}
    return false;
  }

  function notifyUnavailable(){
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn('Consent manager not loaded yet.');
    }
    try { alert('Consent manager not loaded yet.'); } catch (err) {}
  }

  document.addEventListener('click', function(event){
    var link = findManageLink(event && event.target);
    if (!link) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!reopenCookiebot()) {
      notifyUnavailable();
    }
  }, { passive: false });
})();
