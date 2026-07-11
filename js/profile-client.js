(function(){
  if (typeof window === 'undefined') return;

  var ME_URL = '/.netlify/functions/profile-me';
  var PUBLIC_URL = '/.netlify/functions/profile-public?handle=';
  var AVATAR_UPLOAD_URL = '/.netlify/functions/profile-avatar-upload-url';
  var AVATAR_FINALIZE_URL = '/.netlify/functions/profile-avatar-finalize';
  var AVATAR_REMOVE_URL = '/.netlify/functions/profile-avatar-remove';
  var AVATAR_MAX_BYTES = 1024 * 1024;
  var AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
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
    var uploaded = avatar.type === 'uploaded' && typeof avatar.url === 'string' && avatar.url;
    node.textContent = uploaded ? '' : initials(profile && profile.displayName);
    node.dataset.avatarVariant = avatar.variant || 'default';
    node.classList.toggle('profile-avatar--uploaded', !!uploaded);
    node.style.backgroundImage = uploaded ? 'url("' + avatar.url.replace(/["\\]/g, '') + '")' : '';
  }

  async function token(){
    var bridge = window.SupabaseAuthBridge;
    if (!bridge || typeof bridge.getAccessToken !== 'function') return null;
    return bridge.getAccessToken();
  }

  async function currentUserId(){
    var auth = window.SupabaseAuth;
    if (!auth || typeof auth.getCurrentUser !== 'function') return null;
    var user = await auth.getCurrentUser();
    return user && user.id ? String(user.id) : null;
  }

  function staleIdentityError(){
    var error = new Error('stale_identity');
    error.code = 'stale_identity';
    return error;
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
    var userId = await currentUserId();
    if (!userId) throw staleIdentityError();
    if (!force && cache && cache.userId === userId) return cache.profile;
    if (!force && inFlight && inFlight.userId === userId) return inFlight.promise;
    var request = authedFetch(ME_URL, { method: 'GET' }).then(parse).then(async function(profile){
      if (await currentUserId() !== userId) throw staleIdentityError();
      cache = { userId: userId, profile: profile };
      return profile;
    });
    inFlight = { userId: userId, promise: request };
    request.finally(function(){ if (inFlight && inFlight.promise === request) inFlight = null; }).catch(function(){});
    return request;
  }

  async function updateMe(payload){
    var userId = await currentUserId();
    if (!userId) throw staleIdentityError();
    var response = await authedFetch(ME_URL, { method: 'PATCH', body: JSON.stringify(payload || {}) });
    var profile = await parse(response);
    if (await currentUserId() !== userId) throw staleIdentityError();
    cache = { userId: userId, profile: profile };
    notify(profile);
    return profile;
  }

  async function uploadAvatar(file){
    if (!file || AVATAR_TYPES.indexOf(file.type) === -1){
      var typeError = new Error('unsupported_avatar_type');
      typeError.code = 'unsupported_avatar_type';
      throw typeError;
    }
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > AVATAR_MAX_BYTES){
      var sizeError = new Error('avatar_too_large');
      sizeError.code = 'avatar_too_large';
      throw sizeError;
    }
    var signed = await parse(await authedFetch(AVATAR_UPLOAD_URL, {
      method: 'POST',
      body: JSON.stringify({ mimeType: file.type, size: file.size })
    }));
    var uploadUrl = String(signed.uploadUrl || '');
    if (signed.token && uploadUrl.indexOf('token=') === -1){
      uploadUrl += (uploadUrl.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(signed.token);
    }
    var uploadResponse = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!uploadResponse.ok){
      var uploadError = new Error('avatar_upload_failed');
      uploadError.code = 'avatar_upload_failed';
      uploadError.status = uploadResponse.status;
      throw uploadError;
    }
    var profile = await parse(await authedFetch(AVATAR_FINALIZE_URL, {
      method: 'POST',
      body: JSON.stringify({ uploadId: signed.uploadId })
    }));
    var userId = await currentUserId();
    if (!userId) throw staleIdentityError();
    cache = { userId: userId, profile: profile };
    notify(profile);
    return profile;
  }

  async function removeAvatar(){
    var profile = await parse(await authedFetch(AVATAR_REMOVE_URL, { method: 'DELETE' }));
    var userId = await currentUserId();
    if (!userId) throw staleIdentityError();
    cache = { userId: userId, profile: profile };
    notify(profile);
    return profile;
  }

  async function getPublic(handle){
    var response = await fetch(PUBLIC_URL + encodeURIComponent(String(handle || '')), { headers: { Accept: 'application/json' } });
    return parse(response);
  }

  function clear(){ cache = null; inFlight = null; }

  window.ProfileClient = { getMe: getMe, updateMe: updateMe, uploadAvatar: uploadAvatar, removeAvatar: removeAvatar, getPublic: getPublic, clear: clear, applyAvatar: applyAvatar, initials: initials };
  klog('profile:client_ready', {});
})();
