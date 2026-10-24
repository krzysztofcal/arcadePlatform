(function(root){
  'use strict';
  var redirectTo = 'arcadepoker-stage://auth/callback';
  function validate(config){
    if (!config || !/^https:\/\/deploy-preview-[1-9][0-9]*--playkcswh\.netlify\.app$/.test(config.apiOrigin) ||
        config.supabaseUrl !== 'https://krydukthwdvccggbyjfw.supabase.co' || config.wsUrl !== 'wss://ws-preview.kcswh.pl/ws') {
      throw new Error('Invalid public Stage configuration');
    }
    return config;
  }
  function publicProfileUrl(config, handle){
    return validate(config).apiOrigin + '/u/' + encodeURIComponent(String(handle || ''));
  }
  function callbackCode(value){
    var url = new URL(value);
    if (url.protocol !== 'arcadepoker-stage:' || url.host !== 'auth' || url.pathname !== '/callback' ||
        url.username || url.password || url.hash || url.searchParams.has('error') ||
        url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code')) throw new Error('Invalid auth callback');
    return url.searchParams.get('code');
  }
  var api = { validate: validate, publicProfileUrl: publicProfileUrl, callbackCode: callbackCode, redirectTo: redirectTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MobilePokerSecurity = api;
})(typeof window !== 'undefined' ? window : globalThis);
