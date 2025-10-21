(function(){
  const GA_ID = 'G-JRP62LCXYK';

  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  try {
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  } catch (err) {
    if (typeof console !== 'undefined' && console && console.debug) console.debug('GA init failed', err);
  }

  function sendEvent(name, params){
    try {
      window.gtag('event', name, params || {});
    } catch (err) {
      if (typeof console !== 'undefined' && console && console.debug) console.debug('GA event failed', name, err);
    }
  }

  function extend(target, source){
    if (!source) return target;
    try { return Object.assign(target, source); } catch (_) { return target; }
  }

  const api = {
    id: GA_ID,
    event: sendEvent,
    viewGameList: (details)=> sendEvent('view_game_list', extend({ source: 'portal' }, details || {})),
    viewGame: (details)=> sendEvent('view_game', extend({}, details || {})),
    startGame: (details)=> sendEvent('start_game', extend({}, details || {})),
    fullscreenToggle: (details)=> sendEvent('fullscreen_toggle', extend({}, details || {})),
    adImpression: (details)=> sendEvent('ad_impression', extend({}, details || {})),
    langChange: (details)=> sendEvent('lang_change', extend({}, details || {}))
  };

  window.Analytics = window.Analytics ? extend(window.Analytics, api) : api;
})();
