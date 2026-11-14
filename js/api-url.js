(function(){
  'use strict';
  window.ArcadeApi = {
    url: function(path){
      var config = window.MOBILE_POKER_CONFIG;
      if (!config) return path;
      if (!window.MobilePokerSecurity) throw new Error('Mobile security configuration missing');
      window.MobilePokerSecurity.validate(config);
      // Only explicit Netlify function requests cross the app-local boundary.
      if (typeof path !== 'string' || path.indexOf('/.netlify/functions/') !== 0 || /[\\\r\n]/.test(path)) return path;
      return config.apiOrigin + path;
    }
  };
})();
