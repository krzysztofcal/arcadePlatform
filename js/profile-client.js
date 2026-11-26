(function(){
  if (typeof window === 'undefined') return;

  var ME_URL = '/.netlify/functions/profile-me';
  var PUBLIC_URL = '/.netlify/functions/profile-public?handle=';
  // #1309: no finished answer is kept, so a lost, overlapping or later-applied write can never leave a stale
  // profile behind. Identical reads share one in-flight request per kind (base / includePoker), also when
  // forced, but only if no profile write or invalidation happened since that request started.
  var inFlight = { base: null, poker: null };
  var writeSeq = 0;
  var writesInFlight = 0;
  var publicGeneration = 0;
  var photoLoads = {};
  var storageUsable = true;

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

  function photoPath(url){
    if (typeof url !== 'string' || !PHOTO_URL_RE.test(url)) return null;
    var storage = window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.SUPABASE_URL;
    if (typeof storage !== 'string') return null;
    var prefix = storage.replace(/\/$/, '') + '/storage/v1/object/sign/profile-avatar-uploads/';
    if (url.indexOf(prefix) !== 0) return null;
    var rest = url.slice(prefix.length).split('?')[0];
    return /^pending\/[0-9a-f-]{36}$/.test(rest) ? rest : null;
  }

  function downloadPhoto(url){
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ controller.abort(); }, 15000) : null;
    var options = { mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' };
    if (controller) options.signal = controller.signal;
    return fetch(url, options).then(function(res){
      if (!res.ok) throw new Error('http_' + res.status);
      var contentType = res.headers && typeof res.headers.get === 'function' ? (res.headers.get('content-type') || '') : '';
      if (contentType && contentType.indexOf('image/webp') === -1) throw new Error('invalid_content_type');
      return res.blob();
    }).then(function(blob){
      // The 15 s limit covers the body read too; it is cleared only once the body has arrived.
      if (timer) clearTimeout(timer);
      if (!blob || blob.size > 49152) throw new Error('image_too_large');
      if (blob.type && blob.type.indexOf('image/webp') === -1) throw new Error('invalid_blob_type');
      if (typeof FileReader !== 'undefined'){
        return new Promise(function(resolve, reject){
          var reader = new FileReader();
          reader.onload = function(){ resolve(reader.result); };
          reader.onerror = function(){ reject(new Error('filereader_failed')); };
          reader.readAsDataURL(blob);
        });
      }
      if (typeof blob.arrayBuffer === 'function'){
        return blob.arrayBuffer().then(function(buf){
          var b64;
          if (typeof Buffer !== 'undefined') b64 = Buffer.from(buf).toString('base64');
          else {
            var bytes = new Uint8Array(buf);
            var bin = '';
            for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            b64 = btoa(bin);
          }
          return 'data:image/webp;base64,' + b64;
        });
      }
      throw new Error('cannot_convert_blob');
    }).catch(function(err){
      if (timer) clearTimeout(timer);
      klog('profile:own_photo_failed', { code: err && err.message ? err.message : 'download_failed' });
      throw err;
    });
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
      clearTimeout(node.profileAvatarExpiry);
      delete node.profileAvatarExpiry;
      delete node.dataset.avatarLoading;if(node.setAttribute)node.setAttribute('aria-busy','false');
      node.textContent = ''; node.style.backgroundImage = 'url("' + url + '")';
      var path = photoPath(url);
      if (path) node.dataset.avatarShownPath = path;
    };
    function fallback(){
      if (node.dataset.avatarUrl === url){
        clearTimeout(node.profileAvatarExpiry);
        delete node.profileAvatarExpiry;
        delete node.dataset.avatarShownPath;
        applyAvatar(node, null);
      }
    }
    image.onerror = fallback;
    node.profileAvatarExpiry = setTimeout(fallback, remaining);
    image.src = url;
    return true;
  }

  function applyAvatar(node, profile, options){
    if (!node) return;
    var currentPath = profile && profile.avatar && (profile.avatar.path || (typeof profile.avatar.url === 'string' ? photoPath(profile.avatar.url) : null));
    if (currentPath && node.dataset.avatarShownPath === currentPath) return;

    // Cancel old image callbacks and hide the previous photo before any fallback loads.
    clearTimeout(node.profileAvatarExpiry);
    delete node.profileAvatarExpiry;
    delete node.dataset.avatarUrl;
    delete node.dataset.avatarLoading;
    delete node.dataset.avatarWant;
    delete node.dataset.avatarShownPath;
    if (node.setAttribute) node.setAttribute('aria-busy', 'false');
    node.style.backgroundImage = '';
    node.classList.remove('profile-avatar--uploaded');

    var ownUserId = options && options.ownUserId ? String(options.ownUserId) : null;
    if (ownUserId && storageUsable){
      var ui = window.UserUiState;
      var photoRes = ui && typeof ui.readPhoto === 'function' ? ui.readPhoto(ownUserId) : { available: false };
      if (!photoRes.available){
        storageUsable = false;
      } else {
        var avatar = profile && profile.avatar;
        if (avatar && avatar.type === 'default'){
          if (typeof ui.clearPhoto === 'function') ui.clearPhoto(ownUserId);
        } else if (avatar && avatar.type === 'uploaded'){
          if (!avatar.url){
            if (photoRes.record){
              node.classList.add('profile-avatar--uploaded');
              node.style.backgroundSize = 'cover';
              node.style.backgroundPosition = 'center';
              node.textContent = '';
              node.style.backgroundImage = 'url("' + photoRes.record.dataUrl + '")';
              node.dataset.avatarShownPath = photoRes.record.path;
              return;
            }
            node.textContent = 'AH';
            return;
          }
          var path = photoPath(avatar.url);
          if (path){
            if (photoRes.record && photoRes.record.path === path){
              node.classList.add('profile-avatar--uploaded');
              node.style.backgroundSize = 'cover';
              node.style.backgroundPosition = 'center';
              node.textContent = '';
              node.style.backgroundImage = 'url("' + photoRes.record.dataUrl + '")';
              node.dataset.avatarShownPath = path;
              return;
            }
            // A link that has already expired is not fetched; the plain path below shows today's fallback.
            if (photoExpiresAt(avatar.url) > Date.now()){
              node.dataset.avatarWant = path;
              node.dataset.avatarLoading = 'true';
              if (node.setAttribute) node.setAttribute('aria-busy', 'true');
              node.classList.add('profile-avatar--uploaded');
              node.style.backgroundSize = 'cover';
              node.style.backgroundPosition = 'center';
              node.textContent = '';

              var loadKey = ownUserId + '|' + path;
              if (!photoLoads[loadKey]){
                // One shared entry per user and path covers the download, the session check and the save,
                // so a render during the check joins it instead of downloading again.
                var photoUrl = avatar.url;
                var capturedGen = publicGeneration;
                var entry = downloadPhoto(photoUrl).then(async function(dataUrl){
                  if (photoExpiresAt(photoUrl) <= Date.now()) throw new Error('link_expired');
                  var nowUser = await currentUserId();
                  if (nowUser !== ownUserId || publicGeneration !== capturedGen) throw new Error('stale_session');
                  if (ui && typeof ui.writePhoto === 'function' && !ui.writePhoto(ownUserId, { path: path, dataUrl: dataUrl })) storageUsable = false;
                  return dataUrl;
                });
                photoLoads[loadKey] = entry;
                var release = function(){ if (photoLoads[loadKey] === entry) delete photoLoads[loadKey]; };
                entry.then(release, release);
              }
              photoLoads[loadKey].then(function(dataUrl){
                if (node.dataset.avatarWant !== path) return;
                delete node.dataset.avatarLoading;
                delete node.dataset.avatarWant;
                if (node.setAttribute) node.setAttribute('aria-busy', 'false');
                node.textContent = '';
                node.style.backgroundImage = 'url("' + dataUrl + '")';
                node.dataset.avatarShownPath = path;
              }).catch(function(){
                if (node.dataset.avatarWant !== path) return;
                delete node.dataset.avatarLoading;
                delete node.dataset.avatarWant;
                if (node.setAttribute) node.setAttribute('aria-busy', 'false');
                applyAvatar(node, null);
              });
              return;
            }
          }
        }
      }
    }

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
    var body = {}, unreadable = false;
    try { body = await response.json(); } catch (_err){ unreadable = true; }
    // A successful status with a lost or unreadable body is not a profile: never return or announce it (#1309).
    if (response.ok && (unreadable || !body || typeof body !== 'object' || Array.isArray(body))) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response', status: response.status });
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
    var kind = includePoker ? 'poker' : 'base';
    var current = inFlight[kind];
    if (current && current.userId === userId && current.seq === writeSeq && current.generation === generation) return current.promise;
    var seq = writeSeq;
    var url = includePoker ? ME_URL + '?includePoker=1' : ME_URL;
    var request = authedFetch(url, { method: 'GET' }).then(parse).then(async function(profile){
      if (await currentUserId() !== userId || generation !== publicGeneration) throw staleIdentityError();
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
    writesInFlight += 1;
    try { response = await authedFetch(ME_URL, { method: 'PATCH', body: JSON.stringify(payload || {}) }, guard); }
    finally { writeSeq += 1; seq += 1; writesInFlight -= 1; }
    var profile = await parse(response);
    if (await currentUserId() !== userId || generation !== publicGeneration) throw staleIdentityError();
    if(guard&&!guard.isCurrent())throw Object.assign(new Error('stale_profile'),{code:'stale_profile'});
    // Announce only an answer no other write or invalidation can have overtaken; the server order of
    // overlapping writes is unknown. Listeners that miss it read the profile again on their next event.
    if (writesInFlight === 0 && seq === writeSeq) notify(profile);
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

  function clear(){ publicGeneration += 1; writeSeq += 1; inFlight = { base: null, poker: null }; }

  // A profile change made by another endpoint (for example a Google photo action): later reads start fresh.
  function invalidate(){ writeSeq += 1; }

  // Such a change in progress also counts as a write, so no overlapping profile answer is announced.
  function beginWrite(){
    var open = true; writeSeq += 1; writesInFlight += 1;
    return function done(){ if (!open) return; open = false; writeSeq += 1; writesInFlight -= 1; };
  }

  window.ProfileClient = { getMe: getMe, updateMe: updateMe, getPublic: getPublic, clear: clear, invalidate: invalidate, beginWrite: beginWrite, applyAvatar: applyAvatar, initials: initials, photoPath: photoPath };
  klog('profile:client_ready', {});
})();
