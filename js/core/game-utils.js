(function(global){
  'use strict';

  function isNonEmptyString(value){
    return typeof value === 'string' && value.trim().length > 0;
  }

  function resolveBase(baseHref){
    const fallback = 'http://localhost/';
    if (isNonEmptyString(baseHref)){
      try {
        return new URL(baseHref, fallback);
      } catch (err) {}
    }
    if (global && global.location && isNonEmptyString(global.location.href)){
      try {
        return new URL(global.location.href, fallback);
      } catch (err) {}
    }
    try {
      return new URL(fallback);
    } catch (err) {
      return null;
    }
  }

  function isSafeRedirectUrl(url, baseUrl){
    // Explicit whitelist of allowed hostnames for redirects
    const allowedHosts = [
      'play.kcswh.pl',
      'localhost',
      '127.0.0.1'
    ];

    try {
      const parsed = new URL(url, baseUrl);

      // Must be HTTPS in production (or HTTP for localhost)
      const isLocalhost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
      const validProtocol = parsed.protocol === 'https:' || (isLocalhost && parsed.protocol === 'http:');

      if (!validProtocol) return false;
      if (!allowedHosts.includes(parsed.hostname)) return false;

      return true;
    } catch {
      return false;
    }
  }

  function sanitizeSelfPage(page, baseHref){
    if (!isNonEmptyString(page)) return null;
    const base = resolveBase(baseHref);
    const referenceHref = base ? base.href : undefined;
    const expectedOrigin = base ? base.origin : null;
    try {
      const url = new URL(page, referenceHref);

      // Protocol validation
      if (!['http:', 'https:'].includes(url.protocol)) return null;

      // Same-origin validation
      if (expectedOrigin && url.origin !== expectedOrigin) return null;

      // Additional whitelist validation for redirects
      if (!isSafeRedirectUrl(url.href, referenceHref)) return null;

      return url;
    } catch (err) {
      return null;
    }
  }

  function isPlayable(game, baseHref){
    if (!game || typeof game !== 'object') return false;
    const source = game.source;
    if (!source || typeof source !== 'object') return false;
    if (source.type === 'placeholder') return false;

    if (isNonEmptyString(source.page)){
      return !!sanitizeSelfPage(source.page, baseHref);
    }

    if (source.type === 'distributor'){
      const embed = isNonEmptyString(source.embedUrl) ? source.embedUrl : source.url;
      if (!isNonEmptyString(embed)) return false;
      const base = resolveBase(baseHref);
      const referenceHref = base ? base.href : undefined;
      try {
        const url = new URL(embed, referenceHref);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch (err) {
        return false;
      }
    }

    return false;
  }

  const api = Object.freeze({
    isPlayable,
    sanitizeSelfPage
  });

  if (typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }

  if (global){
    if (!global.GameUtils || typeof global.GameUtils !== 'object'){
      global.GameUtils = {};
    }
    Object.assign(global.GameUtils, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
