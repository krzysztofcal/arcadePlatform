(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // #1140 UGC phase D: optional Google profile photo on the Account page. The consent box is never pre-ticked and
  // is reset on every render; an import needs a fresh tick and the current Google provider token from this same
  // session. Every request is bound to the signed-in account it was started for.
  var ENDPOINT = '/.netlify/functions/profile-google-photo';
  var generation = 0;
  var owner = null;
  var status = null;
  var busy = false;

  function t(key, fallback){
    try {
      if (window.I18N && typeof window.I18N.t === 'function'){
        var value = window.I18N.t(key);
        if (value && value !== key) return value;
      }
    } catch (_err){}
    return fallback;
  }

  function klog(kind, data){
    try { if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {}); } catch (_err){}
  }

  function node(id){ return document.getElementById(id); }

  function show(id, visible){
    var item = node(id);
    if (item) item.hidden = !visible;
  }

  function setState(text){
    var item = node('googlePhotoState');
    if (item) item.textContent = text || '';
  }

  async function currentSession(){
    var auth = window.SupabaseAuth;
    var client = auth && typeof auth.getClient === 'function' ? auth.getClient() : null;
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
    var result = await client.auth.getSession();
    return result && result.data ? result.data.session : null;
  }

  function staleError(){
    var error = new Error('stale_identity');
    error.code = 'stale_identity';
    return error;
  }

  // The session is read once per request; token, provider token and account all come from it.
  async function request(method, body, expectedUser, withProviderToken){
    var session = await currentSession();
    if (!session || !session.access_token || !session.user || session.user.id !== expectedUser) throw staleError();
    var payload = body;
    if (withProviderToken){
      if (typeof session.provider_token !== 'string' || !session.provider_token){
        var missing = new Error('google_proof_required');
        missing.code = 'google_proof_required';
        throw missing;
      }
      payload = Object.assign({}, body, { providerToken: session.provider_token });
    }
    var headers = { Authorization: 'Bearer ' + session.access_token };
    if (payload) headers['Content-Type'] = 'application/json';
    var response = await fetch(ENDPOINT, { method: method, headers: headers, body: payload ? JSON.stringify(payload) : undefined, credentials: 'omit' });
    var data = {};
    try { data = await response.json(); } catch (_err){}
    if (!response.ok){
      var error = new Error(data && data.error ? String(data.error) : 'request_failed');
      error.code = data && data.error ? String(data.error) : 'request_failed';
      error.status = response.status;
      throw error;
    }
    return data || {};
  }

  function errorText(code){
    var messages = {
      google_proof_required: t('googlePhotoReconnectNeeded', 'To confirm this is your Google account, sign in with Google again, then choose "Use my Google photo".'),
      google_proof_invalid: t('googlePhotoReconnectNeeded', 'To confirm this is your Google account, sign in with Google again, then choose "Use my Google photo".'),
      google_photo_unavailable: t('googlePhotoUnavailable', 'Your Google account has no photo we can use. Your Arcade avatar stays.'),
      photo_copy_exists: t('googlePhotoNotInUse', 'Your Arcade avatar is shown. To use your Google photo again, first delete the stored copy.'),
      photo_import_blocked: t('googlePhotoBlocked', 'A moderator has hidden your photo, so a Google photo cannot be used. Your Arcade avatar stays.'),
      terms_required: t('googlePhotoTermsRequired', 'Accept the current Terms first.'),
      rate_limit_exceeded: t('googlePhotoRateLimited', 'Too many attempts. Try again later.')
    };
    return messages[code] || t('googlePhotoError', 'Something went wrong. Your avatar was not changed.');
  }

  function render(next){
    status = next || null;
    var consent = node('googlePhotoConsent');
    if (consent) consent.checked = false;
    var importButton = node('googlePhotoImport');
    if (importButton) importButton.disabled = true;
    show('googlePhotoReconnect', false);
    var granted = !!(status && status.consent && status.consent.decision === 'granted');
    var stored = !!(status && status.copyStored === true);
    // Withdrawal stays available without a linked Google identity; only a new import needs one.
    if (!status || (status.googleLinked !== true && !granted && !stored)){
      show('googlePhotoPanel', false);
      return;
    }
    show('googlePhotoPanel', true);
    show('googlePhotoOffer', status.googleLinked === true && !stored);
    show('googlePhotoWithdraw', granted || stored);
    if (status.photoInUse === true) setState(t('googlePhotoInUse', 'Your Google photo is your avatar.'));
    else if (!granted && stored) setState(t('googlePhotoCopyPending', 'Your Google photo is no longer shown, but the deletion of our copy is not confirmed yet. Try again later.'));
    else if (granted) setState(t('googlePhotoNotInUse', 'Your Arcade avatar is shown. To use your Google photo again, first delete the stored copy.'));
    else setState(t('googlePhotoOffer', 'Optional: use your Google profile photo instead of an Arcade avatar.'));
  }

  async function refreshAvatar(expectedUser){
    if (!window.ProfileClient || typeof window.ProfileClient.getMe !== 'function') return;
    try {
      var profile = await window.ProfileClient.getMe(true);
      if (owner !== expectedUser) return;
      if (typeof window.ProfileClient.applyAvatar === 'function') window.ProfileClient.applyAvatar(node('publicProfileAvatar'), profile);
    } catch (_err){}
  }

  async function run(action){
    if (busy || !owner) return;
    var expectedUser = owner;
    var expectedGeneration = generation;
    busy = true;
    try {
      var result = action === 'withdraw'
        ? await request('POST', { action: 'withdraw' }, expectedUser, false)
        : await request('POST', { action: 'import', consent: true, noticeVersion: status && status.noticeVersion }, expectedUser, true);
      if (expectedGeneration !== generation) return;
      render(result);
      if (action !== 'withdraw') setState(t('googlePhotoImported', 'Your Google photo is now your avatar.'));
      else if (result && result.copyDeleted === true) setState(t('googlePhotoWithdrawn', 'Your Google photo is no longer used and our copy was deleted.'));
      else setState(t('googlePhotoCopyPending', 'Your Google photo is no longer shown, but the deletion of our copy is not confirmed yet. Try again later.'));
      await refreshAvatar(expectedUser);
    } catch (error){
      if (expectedGeneration !== generation) return;
      var code = error && error.code ? error.code : 'request_failed';
      klog('google_photo:action_failed', { action: action, code: code });
      if (code === 'stale_identity') return load();
      render(status);
      setState(errorText(code));
      if (code === 'google_proof_required' || code === 'google_proof_invalid') show('googlePhotoReconnect', true);
    } finally {
      busy = false;
    }
  }

  async function load(){
    var current = ++generation;
    render(null);
    var auth = window.SupabaseAuth;
    var user = auth && typeof auth.getCurrentUser === 'function' ? await auth.getCurrentUser() : null;
    if (current !== generation) return;
    owner = user && user.id ? String(user.id) : null;
    if (!owner) return;
    try {
      var result = await request('GET', null, owner, false);
      if (current === generation) render(result);
    } catch (error){
      // 404 means the feature is off on this environment: the panel stays hidden.
      if (current === generation && error && error.status !== 404) klog('google_photo:status_failed', { code: error.code || 'request_failed' });
    }
  }

  function wire(){
    var consent = node('googlePhotoConsent');
    if (consent) consent.addEventListener('change', function(){
      var importButton = node('googlePhotoImport');
      if (importButton) importButton.disabled = !consent.checked || busy;
    });
    var importButton = node('googlePhotoImport');
    if (importButton) importButton.addEventListener('click', function(){
      var box = node('googlePhotoConsent');
      if (!box || !box.checked) return;
      run('import');
    });
    var withdraw = node('googlePhotoWithdraw');
    if (withdraw) withdraw.addEventListener('click', function(){
      if (!window.confirm(t('googlePhotoWithdrawConfirm', 'Stop using your Google photo? Your Arcade avatar will be shown and our copy will be deleted.'))) return;
      run('withdraw');
    });
    var reconnect = node('googlePhotoReconnect');
    if (reconnect) reconnect.addEventListener('click', function(){
      var auth = window.SupabaseAuth;
      if (!auth || typeof auth.signInWithGoogle !== 'function') return;
      auth.signInWithGoogle().catch(function(){ setState(errorText('request_failed')); });
    });
    var auth = window.SupabaseAuth;
    if (auth && typeof auth.onAuthChange === 'function') auth.onAuthChange(function(){ load(); });
    load();
  }

  window.ProfileGooglePhoto = { load: load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
