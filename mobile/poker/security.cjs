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
  function forPreview(config, binding, prNumber, sourceSha){
    var origin = 'https://deploy-preview-' + prNumber + '--playkcswh.netlify.app';
    var deploy = binding && binding.netlify;
    if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !/^[a-f0-9]{40}$/.test(sourceSha || '') ||
        !binding || binding.prNumber !== prNumber || binding.sourceSha !== sourceSha || binding.apiOrigin !== origin ||
        !deploy || !/^[a-f0-9]{24}$/.test(deploy.deployId || '') || deploy.sourceSha !== sourceSha ||
        deploy.reviewId !== prNumber || deploy.context !== 'deploy-preview' || deploy.state !== 'ready' ||
        deploy.siteId !== 'f7e19a84-28f7-41f7-978a-f3b4552a404d' || deploy.siteName !== 'playkcswh' || deploy.origin !== origin) {
      throw new Error('Invalid verified Preview binding');
    }
    return validate(Object.assign({}, config, { apiOrigin: origin }));
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
  var api = { validate: validate, forPreview: forPreview, publicProfileUrl: publicProfileUrl, callbackCode: callbackCode, redirectTo: redirectTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MobilePokerSecurity = api;
})(typeof window !== 'undefined' ? window : globalThis);
