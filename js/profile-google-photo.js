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
  var statusKnown = false;
  var photoState = null;
  var profileFailed = false;
  var reading = false;
  var resolvingOwner = false;
  var activeOperation = null;
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
  async function request(method, body, expectedUser, withProviderToken, guard, signal){
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
    var response = await fetch(window.ArcadeApi ? window.ArcadeApi.url(ENDPOINT) : ENDPOINT, { method: method, headers: headers, body: payload ? JSON.stringify(payload) : undefined, credentials: 'omit', signal: signal });
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

  function hasCopy(value){ return !!(value&&value.consent&&value.consent.decision==='granted'&&value.copyStored===true); }
  function stateFor(value){ return hasCopy(value)?value.previewAvatar&&value.previewAvatar.type==='uploaded'&&typeof value.previewAvatar.url==='string'&&value.previewAvatar.url?'ready':'unavailable':null; }
  function getPresentation(userId){
    if(!userId)return null;
    if(owner!==userId)return generation===0||resolvingOwner?{state:'pending',avatar:null}:null;
    return photoState?{state:photoState,avatar:getChoice(userId,true)}:null;
  }

  function render(next, needsProof, unresolvedState){
    status = next || null;
    if(!status){photoState=unresolvedState||null;profileFailed=false;}
    document.dispatchEvent(new CustomEvent('profile:photo-status'));
    var consent = node('googlePhotoConsent');
    if (consent) consent.checked = false;
    var importButton = node('googlePhotoImport');
    if (importButton) importButton.disabled = true;
    show('arcadeAvatarPhotoHint', false);
    show('googlePhotoOffer', false);
    show('googlePhotoWithdraw', false);
    show('googlePhotoReconnect', false);
    show('googlePhotoRetry', false);
    var granted = !!(status && status.consent && status.consent.decision === 'granted');
    var stored = !!(status && status.copyStored === true);
    var active = !!(status && status.photoInUse === true);
    var hasPhoto = granted || stored || active || !!photoState;
    // Withdrawal stays available without a linked Google identity; only a new import needs one.
    if ((!status && photoState!=='unavailable') || (!hasPhoto && (status.importEnabled === false || status.googleLinked !== true))){
      show('googlePhotoPanel', false);
      return;
    }
    show('googlePhotoPanel', true);
    show('arcadeAvatarPhotoHint', true);
    var offer = !!status && !hasPhoto && status.importEnabled !== false && status.googleLinked === true;
    var upgrade = granted && stored && status.importEnabled !== false
      && status.noticeVersion === '2026-11-21-g4' && ['2026-11-17-g2', '2026-11-21-g3'].includes(status.consent.noticeVersion)
      && Number.isInteger(status.consentRevision);
    show('googlePhotoOffer', upgrade || (offer && !needsProof));
    var label = node('googlePhotoConsentText');
    if (label && label.dataset) {
      var useG4 = status && status.noticeVersion === '2026-11-21-g4';
      var consentKey = useG4 ? 'googlePhotoConsentG4' : 'googlePhotoConsent';
      if (!label.dataset.defaultText) label.dataset.defaultText = label.textContent;
      label.dataset.i18n = consentKey;
      label.textContent = t(consentKey, useG4
        ? 'I agree to use my Google photo as my avatar in the web profile, leaderboard and Poker tables, visible to signed-in Arcade Hub users including spectators who have not joined. Arcade Hub stores a private copy. A short-lived download link may be shared while it works. I can withdraw consent to stop new links, but already displayed photos may remain until the next check and saved copies cannot be recalled.'
        : label.dataset.defaultText);
    }
    if (importButton && importButton.dataset) {
      importButton.dataset.action = upgrade ? 'upgrade-consent' : 'import';
      importButton.dataset.i18n = upgrade ? 'googlePhotoUpgrade' : 'googlePhotoImport';
      importButton.textContent = upgrade ? t('googlePhotoUpgrade', 'Confirm use of my photo') : t('googlePhotoImport', 'Use my Google photo');
    }
    show('googlePhotoReconnect', offer && !!needsProof);
    show('googlePhotoWithdraw', granted || stored || active);
    show('googlePhotoRetry', photoState==='unavailable'||profileFailed);
    if(photoState==='pending')setState(t('googlePhotoPreviewPending','Waiting for the Google photo preview…'));
    else if(photoState==='unavailable')setState(t('googlePhotoPreviewUnavailable','The Google photo preview is unavailable. Retry the read; no photo will be imported again.'));
    else if(profileFailed)setState(t('googlePhotoProfileRefreshFailed','Photo status was read, but the profile could not be refreshed. Retry the read.'));
    else if (active) setState(t('googlePhotoInUse', 'Your Google photo is your avatar.'));
    else if (!granted && stored) setState(t('googlePhotoCopyPending', 'Your Google photo is no longer shown, but the deletion of our copy is not confirmed yet. Try again later.'));
    else if (granted) setState(t('googlePhotoNotInUse', 'Your copy is stored with consent. Choose Google in the avatar gallery and save to use it again.'));
    else setState(t('googlePhotoOffer', 'Optional: use your Google profile photo instead of an Arcade avatar.'));
  }

  async function refreshAvatar(expectedUser, expectedGeneration, expectedRevision){
    if (!window.ProfileClient || typeof window.ProfileClient.getMe !== 'function') return;
    var profile = await window.ProfileClient.getMe(true);
    if (owner !== expectedUser || generation !== expectedGeneration || typeof expectedRevision==='number'&&profile.avatarRevision!==expectedRevision) throw staleError();
    document.dispatchEvent(new CustomEvent('profile:updated', {detail: profile}));
    if (typeof window.ProfileClient.applyAvatar === 'function') window.ProfileClient.applyAvatar(node('publicProfileAvatar'), profile);
  }

  function clearPhotoPresentation(){
    if(!window.ProfileClient)return;
    window.ProfileClient.clear();
    if(window.ProfileClient.applyAvatar)['publicProfileAvatar','accountSummaryAvatar','googleAvatarCurrentImage','avatarInitials','avatarMenuInitials'].forEach(function(id){window.ProfileClient.applyAvatar(node(id),null);});
  }

  function finishOperation(operation){
    if(activeOperation!==operation)return;
    activeOperation=null;busy=false;document.dispatchEvent(new CustomEvent('profile:photo-status'));
  }

  async function run(action){
    if (busy || !owner) return;
    var expectedUser = owner;
    var expectedGeneration = ++generation;
    var operation={};activeOperation=operation;
    busy = true;profileFailed=false;photoState=action==='import'?'pending':null;
    if(action==='withdraw'){if(status)status=Object.assign({},status,{previewAvatar:null});clearPhotoPresentation();}
    render(status);
    var panel=node('googlePhotoPanel');if(panel&&panel.setAttribute)panel.setAttribute('aria-busy','true');
    try {
      var result = action === 'withdraw'
        ? await request('POST', { action: 'withdraw' }, expectedUser, false)
        : action === 'upgrade-consent'
          ? await request('POST', { action: action, consent: true, noticeVersion: status.noticeVersion, expectedConsentRevision: status.consentRevision }, expectedUser, false)
          : await request('POST', Object.assign({ action: 'import', consent: true, noticeVersion: status && status.noticeVersion },
            status && status.noticeVersion === '2026-11-21-g4' ? { scope: 'web-leaderboard-poker-signed-in' } : {}), expectedUser, true);
      if (expectedGeneration !== generation) return;
      statusResolved=true;photoState=hasCopy(result)?'pending':null;render(result);
      if (action === 'upgrade-consent') setState(t('googlePhotoUpgradeSaved', 'Photo consent updated.'));
      else if (action !== 'withdraw' && result.photoInUse === true) setState(t('googlePhotoImported', 'Your Google photo is now your avatar.'));
      else if (action === 'withdraw' && result && result.copyDeleted === true) setState(t('googlePhotoWithdrawn', 'Your Google photo is no longer used and our copy was deleted.'));
      else if (action === 'withdraw') setState(t('googlePhotoCopyPending', 'Your Google photo is no longer shown, but the deletion of our copy is not confirmed yet. Try again later.'));
      if(action==='withdraw')clearPhotoPresentation();
      else if(window.ProfileClient)window.ProfileClient.clear();
      finishOperation(operation);
      await refreshReads(expectedUser,expectedGeneration,result.avatarRevision);
      if(expectedGeneration!==generation||owner!==expectedUser)return;
      if(action==='withdraw')setState(result.copyDeleted===true?t('googlePhotoWithdrawn','Your Google photo is no longer used and our copy was deleted.'):t('googlePhotoCopyPending','Deletion is not confirmed. Retry withdrawal.'));
    } catch (error){
      if (expectedGeneration !== generation) return;
      var code = error && error.code ? error.code : 'request_failed';
      klog('google_photo:action_failed', { action: action, code: code });
      if (code === 'stale_identity' || code === 'photo_copy_exists' || (!(error&&error.status)&&code!=='google_proof_required'&&code!=='google_proof_invalid')){
        if(action==='import')photoState='unavailable';
        finishOperation(operation);
        await load(true); // Reconcile reads once; never retry the POST, including an unknown outcome.
        if(owner===expectedUser&&action==='withdraw'&&result)setState(result.copyDeleted===true?t('googlePhotoWithdrawn','Your Google photo is no longer used and our copy was deleted.'):t('googlePhotoCopyPending','Deletion is not confirmed. Retry withdrawal.'));
        return;
      }
      statusResolved=!!(error&&error.status)||code==='google_proof_required';
      photoState=stateFor(status);
      render(status, action === 'import' && (code === 'google_proof_required' || code === 'google_proof_invalid'));
      setState(errorText(code));
    } finally {
      finishOperation(operation);
      if(owner===expectedUser&&generation===expectedGeneration&&panel&&panel.setAttribute)panel.setAttribute('aria-busy',String(busy));
    }
  }

  async function selectPhoto(expectedRevision, guard){
    var expectedUser=owner,expectedGeneration=generation;
    if(busy||!expectedUser||!getChoice(expectedUser)||!guard||guard.userId!==expectedUser||!guard.isCurrent())throw staleError();
    var operation={};activeOperation=operation;busy=true;document.dispatchEvent(new CustomEvent('profile:photo-status'));
    try{
      var result=await request('POST',{action:'select',expectedRevision:expectedRevision},expectedUser,false,guard);
      if(generation!==expectedGeneration||owner!==expectedUser||!guard.isCurrent())throw staleError();
      var profile=await window.ProfileClient.getMe(true);
      if(generation!==expectedGeneration||owner!==expectedUser||!guard.isCurrent())throw staleError();
      if(result.avatarRevision!==undefined&&result.avatarRevision!==profile.avatarRevision)throw staleError();
      statusResolved=true;var selected=Object.assign({},status,result);photoState=stateFor(selected);render(selected);
      document.dispatchEvent(new CustomEvent('profile:updated',{detail:profile}));
      return profile;
    }catch(error){
      if(owner===expectedUser&&generation===expectedGeneration){
        await load();
        if(owner===expectedUser&&statusResolved)setState(errorText(error&&error.code));
      }
      throw error;
    }finally{finishOperation(operation);}
  }

  function getChoice(userId,displayOnly){
    return owner===userId&&(photoState==='ready'||displayOnly===true&&photoState==='pending')&&(statusResolved||displayOnly===true)&&status&&status.consent&&status.consent.decision==='granted'&&status.copyStored===true&&status.previewAvatar&&status.previewAvatar.type==='uploaded'
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

  async function readStatus(expectedUser,current){
    var previousStatus=status;
    statusResolved=false;
    if(!statusKnown||hasCopy(status)||photoState)photoState='pending';
    render(status,false,photoState);
    var panel=node('googlePhotoPanel');if(panel&&panel.setAttribute)panel.setAttribute('aria-busy','true');
    var controller=typeof AbortController==='function'?new AbortController():null;
    var timeout=controller?setTimeout(function(){controller.abort();},20000):null;
    try{
      var result=await request('GET',null,expectedUser,false,null,controller&&controller.signal);
      if(typeof result.copyStored!=='boolean'||typeof result.photoInUse!=='boolean'||!Object.prototype.hasOwnProperty.call(result,'consent'))throw new Error('invalid_photo_status');
      if(current===generation&&owner===expectedUser){statusResolved=true;statusKnown=true;photoState=stateFor(result);render(result);}
    }catch(error){
      if(current!==generation||owner!==expectedUser)return;
      if(error&&error.code==='stale_identity'){owner=null;render(null);}
      else if(error&&[401,403,404].indexOf(error.status)!==-1){statusResolved=error.status===404;if(statusResolved)statusKnown=true;render(null);}
      else{
        photoState=hasCopy(previousStatus)||photoState?'unavailable':null;
        render(previousStatus?Object.assign({},previousStatus,{previewAvatar:null}):null,false,photoState);
        if(!photoState)setState(t('googlePhotoStatusUnavailable','Photo status could not be confirmed. Refresh to try again; you can still withdraw consent.'));
      }
      klog('google_photo:status_failed',{code:error&&error.code==='stale_identity'?'stale_identity':'request_failed'});
    }finally{if(timeout!==null)clearTimeout(timeout);if(current===generation&&panel&&panel.setAttribute)panel.setAttribute('aria-busy',String(busy));}
  }

  async function refreshReads(expectedUser,current,revision){
    reading=true;profileFailed=false;
    try{
      var results=await Promise.allSettled([refreshAvatar(expectedUser,current,revision),readStatus(expectedUser,current)]);
      if(current!==generation||owner!==expectedUser)return;
      profileFailed=results[0].status==='rejected';
      if(profileFailed)klog('google_photo:profile_refresh_failed',{code:'request_failed'});
      render(status,false,photoState);
    }finally{if(current===generation)reading=false;}
  }

  async function load(refreshProfile){
    if(closeWithdrawalConfirmation)closeWithdrawalConfirmation();
    var previousOwner=owner,current=++generation;
    reading=false;statusResolved=false;resolvingOwner=true;
    document.dispatchEvent(new CustomEvent('profile:photo-status'));
    var auth=window.SupabaseAuth;
    var user;
    try{user=auth&&typeof auth.getCurrentUser==='function'?await auth.getCurrentUser():null;}
    catch(_error){if(current===generation){resolvingOwner=false;owner=null;render(null);}return;}
    if(current!==generation)return;
    resolvingOwner=false;
    owner=user&&user.id?String(user.id):null;
    if(owner!==previousOwner||!owner){activeOperation=null;busy=false;reading=false;statusKnown=false;render(null,false,owner?'pending':null);}
    if(!owner)return;
    if(refreshProfile===true)await refreshReads(owner,current);
    else await readStatus(owner,current);
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
      run(importButton.dataset && importButton.dataset.action === 'upgrade-consent' ? 'upgrade-consent' : 'import');
    });
    var withdraw = node('googlePhotoWithdraw');
    if (withdraw) withdraw.addEventListener('click', async function(){
      if (busy || closeWithdrawalConfirmation || !owner || !status || !(status.copyStored || (status.consent && status.consent.decision === 'granted'))) return;
      var expectedUser = owner;
      var expectedGeneration = generation;
      if (await confirmWithdrawal() && owner === expectedUser && generation === expectedGeneration) run('withdraw');
    });
    var retry=node('googlePhotoRetry');if(retry)retry.addEventListener('click',function(){if(!busy&&owner&&(photoState==='unavailable'||profileFailed))load(true);});
    var reconnect = node('googlePhotoReconnect');
    if (reconnect) reconnect.addEventListener('click', function(){
      var auth = window.SupabaseAuth;
      if (!auth || typeof auth.signInWithGoogle !== 'function') return;
      auth.signInWithGoogle().catch(function(){ setState(errorText('request_failed')); });
    });
    var auth = window.SupabaseAuth;
    if (auth && typeof auth.onAuthChange === 'function') auth.onAuthChange(function(_event,user){ if((busy||reading||photoState==='pending')&&user&&String(user.id)===owner)return;if(!user||String(user.id)!==owner){owner=null;activeOperation=null;busy=false;reading=false;statusResolved=false;render(null);}load(); });
    load();
  }

  window.ProfileGooglePhoto = { load: load, select: selectPhoto, getChoice: getChoice, getPresentation: getPresentation, isSelected: function(userId,revision){if(owner!==userId||!status||typeof revision!=='number'||typeof status.avatarRevision!=='number'||status.avatarRevision<revision)return null;return hasCopy(status)&&status.photoInUse===true;}, isArcadeSelectionLocked: function(userId,displayOnly){
    return !!userId && (busy || owner!==userId || (!statusResolved&&displayOnly!==true));
  } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
