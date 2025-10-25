(function(){
  if (typeof window === 'undefined') return;

  var CMP_SRC = 'https://fundingchoicesmessages.google.com/i/pub-4054734235779751?ers=1';
  var GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-JRP62LCXYK';
  var ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4054734235779751';

  var cmpRequested = false;
  var analyticsLoaded = false;
  var adsScriptRequested = false;
  var tcfListenerAttached = false;
  var fundingFrameEnsured = false;
  var consentDelegationBound = false;
  var consentFailureNotified = false;

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

  function ensureFundingChoicesFrame(){
    function createFrame(){
      if (window.frames && window.frames['googlefcPresent']) {
        fundingFrameEnsured = true;
        return true;
      }
      var body = document.body;
      if (!body) return false;
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:0;height:0;border:0;display:none';
      iframe.name = 'googlefcPresent';
      body.appendChild(iframe);
      fundingFrameEnsured = true;
      return true;
    }

    if (fundingFrameEnsured && window.frames && window.frames['googlefcPresent']) return;
    if (createFrame()) return;

    var attempts = 0;
    (function retry(){
      if (createFrame()) return;
      if (attempts++ >= 10) return;
      setTimeout(retry, 250);
    })();
  }

  function requestCmp(){
    if (cmpRequested || location.protocol === 'file:') return;
    cmpRequested = true;
    ensureFundingChoicesFrame();
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

  function showConsentUi(){
    ensureFundingChoicesFrame();
    try {
      if (typeof window.__tcfapi === 'function') {
        window.__tcfapi('displayConsentUi', 2, function(){}, null);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function showConsentUiWithRetry(onFailure){
    var attempts = 0;
    var maxAttempts = 20;

    (function retry(){
      if (showConsentUi()) return;
      if (attempts++ >= maxAttempts){
        if (typeof onFailure === 'function') onFailure();
        return;
      }
      setTimeout(retry, 250);
    })();
  }

  function matchesSelector(node, selector){
    if (!node || !selector) return false;
    var fn = node.matches || node.msMatchesSelector || node.webkitMatchesSelector || node.mozMatchesSelector;
    if (!fn) return false;
    try { return fn.call(node, selector); } catch (_) { return false; }
    return false;
  }

  function findManageLink(node){
    var current = node;
    while (current && current !== document){
      if (matchesSelector(current, '#manageCookies, .manage-cookies')) return current;
      current = current.parentElement;
    }
    return null;
  }

  function bindConsentDelegation(){
    if (consentDelegationBound || typeof document === 'undefined') return;
    consentDelegationBound = true;
    document.addEventListener('click', function(event){
      var target = event && event.target ? findManageLink(event.target) : null;
      if (!target) return;
      if (event) event.preventDefault();
      openConsentManager();
    });
  }

  function attachConsentLinks(){
    if (typeof document === 'undefined') return;
    bindConsentDelegation();
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
    ensureFundingChoicesFrame();
    requestCmp();
    setupTcfListener();
    attachConsentLinks();
    try {
      document.addEventListener('langchange', attachConsentLinks);
    } catch (_) {}
  }

  window.loadThirdPartyScripts = function(){
    ensureFundingChoicesFrame();
    requestCmp();
    setupTcfListener();
    loadAnalyticsAndAds();
  };

  window.loadConsentManager = function(){
    ensureFundingChoicesFrame();
    requestCmp();
  };
  function showConsentFallback(){
    if (consentFailureNotified) return;
    consentFailureNotified = true;
    console.warn('Consent manager could not be loaded. Check network or content blockers.');
    if (typeof document === 'undefined'){
      try { alert('Consent manager is unavailable. Please check your connection and try again.'); } catch (_) {}
      return;
    }
    try {
      var body = document.body || document.getElementsByTagName('body')[0];
      if (!body) throw new Error('Missing body');
      var existing = document.getElementById('consent-fallback-message');
      if (existing) return;
      var note = document.createElement('div');
      note.id = 'consent-fallback-message';
      note.setAttribute('role', 'alert');
      note.textContent = 'Consent manager is unavailable. Please check your connection or disable content blockers.';
      note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111827;color:#f9fafb;padding:12px 16px;border-radius:999px;font-size:14px;box-shadow:0 10px 25px rgba(0,0,0,0.35);z-index:2147483647;max-width:90vw;text-align:center;';
      body.appendChild(note);
      setTimeout(function(){
        try { body.removeChild(note); } catch (_) {}
      }, 8000);
    } catch (_) {
      try { alert('Consent manager is unavailable. Please check your connection and try again.'); } catch (__) {}
    }
  }

  function openConsentManager(){
    ensureFundingChoicesFrame();
    requestCmp();
    setupTcfListener();
    if (!showConsentUi()){
      showConsentUiWithRetry(showConsentFallback);
    }
  }

  window.showConsentManager = openConsentManager;
  window.openConsentManager = openConsentManager;
  window.renderGoogleAds = renderPendingAds;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
