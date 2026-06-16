(function(){
  var GA_ID = 'G-JRP62LCXYK';
  var ADS_CLIENT = 'ca-pub-4054734235779751';
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

  function initAds(){
    if (!Array.isArray(window.adsbygoogle)) return false;
    var slots = document.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status]):not([data-ad-init="1"])');
    slots.forEach(function(slot){
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        slot.setAttribute('data-ad-init', '1');
      } catch (_err) {}
    });
    return true;
  }

  function scheduleAds(){
    if (initAds()) return;
    var attempts = 0;
    var timer = window.setInterval(function(){
      attempts += 1;
      if (initAds() || attempts >= 20) window.clearInterval(timer);
    }, 500);
  }

  function ensureAds(){
    if (loaded.googleAds) {
      scheduleAds();
      return;
    }
    loaded.googleAds = true;
    loadScript(
      'adsense-runtime',
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADS_CLIENT),
      { crossorigin: 'anonymous' },
      scheduleAds
    );
  }

  function handleConsent(name, consent){
    if (!consent) return;
    if (name === 'googleAnalytics') ensureAnalytics();
    if (name === 'googleAds') ensureAds();
  }

  function syncFromKlaro(){
    if (!window.klaro || !window.klaroConfig || typeof window.klaro.getManager !== 'function') return false;
    var manager = window.klaro.getManager(window.klaroConfig);
    handleConsent('googleAnalytics', manager.getConsent('googleAnalytics'));
    handleConsent('googleAds', manager.getConsent('googleAds'));
    manager.watch({
      update: function(_obj, name, data){
        if (name !== 'consents' || !data) return;
        handleConsent('googleAnalytics', data.googleAnalytics);
        handleConsent('googleAds', data.googleAds);
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
