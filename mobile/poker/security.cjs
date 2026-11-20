(function(root){
  'use strict';
  var stageRedirectTo = 'arcadepoker-stage://auth/callback';
  var productionRedirectTo = 'https://play.kcswh.pl/app/auth/callback';
  var redirectTo = stageRedirectTo;

  var expectedRefs = {
    stage: 'krydukthwdvccggbyjfw',
    production: 'otbqfijerkieoxwpxjnm'
  };

  function validate(config){
    if (!config || !/^https:\/\/deploy-preview-[1-9][0-9]*--playkcswh\.netlify\.app$/.test(config.apiOrigin) ||
        config.supabaseUrl !== 'https://krydukthwdvccggbyjfw.supabase.co' || config.wsUrl !== 'wss://ws-preview.kcswh.pl/ws') {
      throw new Error('Invalid public Stage configuration');
    }
    return config;
  }
  function validateProduction(config){
    if (!config || config.apiOrigin !== 'https://play.kcswh.pl' ||
        config.supabaseUrl !== 'https://otbqfijerkieoxwpxjnm.supabase.co' || config.wsUrl !== 'wss://ws.kcswh.pl/ws') {
      throw new Error('Invalid public Production configuration');
    }
    return config;
  }
  function channel(config){
    try {
      validate(config);
      return 'stage';
    } catch (_e) {
      // Not stage, try production
    }
    validateProduction(config);
    return 'production';
  }
  function redirectFor(ch){
    if (ch === 'stage') return stageRedirectTo;
    if (ch === 'production') return productionRedirectTo;
    throw new Error('Unknown channel: ' + ch);
  }
  function decodePayload(jwt){
    if (typeof jwt !== 'string') throw new Error('Invalid public anon key');
    var parts = jwt.split('.');
    if (parts.length !== 3 || !parts[1]) throw new Error('Invalid public anon key');
    var part = parts[1];
    var json;
    try {
      if (typeof atob === 'function') {
        var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        json = atob(b64);
      } else if (typeof Buffer !== 'undefined') {
        json = Buffer.from(part, 'base64url').toString('utf8');
      } else {
        throw new Error('No decoder');
      }
      return JSON.parse(json);
    } catch (_e) {
      throw new Error('Invalid public anon key');
    }
  }
  function bind(config){
    var ch = channel(config);
    var payload = decodePayload(config && config.supabaseAnonKey);
    if (!payload || typeof payload !== 'object' || payload.role !== 'anon' || payload.ref !== expectedRefs[ch]) {
      throw new Error('Invalid public anon key');
    }
    return {
      channel: ch,
      config: config,
      redirectTo: redirectFor(ch)
    };
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
    return bind(config).config.apiOrigin + '/u/' + encodeURIComponent(String(handle || ''));
  }
  function callbackCode(value, ch){
    if (ch === undefined) ch = 'stage';
    if (ch !== 'stage' && ch !== 'production') throw new Error('Unknown channel: ' + ch);
    var url = new URL(value);
    if (url.username || url.password || url.hash || url.searchParams.has('error') ||
        url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code')) {
      throw new Error('Invalid auth callback');
    }
    if (ch === 'stage') {
      if (url.protocol !== 'arcadepoker-stage:' || url.host !== 'auth' || url.pathname !== '/callback') {
        throw new Error('Invalid auth callback');
      }
    } else if (ch === 'production') {
      if (url.protocol !== 'https:' || url.host !== 'play.kcswh.pl' || url.port !== '' || url.pathname !== '/app/auth/callback') {
        throw new Error('Invalid auth callback');
      }
    }
    return url.searchParams.get('code');
  }
  var api = {
    validate: validate,
    validateProduction: validateProduction,
    channel: channel,
    bind: bind,
    redirectFor: redirectFor,
    forPreview: forPreview,
    publicProfileUrl: publicProfileUrl,
    callbackCode: callbackCode,
    redirectTo: redirectTo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MobilePokerSecurity = api;
})(typeof window !== 'undefined' ? window : globalThis);
