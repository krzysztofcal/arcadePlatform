(function(){
  if (typeof window === 'undefined') return;

  var ME_URL = '/.netlify/functions/profile-me';
  var PUBLIC_URL = '/.netlify/functions/profile-public?handle=';
  var cache = null;
  var inFlight = null;

  function klog(kind, data){
    try { if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {}); } catch (_err){}
  }

  function initials(name){
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts.length ? parts[0].slice(0, 2).toUpperCase() : 'AH';
  }

  function applyAvatar(node, profile){
    if (!node) return;
    var avatar = profile && profile.avatar ? profile.avatar : {};
    node.textContent = initials(profile && profile.displayName);
    node.dataset.avatarVariant = avatar.variant || 'default';
    node.classList.toggle('profile-avatar--uploaded', avatar.type === 'uploaded');
  }

  async function token(){
    var bridge = window.SupabaseAuthBridge;
    if (!bridge || typeof bridge.getAccessToken !== 'function') return null;
    return bridge.getAccessToken();
  }

  async function parse(response){
    var body = {};
    try { body = await response.json(); } catch (_err){}
    if (response.ok) return body;
    var error = new Error(body && body.error ? body.error : 'request_failed');
    error.code = body && body.error ? body.error : 'request_failed';
    error.status = response.status;
    throw error;
  }

  async function authedFetch(url, options){
    var accessToken = await token();
    if (!accessToken){
      var error = new Error('not_authenticated');
      error.code = 'not_authenticated';
      throw error;
    }
    var opts = options || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + accessToken }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  function notify(profile){
    try { document.dispatchEvent(new CustomEvent('profile:updated', { detail: profile || null })); } catch (_err){}
  }

  async function getMe(force){
    if (!force && cache) return cache;
    if (!force && inFlight) return inFlight;
    inFlight = authedFetch(ME_URL, { method: 'GET' }).then(parse).then(function(profile){
      cache = profile;
      return profile;
    }).finally(function(){ inFlight = null; });
    return inFlight;
  }

  async function updateMe(payload){
    var response = await authedFetch(ME_URL, { method: 'PATCH', body: JSON.stringify(payload || {}) });
    var profile = await parse(response);
    cache = profile;
    notify(profile);
    return profile;
  }

  async function getPublic(handle){
    var response = await fetch(PUBLIC_URL + encodeURIComponent(String(handle || '')), { headers: { Accept: 'application/json' } });
    return parse(response);
  }

  function clear(){ cache = null; inFlight = null; }

  window.ProfileClient = { getMe: getMe, updateMe: updateMe, getPublic: getPublic, clear: clear, applyAvatar: applyAvatar, initials: initials };
  klog('profile:client_ready', {});
})();
