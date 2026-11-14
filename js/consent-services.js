(function(){
  var GA_ID = 'G-JRP62LCXYK';
  var loaded = {};

  function loadScript(id, src, attrs, onload){
    var existing = document.getElementById(id);
    if (existing) {
      if (typeof onload === 'function') onload();
      return;
    }
    var script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    if (attrs) {
      Object.keys(attrs).forEach(function(name){
        script.setAttribute(name, attrs[name]);
      });
    }
    if (typeof onload === 'function') script.onload = onload;
    document.head.appendChild(script);
  }

  function ensureAnalytics(){
    if (loaded.googleAnalytics) return;
    loaded.googleAnalytics = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    loadScript('ga4-runtime', 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID), null, function(){
      window.gtag('js', new Date());
      window.gtag('config', GA_ID);
    });
  }

  function handleConsent(name, consent){
    if (!consent) return;
    if (name === 'googleAnalytics') ensureAnalytics();
  }

  function syncFromKlaro(){
    if (!window.klaro || !window.klaroConfig || typeof window.klaro.getManager !== 'function') return false;
    var manager = window.klaro.getManager(window.klaroConfig);
    handleConsent('googleAnalytics', manager.getConsent('googleAnalytics'));
    manager.watch({
      update: function(_obj, name, data){
        if (name !== 'consents' || !data) return;
        handleConsent('googleAnalytics', data.googleAnalytics);
        window.dispatchEvent(new CustomEvent('arcadeConsentChanged', { detail: data }));
      },
    });
    return true;
  }

  window.ArcadeConsent = {
    handleConsent: handleConsent,
    syncFromKlaro: syncFromKlaro,
    showManager: function(){
      if (window.klaro && typeof window.klaro.show === 'function') {
        window.klaro.show(window.klaroConfig, true);
        return true;
      }
      return false;
    },
  };

  document.addEventListener('DOMContentLoaded', function(){
    if (syncFromKlaro()) return;
    var attempts = 0;
    var timer = window.setInterval(function(){
      attempts += 1;
      if (syncFromKlaro() || attempts >= 20) window.clearInterval(timer);
    }, 250);
  }, { once: true });
})();
