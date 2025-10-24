(function(){
  if (typeof window === 'undefined') return;

  var CMP_SRC = 'https://fundingchoicesmessages.google.com/i/pub-4054734235779751?ers=1';
  var GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-JRP62LCXYK';
  var ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4054734235779751';

  var cmpRequested = false;
  var analyticsLoaded = false;
  var adsScriptRequested = false;
  var tcfListenerAttached = false;

  function getHead(){
    return document.head || document.getElementsByTagName('head')[0];
  }

  function injectScript(src, opts){
    var head = getHead();
    if (!head) return null;
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    if (opts && opts.crossOrigin) s.crossOrigin = opts.crossOrigin;
    head.appendChild(s);
    return s;
  }

  function requestCmp(){
    if (cmpRequested || location.protocol === 'file:') return;
    cmpRequested = true;
    injectScript(CMP_SRC);
  }

  function renderPendingAds(){
    if (typeof document === 'undefined') return;
    var slots = document.querySelectorAll('ins.adsbygoogle[data-ad-client]:not([data-adsbygoogle-status])');
    if (!slots.length) return;
    var queue = window.adsbygoogle = window.adsbygoogle || [];
    slots.forEach(function(slot){
      var slotId = slot.getAttribute('data-ad-slot');
      if (!slotId || !/^\d+$/.test(String(slotId))) return;
      queue.push({});
    });
  }

  function loadAdSense(){
    if (adsScriptRequested) {
      renderPendingAds();
      return;
    }
    adsScriptRequested = true;
    var script = injectScript(ADSENSE_SRC, { crossOrigin: 'anonymous' });
    if (script) {
      script.addEventListener('load', renderPendingAds, { once: false });
    }
  }

  function loadAnalyticsAndAds(){
    if (analyticsLoaded) {
      renderPendingAds();
      return;
    }
    analyticsLoaded = true;
    injectScript(GTAG_SRC);
    loadAdSense();
  }

  function hasMeasurementConsent(tcData){
    if (!tcData) return false;
    if (tcData.gdprApplies === false || tcData.gdprApplies === 0 || tcData.gdprApplies === '0') return true;
    var purposes = tcData.purpose && tcData.purpose.consents;
    if (!purposes) return false;
    return purposes['1'] === true || purposes[1] === true;
  }

  function handleConsent(tcData){
    if (analyticsLoaded) return;
    if (hasMeasurementConsent(tcData)) {
      loadAnalyticsAndAds();
    }
  }

  function setupTcfListener(){
    if (tcfListenerAttached) return;
    tcfListenerAttached = true;
    var attempts = 0;
    var maxAttempts = 40;

    (function tryRegister(){
      if (typeof window.__tcfapi !== 'function') {
        if (attempts++ >= maxAttempts) return;
        setTimeout(tryRegister, 200);
        return;
      }
      try {
        window.__tcfapi('addEventListener', 2, function(tcData, success){
          if (!success || !tcData) return;
          if (tcData.eventStatus === 'tcloaded' || tcData.eventStatus === 'useractioncomplete' || tcData.eventStatus === 'cmpuishown') {
            handleConsent(tcData);
          }
        });
        window.__tcfapi('getTCData', 2, function(tcData, success){
          if (success && tcData) handleConsent(tcData);
        }, null);
      } catch (err) {
        if (attempts++ >= maxAttempts) return;
        setTimeout(tryRegister, 200);
      }
    })();
  }

  function onReady(){
    if (location.protocol === 'file:') return;
    requestCmp();
    setupTcfListener();
  }

  window.loadThirdPartyScripts = function(){
    requestCmp();
    setupTcfListener();
    loadAnalyticsAndAds();
  };

  window.loadConsentManager = requestCmp;
  window.renderGoogleAds = renderPendingAds;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
