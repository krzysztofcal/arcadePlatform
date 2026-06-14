(function(){
  function initAds(){
    if (!Array.isArray(window.adsbygoogle)) return false;
    var slots = document.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status]):not([data-ad-init="1"])');
    if (!slots.length) return true;
    slots.forEach(function(slot){
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        slot.setAttribute('data-ad-init', '1');
      } catch (_err) {
        // Retry later after the AdSense runtime finishes bootstrapping.
      }
    });
    return true;
  }

  function scheduleInit(){
    if (initAds()) return;
    var attempts = 0;
    var timer = window.setInterval(function(){
      attempts += 1;
      if (initAds() || attempts >= 20) window.clearInterval(timer);
    }, 500);
  }

  document.addEventListener('DOMContentLoaded', scheduleInit, { once: true });
  window.addEventListener('CookiebotOnConsentReady', scheduleInit);
  window.addEventListener('CookiebotOnAccept', scheduleInit);
})();