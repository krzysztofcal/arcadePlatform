(function(){
  if (typeof window === 'undefined') return;

  var ME_URL = '/.netlify/functions/profile-me';
  var PUBLIC_URL = '/.netlify/functions/profile-public?handle=';
  var cache = null;
  // #1309: one in-flight read per kind (base / includePoker). A read joins it, even when forced, only if no
  // profile write or invalidation happened since it started; such a read is as fresh as a new one.
  var inFlight = { base: null, poker: null };
  var writeSeq = 0;
  var publicGeneration = 0;

  function klog(kind, data){
    try { if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {}); } catch (_err){}
  }

  function initials(name){
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts.length ? parts[0].slice(0, 2).toUpperCase() : 'AH';
  }

  // Phase D: only our own avatar bucket is rendered as a photo; anything else falls back to the Arcade catalog.
  var PHOTO_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/sign\/profile-avatar-uploads\/pending\/[0-9a-f-]{36}\?token=[^#]+$/;

  // Expiry is only a display/cache limit; authorization stays on the server.
  function photoExpiresAt(url){
    try {
      var token = new URL(url).searchParams.get('token');
      var claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : 0;
    } catch (_err){ return 0; }
  }

  function applyPhoto(node, profile){
    var avatar = profile && profile.avatar;
    if (!avatar || avatar.type !== 'uploaded' || typeof avatar.url !== 'string' || !PHOTO_URL_RE.test(avatar.url)) return false;
    var storage = window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.SUPABASE_URL;
    if (typeof storage !== 'string' || avatar.url.indexOf(storage.replace(/\/$/, '') + '/storage/v1/object/sign/profile-avatar-uploads/pending/') !== 0) return false;
    var url = avatar.url;
    var remaining = Math.min(photoExpiresAt(url) - Date.now(), 60000);
    if (remaining <= 0) return false;
    var deadline = Date.now() + remaining;
    node.dataset.avatarUrl = url;
    node.classList.add('profile-avatar--uploaded');
    node.style.backgroundSize = 'cover';
    node.style.backgroundPosition = 'center';
    node.dataset.avatarLoading='true';if(node.setAttribute)node.setAttribute('aria-busy','true');
    node.textContent = '';
    var image = new Image();
    image.onload = function(){
      if (node.dataset.avatarUrl !== url) return;
      if (Date.now() >= deadline){ fallback(); return; }
      delete node.dataset.avatarLoading;if(node.setAttribute)node.setAttribute('aria-busy','false');
      node.textContent = ''; node.style.backgroundImage = 'url("' + url + '")';
    };
    function fallback(){ if (node.dataset.avatarUrl === url) applyAvatar(node, null); }
    image.onerror = fallback;
    node.profileAvatarExpiry = setTimeout(fallback, remaining);
    image.src = url;
    return true;
  }

  function applyAvatar(node, profile){
    if (!node) return;
    // Cancel old image callbacks and hide the previous photo before any fallback loads.
    clearTimeout(node.profileAvatarExpiry);
    delete node.profileAvatarExpiry;
    delete node.dataset.avatarUrl;delete node.dataset.avatarLoading;if(node.setAttribute)node.setAttribute('aria-busy','false');
    node.style.backgroundImage = '';
    node.classList.remove('profile-avatar--uploaded');
    if (applyPhoto(node, profile)) return;
    // Missing confirmation or an unusable photo is not a confirmed Arcade selection.
    if (!profile || !profile.avatar || profile.avatar.type === 'uploaded'){ node.textContent = 'AH'; return; }
    if(window.ArcadeAvatars){window.ArcadeAvatars.apply(node,profile);return;}
    node.textContent = initials(profile && profile.displayName);
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

  async function authedFetch(url, options, guard){
    var accessToken = await token();
    if (!accessToken){
      var error = new Error('not_authenticated');
      error.code = 'not_authenticated';
      throw error;
    }
    if(guard){
      var subject;try{subject=JSON.parse(atob(accessToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch(_err){}
      if(subject!==guard.userId||await currentUserId()!==guard.userId)throw staleIdentityError();
      if(!guard.isCurrent())throw Object.assign(new Error('stale_profile'),{code:'stale_profile'});
    }
    var opts = options || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + accessToken }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(window.ArcadeApi ? window.ArcadeApi.url(url) : url, Object.assign({}, opts, { headers: headers }));
  }

  function notify(profile){
    try { document.dispatchEvent(new CustomEvent('profile:updated', { detail: profile || null })); } catch (_err){}
  }

  async function getMe(force, options){
    var generation = publicGeneration;
    var includePoker = !!(options && options.includePoker);
    var userId = await currentUserId();
    if (!userId || generation !== publicGeneration) throw staleIdentityError();
    if (cache && cache.profile.avatar && cache.profile.avatar.type === 'uploaded' && photoExpiresAt(cache.profile.avatar.url) <= Date.now()) cache = null;
    if (!force && cache && cache.userId === userId && (!includePoker || cache.includePoker === true)) return cache.profile;
    var kind = includePoker ? 'poker' : 'base';
    var current = inFlight[kind];
    if (current && current.userId === userId && current.seq === writeSeq && current.generation === generation) return current.promise;
    var seq = writeSeq;
    var url = includePoker ? ME_URL + '?includePoker=1' : ME_URL;
    var request = authedFetch(url, { method: 'GET' }).then(parse).then(async function(profile){
      if (await currentUserId() !== userId || generation !== publicGeneration) throw staleIdentityError();
      // A write that finished meanwhile already cached the newer profile.
      if (seq === writeSeq) cache = { userId: userId, profile: profile, includePoker: includePoker };
      return profile;
    });
    var entry = { userId: userId, seq: seq, generation: generation, promise: request };
    inFlight[kind] = entry;
    request.finally(function(){ if (inFlight[kind] === entry) inFlight[kind] = null; }).catch(function(){});
    return request;
  }

  async function updateMe(payload, guard){
    var userId = guard?guard.userId:await currentUserId();
    if (!userId) throw staleIdentityError();
    var generation = publicGeneration;
    var seq = writeSeq += 1;
    var response;
    try { response = await authedFetch(ME_URL, { method: 'PATCH', body: JSON.stringify(payload || {}) }, guard); }
    finally { writeSeq += 1; seq += 1; }
    var profile = await parse(response);
    if (await currentUserId() !== userId || generation !== publicGeneration) throw staleIdentityError();
    if(guard&&!guard.isCurrent())throw Object.assign(new Error('stale_profile'),{code:'stale_profile'});
    // A later write or invalidation (for example a Google photo withdrawal) wins over this answer. The server
    // order of overlapping writes is unknown, so their answers are not cached; the next read fetches.
    if (seq !== writeSeq){ cache = null; return profile; }
    cache = { userId: userId, profile: profile, includePoker: false };
    notify(profile);
    return profile;
  }

  async function getPublic(handle){
    var generation = publicGeneration;
    var userId = await currentUserId();
    if (!userId) throw Object.assign(new Error('not_authenticated'), { code: 'not_authenticated', status: 401 });
    if (generation !== publicGeneration) throw staleIdentityError();
    var response = await authedFetch(PUBLIC_URL + encodeURIComponent(String(handle || '')), { method: 'GET', cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
    var profile = await parse(response);
    var latestUserId = await currentUserId();
    if (generation !== publicGeneration || latestUserId !== userId) throw staleIdentityError();
    return profile;
  }

  function clear(){ publicGeneration += 1; writeSeq += 1; cache = null; inFlight = { base: null, poker: null }; }

  // A profile change made by another endpoint (for example a Google photo action): later reads start fresh.
  function invalidate(){ writeSeq += 1; cache = null; }

  window.ProfileClient = { getMe: getMe, updateMe: updateMe, getPublic: getPublic, clear: clear, invalidate: invalidate, applyAvatar: applyAvatar, initials: initials };
  klog('profile:client_ready', {});
})();
