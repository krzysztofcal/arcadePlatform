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
  var statusResolved = false;
  var closeWithdrawalConfirmation = null;

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
  async function request(method, body, expectedUser, withProviderToken, guard){
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
    if(guard&&!guard.isCurrent())throw staleError();
    var headers = { Authorization: 'Bearer ' + session.access_token };
    if (payload) headers['Content-Type'] = 'application/json';
    var response = await fetch(window.ArcadeApi ? window.ArcadeApi.url(ENDPOINT) : ENDPOINT, { method: method, headers: headers, body: payload ? JSON.stringify(payload) : undefined, credentials: 'omit' });
    var data = {};
    try { data = await response.json(); } catch (_err){}
    if (!response.ok){
      var error = new Error(data && data.error ? String(data.error) : 'request_failed');
      error.code = data && data.error ? String(data.error) : 'request_failed';
      error.status = response.status;
      throw error;
    }
    var latest = await currentSession();
    if (!latest || !latest.user || latest.user.id !== expectedUser) throw staleError();
    return data || {};
  }

  function errorText(code){
    var messages = {
      google_proof_required: t('googlePhotoReconnectNeeded', 'Google needs to confirm your identity again. Choose "Confirm with Google", then review the consent and choose "Use my Google photo" again.'),
      google_proof_invalid: t('googlePhotoReconnectNeeded', 'Google needs to confirm your identity again. Choose "Confirm with Google", then review the consent and choose "Use my Google photo" again.'),
      google_photo_unavailable: t('googlePhotoUnavailable', 'Your Google account has no photo we can use. Your Arcade avatar stays.'),
      photo_copy_exists: t('googlePhotoNotInUse', 'Your copy is stored with consent. Choose Google in the avatar gallery and save to use it again.'),
      photo_copy_unavailable: t('googlePhotoCopyUnavailable', 'The stored Google photo is unavailable. Refresh before choosing it.'),
      photo_import_blocked: t('googlePhotoBlocked', 'A moderator has hidden your photo, so a Google photo cannot be used. Your Arcade avatar stays.'),
      terms_required: t('googlePhotoTermsRequired', 'Accept the current Terms first.'),
      rate_limit_exceeded: t('googlePhotoRateLimited', 'Too many attempts. Try again later.')
    };
    return messages[code] || t('googlePhotoError', 'Something went wrong. Your avatar was not changed.');
  }

  function render(next, needsProof){
    status = next || null;
    document.dispatchEvent(new CustomEvent('profile:photo-status'));
    var consent = node('googlePhotoConsent');
    if (consent) consent.checked = false;
    var importButton = node('googlePhotoImport');
    if (importButton) importButton.disabled = true;
    show('arcadeAvatarPhotoHint', false);
    show('googlePhotoOffer', false);
    show('googlePhotoWithdraw', false);
    show('googlePhotoReconnect', false);
    var granted = !!(status && status.consent && status.consent.decision === 'granted');
    var stored = !!(status && status.copyStored === true);
    var active = !!(status && status.photoInUse === true);
    var hasPhoto = granted || stored || active;
    // Withdrawal stays available without a linked Google identity; only a new import needs one.
    if (!status || (!hasPhoto && (status.importEnabled === false || status.googleLinked !== true))){
      show('googlePhotoPanel', false);
      return;
    }
    show('googlePhotoPanel', true);
    show('arcadeAvatarPhotoHint', true);
    var offer = !hasPhoto && status.importEnabled !== false && status.googleLinked === true;
    show('googlePhotoOffer', offer && !needsProof);
    show('googlePhotoReconnect', offer && !!needsProof);
    show('googlePhotoWithdraw', hasPhoto);
    if (status.photoInUse === true) setState(t('googlePhotoInUse', 'Your Google photo is your avatar.'));
    else if (!granted && stored) setState(t('googlePhotoCopyPending', 'Your Google photo is no longer shown, but the deletion of our copy is not confirmed yet. Try again later.'));
    else if (granted) setState(t('googlePhotoNotInUse', 'Your copy is stored with consent. Choose Google in the avatar gallery and save to use it again.'));
    else setState(t('googlePhotoOffer', 'Optional: use your Google profile photo instead of an Arcade avatar.'));
  }

  async function refreshAvatar(expectedUser, expectedGeneration){
    if (!window.ProfileClient || typeof window.ProfileClient.getMe !== 'function') return;
    var profile = await window.ProfileClient.getMe(true);
    if (owner !== expectedUser || generation !== expectedGeneration) throw staleError();
    document.dispatchEvent(new CustomEvent('profile:updated', {detail: profile}));
    if (typeof window.ProfileClient.applyAvatar === 'function') window.ProfileClient.applyAvatar(node('publicProfileAvatar'), profile);
  }

  async function run(action){
    if (busy || !owner) return;
    var expectedUser = owner;
    var expectedGeneration = generation;
    busy = true;
    document.dispatchEvent(new CustomEvent('profile:photo-status'));
    try {
      var result = action === 'withdraw'
        ? await request('POST', { action: 'withdraw' }, expectedUser, false)
        : await request('POST', { action: 'import', consent: true, noticeVersion: status && status.noticeVersion }, expectedUser, true);
      if (expectedGeneration !== generation) return;
      statusResolved=true;render(result);
      if (action !== 'withdraw' && result.photoInUse === true) setState(t('googlePhotoImported', 'Your Google photo is now your avatar.'));
      else if (action === 'withdraw' && result && result.copyDeleted === true) setState(t('googlePhotoWithdrawn', 'Your Google photo is no longer used and our copy was deleted.'));
      else if (action === 'withdraw') setState(t('googlePhotoCopyPending', 'Your Google photo is no longer shown, but the deletion of our copy is not confirmed yet. Try again later.'));
      if (action === 'withdraw' && window.ProfileClient){
        window.ProfileClient.clear();
        if (window.ProfileClient.applyAvatar) ['publicProfileAvatar','accountSummaryAvatar','googleAvatarCurrentImage','avatarInitials','avatarMenuInitials'].forEach(function(id){
          window.ProfileClient.applyAvatar(node(id), null);
        });
      }
      await refreshAvatar(expectedUser, expectedGeneration);
      var refreshed=await request('GET',null,expectedUser,false);
      if(expectedGeneration!==generation||owner!==expectedUser)return;
      statusResolved=true;render(refreshed);
      if(action==='withdraw')setState(result.copyDeleted===true?t('googlePhotoWithdrawn','Your Google photo is no longer used and our copy was deleted.'):t('googlePhotoCopyPending','Deletion is not confirmed. Retry withdrawal.'));
    } catch (error){
      if (expectedGeneration !== generation) return;
      var code = error && error.code ? error.code : 'request_failed';
      klog('google_photo:action_failed', { action: action, code: code });
      if (code === 'stale_identity' || code === 'photo_copy_exists' || (!(error&&error.status)&&code!=='google_proof_required'&&code!=='google_proof_invalid')){
        await load(); // Reconcile once; never retry the POST, including an unknown outcome.
        if(owner===expectedUser&&action==='withdraw'&&result)setState(result.copyDeleted===true?t('googlePhotoWithdrawn','Your Google photo is no longer used and our copy was deleted.'):t('googlePhotoCopyPending','Deletion is not confirmed. Retry withdrawal.'));
        return;
      }
      if(error&&error.status)statusResolved=true;else statusResolved=false;
      render(status, action === 'import' && (code === 'google_proof_required' || code === 'google_proof_invalid'));
      setState(errorText(code));
    } finally {
      busy = false;
      document.dispatchEvent(new CustomEvent('profile:photo-status'));
    }
  }

  async function selectPhoto(expectedRevision, guard){
    var expectedUser=owner,expectedGeneration=generation;
    if(busy||!expectedUser||!getChoice(expectedUser)||!guard||guard.userId!==expectedUser||!guard.isCurrent())throw staleError();
    busy=true;document.dispatchEvent(new CustomEvent('profile:photo-status'));
    try{
      await request('POST',{action:'select',expectedRevision:expectedRevision},expectedUser,false,guard);
      if(generation!==expectedGeneration||owner!==expectedUser||!guard.isCurrent())throw staleError();
      var profile=await window.ProfileClient.getMe(true);
      var refreshed=await request('GET',null,expectedUser,false);
      if(generation!==expectedGeneration||owner!==expectedUser||!guard.isCurrent())throw staleError();
      statusResolved=true;render(refreshed);
      if(refreshed.avatarRevision!==undefined&&refreshed.avatarRevision!==profile.avatarRevision)throw staleError();
      document.dispatchEvent(new CustomEvent('profile:updated',{detail:profile}));
      return profile;
    }catch(error){
      if(owner===expectedUser&&generation===expectedGeneration){
        await load();
        if(owner===expectedUser&&statusResolved)setState(errorText(error&&error.code));
      }
      throw error;
    }finally{busy=false;document.dispatchEvent(new CustomEvent('profile:photo-status'));}
  }

  function getChoice(userId){
    return owner===userId&&statusResolved&&status&&status.consent&&status.consent.decision==='granted'&&status.copyStored===true&&status.previewAvatar&&status.previewAvatar.type==='uploaded'
      ? status.previewAvatar:null;
  }

  // Same accessible confirmation pattern as accountDeletionDialog; no native WebView prompt.
  function confirmWithdrawal(){
    return new Promise(function(resolve){
      var dialog = node('googlePhotoWithdrawDialog');
      var cancelButton = node('googlePhotoWithdrawCancel');
      var confirmButton = node('googlePhotoWithdrawConfirmButton');
      var closeButton = node('googlePhotoWithdrawClose');
      if (!dialog || !dialog.showModal || !cancelButton || !confirmButton || !closeButton){
        klog('google_photo:dialog_unavailable', {});
        resolve(false);
        return;
      }
      var previousFocus = document.activeElement;
      var settled = false;
      function finish(confirmed){
        if (settled) return;
        settled = true;
        dialog.removeEventListener('cancel', cancel);
        dialog.removeEventListener('close', cancel);
        dialog.removeEventListener('click', backdrop);
        dialog.removeEventListener('keydown', keyboard);
        cancelButton.removeEventListener('click', cancel);
        closeButton.removeEventListener('click', cancel);
        confirmButton.removeEventListener('click', accept);
        window.removeEventListener('popstate', cancel);
        closeWithdrawalConfirmation = null;
        if (dialog.open) dialog.close();
        try { if (previousFocus && previousFocus.isConnected) previousFocus.focus(); } catch (_err){}
        resolve(confirmed);
      }
      function cancel(event){ if (event && event.cancelable) event.preventDefault(); finish(false); }
      function accept(){ finish(true); }
      function backdrop(event){ if (event.target === dialog) finish(false); }
      function keyboard(event){
        if (event.key === 'Escape'){ event.preventDefault(); finish(false); return; }
        if (event.key !== 'Tab') return;
        if (event.shiftKey && document.activeElement === closeButton){ event.preventDefault(); confirmButton.focus(); }
        else if (!event.shiftKey && document.activeElement === confirmButton){ event.preventDefault(); closeButton.focus(); }
      }
      closeWithdrawalConfirmation = cancel;
      dialog.addEventListener('cancel', cancel);
      dialog.addEventListener('close', cancel);
      dialog.addEventListener('click', backdrop);
      dialog.addEventListener('keydown', keyboard);
      cancelButton.addEventListener('click', cancel);
      closeButton.addEventListener('click', cancel);
      confirmButton.addEventListener('click', accept);
      window.addEventListener('popstate', cancel);
      try { dialog.showModal(); cancelButton.focus(); } catch (_err){ finish(false); }
    });
  }

  async function load(){
    if (closeWithdrawalConfirmation) closeWithdrawalConfirmation();
    var previousOwner=owner,previousStatus=status;
    var current = ++generation;
    statusResolved=false;
    render(null);
    var auth = window.SupabaseAuth;
    var user = auth && typeof auth.getCurrentUser === 'function' ? await auth.getCurrentUser() : null;
    if (current !== generation) return;
    owner = user && user.id ? String(user.id) : null;
    if (!owner) return;
    try {
      var result = await request('GET', null, owner, false);
      if (current === generation){statusResolved=true;render(result);}
    } catch (error){
      if(current===generation&&error&&error.status===404){statusResolved=true;render(null);}
      if(current===generation&&owner===previousOwner&&previousStatus&&error&&error.code!=='stale_identity'&&error.status!==404){
        // Only retain the owner's withdrawal action, never an unverified photo or selectable copy.
        render({consent:previousStatus.consent,copyStored:previousStatus.copyStored,photoInUse:false,importEnabled:false});
        setState(t('googlePhotoStatusUnavailable','Photo status could not be confirmed. Refresh to try again; you can still withdraw consent.'));
      }
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
    if (withdraw) withdraw.addEventListener('click', async function(){
      if (busy || closeWithdrawalConfirmation || !owner || !status || !(status.copyStored || (status.consent && status.consent.decision === 'granted'))) return;
      var expectedUser = owner;
      var expectedGeneration = generation;
      if (await confirmWithdrawal() && owner === expectedUser && generation === expectedGeneration) run('withdraw');
    });
    var reconnect = node('googlePhotoReconnect');
    if (reconnect) reconnect.addEventListener('click', function(){
      var auth = window.SupabaseAuth;
      if (!auth || typeof auth.signInWithGoogle !== 'function') return;
      auth.signInWithGoogle().catch(function(){ setState(errorText('request_failed')); });
    });
    var auth = window.SupabaseAuth;
    if (auth && typeof auth.onAuthChange === 'function') auth.onAuthChange(function(_event,user){ if(busy&&user&&String(user.id)===owner)return;load(); });
    load();
  }

  window.ProfileGooglePhoto = { load: load, select: selectPhoto, getChoice: getChoice, isSelected: function(userId,revision){return owner===userId&&statusResolved&&status&&status.avatarRevision===revision&&status.photoInUse===true;}, isArcadeSelectionLocked: function(userId){
    return !!userId && (busy || owner!==userId || !statusResolved);
  } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
