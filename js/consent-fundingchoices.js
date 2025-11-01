// js/consent-fundingchoices.js
// ArcadePlatform — Consent Mode v2 + Funding Choices glue
// Uses: pub-4054734235779751, GA4: G-JRP62LCXYK

(function initConsent() {
  function ensureGtagStub() {
    var w = window;
    var dl = w.dataLayer = w.dataLayer || [];
    var existing = w.gtag;
    var queued = [];

    if (typeof existing === 'function' && Array.isArray(existing.q)) {
      queued = existing.q.slice();
    }

    function pushToDataLayer() {
      dl.push(arguments);
    }

    w.gtag = pushToDataLayer;

    if (queued.length) {
      for (var i = 0; i < queued.length; i++) {
        dl.push(queued[i]);
      }
    }

    return w.gtag;
  }

  // 0) Consent Mode v2 defaults — must run before any Google tag
  (function setConsentDefaults() {
    var gtag = ensureGtagStub();
    gtag('consent', 'default', {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 2000
    });
  })();

  // 1) Inject Funding Choices script (async) if not already present
  (function loadFundingChoices() {
    if (document.getElementById('fc-script')) return;
    var s = document.createElement('script');
    s.id = 'fc-script';
    s.async = true;
    s.src = 'https://fundingchoicesmessages.google.com/i/pub-4054734235779751?ers=1';
    document.head.appendChild(s);

    // Backward-compat safety (per FC examples)
    function signalGooglefcLoaded(){ /* no-op */ }
    if (!window.frames['__fc_frame']) {
      if (document.body) signalGooglefcLoaded();
      else document.addEventListener('DOMContentLoaded', signalGooglefcLoaded);
    }
  })();

  // 2) Helper: load gtag.js when allowed
  function loadGtagOnce(ga4id) {
    if (document.getElementById('gtag-js')) return;
    var s = document.createElement('script');
    s.id = 'gtag-js';
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga4id);
    document.head.appendChild(s);

    var gtag = ensureGtagStub();
    gtag('js', new Date());
    gtag('config', ga4id);
  }

  // 3) Hook Funding Choices callback to load GA only after consent mode data is ready
  (function registerFCReady() {
    window.googlefc = window.googlefc || {};
    window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
    window.googlefc.callbackQueue.push({
      CONSENT_MODE_DATA_READY: function () {
        try {
          if (window.googlefc && typeof window.googlefc.getGoogleConsentModeValues === 'function') {
            var S = window.googlefc.ConsentModePurposeStatusEnum;
            var cm = window.googlefc.getGoogleConsentModeValues();
            var ok = [S.GRANTED, S.NOT_APPLICABLE, S.NOT_CONFIGURED];

            var allGood =
              ok.includes(cm.adStoragePurposeConsentStatus) &&
              ok.includes(cm.adUserDataPurposeConsentStatus) &&
              ok.includes(cm.adPersonalizationPurposeConsentStatus) &&
              ok.includes(cm.analyticsStoragePurposeConsentStatus);

            // Basic mode: load GA regardless; Stricter mode: only load when allGood
            // Choose one. We’ll go with basic (always load after data ready).
            loadGtagOnce('G-JRP62LCXYK');
          } else {
            // Fallback: still load GA after data ready signal
            loadGtagOnce('G-JRP62LCXYK');
          }
        } catch (e) {
          // As last resort, still load GA
          loadGtagOnce('G-JRP62LCXYK');
        }
      }
    });
  })();

  // 4) “Manage cookies” link — reopen CMP via TCF API
  (function wireManageCookies() {
    // Delegate to handle late-rendered footers
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'manageCookies' || t.matches('[data-manage-cookies]')) {
        e.preventDefault();
        if (typeof window.__tcfapi === 'function') {
          window.__tcfapi('displayConsentUi', 2, function(){});
        } else {
          alert('Consent manager not loaded yet.');
        }
      }
    }, true);
  })();
})();
