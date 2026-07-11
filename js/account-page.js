(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var auth = null;
  var nodes = {};
  var currentUser = null;
  var chipsInFlight = null;
  var welcomeBonusInFlight = null;
  var publicProfileInFlight = null;
  var publicProfile = null;
  var publicProfileGeneration = 0;
  var publicProfileSaveResetTimer = null;
  var passwordRecoveryActive = false;
  var WELCOME_BONUS_SUCCESS = 'Bonus added to your account.';
  var ledgerState = {
    entries: [],
    nextCursor: null,
    hasMore: true,
    loading: false,
    error: null,
    rowHeight: 80,
    overscan: 4,
    lastLoadAttemptAtMs: 0,
    lastScrollTop: 0,
    renderQueued: false,
    pageIndex: 0,
    pageCursors: [null],
  };

  function selectNodes(){
    nodes.status = doc.getElementById('accountStatus');
    nodes.forms = doc.getElementById('authForms');
    nodes.account = doc.getElementById('accountPanel');
    nodes.userEmail = doc.getElementById('accountEmail');
    nodes.userName = doc.getElementById('accountName');
    nodes.signOut = doc.getElementById('signOutButton');
    nodes.deleteBtn = doc.getElementById('deleteAccountButton');
    nodes.deleteNote = doc.getElementById('deleteAccountNote');
    nodes.signInForm = doc.getElementById('signinForm');
    nodes.signUpForm = doc.getElementById('signupForm');
    nodes.signInEmail = doc.getElementById('signinEmail');
    nodes.signInPass = doc.getElementById('signinPassword');
    nodes.signUpEmail = doc.getElementById('signupEmail');
    nodes.signUpPass = doc.getElementById('signupPassword');
    nodes.signUpPassConfirm = doc.getElementById('signupPasswordConfirm');
    nodes.forgotPasswordButton = doc.getElementById('forgotPasswordButton');
    nodes.passwordResetForm = doc.getElementById('passwordResetForm');
    nodes.passwordResetEmail = doc.getElementById('passwordResetEmail');
    nodes.passwordResetBack = doc.getElementById('passwordResetBack');
    nodes.passwordRecoveryForm = doc.getElementById('passwordRecoveryForm');
    nodes.recoveryPassword = doc.getElementById('recoveryPassword');
    nodes.recoveryPasswordConfirm = doc.getElementById('recoveryPasswordConfirm');
    nodes.chipPanel = doc.getElementById('chipPanel');
    nodes.chipStatus = doc.getElementById('chipStatus');
    nodes.chipBalanceValue = doc.getElementById('chipBalanceValue');
    nodes.chipLedgerScroll = doc.getElementById('chipLedgerScroll');
    nodes.chipLedgerSpacer = doc.getElementById('chipLedgerSpacer');
    nodes.chipLedgerList = doc.getElementById('chipLedgerList');
    nodes.chipLedgerEmpty = doc.getElementById('chipLedgerEmpty');
    nodes.chipLedgerPagination = doc.getElementById('chipLedgerPagination');
    nodes.chipLedgerPrev = doc.getElementById('chipLedgerPrev');
    nodes.chipLedgerNext = doc.getElementById('chipLedgerNext');
    nodes.chipLedgerPage = doc.getElementById('chipLedgerPage');
    nodes.welcomeBonusPanel = doc.getElementById('welcomeBonusPanel');
    nodes.welcomeBonusTitle = doc.getElementById('welcomeBonusTitle');
    nodes.bonusCampaignList = doc.getElementById('bonusCampaignList');
    nodes.welcomeBonusClaimButton = doc.getElementById('welcomeBonusClaimButton');
    nodes.welcomeBonusStatus = doc.getElementById('welcomeBonusStatus');
    nodes.publicProfileEditor = doc.getElementById('publicProfileEditor');
    nodes.publicProfileForm = doc.getElementById('publicProfileForm');
    nodes.publicProfileAvatar = doc.getElementById('publicProfileAvatar');
    nodes.publicProfileUrl = doc.getElementById('publicProfileUrl');
    nodes.publicDisplayName = doc.getElementById('publicDisplayName');
    nodes.publicHandle = doc.getElementById('publicHandle');
    nodes.publicBio = doc.getElementById('publicBio');
    nodes.publicHandleHint = doc.getElementById('publicHandleHint');
    nodes.publicProfileSave = doc.getElementById('publicProfileSave');
    nodes.publicProfileSaveLabel = doc.getElementById('publicProfileSaveLabel');
    nodes.publicProfileSaveStatus = doc.getElementById('publicProfileSaveStatus');
    nodes.publicAvatarInput = doc.getElementById('publicAvatarInput');
    nodes.publicAvatarChoose = doc.getElementById('publicAvatarChoose');
    nodes.publicAvatarRemove = doc.getElementById('publicAvatarRemove');
    nodes.publicAvatarStatus = doc.getElementById('publicAvatarStatus');
    nodes.publicDisplayNameError = doc.getElementById('publicDisplayNameError');
    nodes.publicHandleError = doc.getElementById('publicHandleError');
    nodes.publicBioError = doc.getElementById('publicBioError');
  }

  function t(key, fallback){
    try {
      if (window.I18N && typeof window.I18N.t === 'function'){
        return window.I18N.t(key) || fallback || key;
      }
    } catch (_err){}
    return fallback || key;
  }

  function tf(key, values, fallback){
    try {
      if (window.I18N && typeof window.I18N.format === 'function'){
        var formatted = window.I18N.format(key, values);
        if (formatted) return formatted;
      }
    } catch (_err){}
    return (fallback || key).replace(/\{([a-zA-Z0-9_]+)\}/g, function(match, name){
      return values && values[name] != null ? String(values[name]) : match;
    });
  }

  function validEmail(value){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }

  function openAccountPanel(user){
    if (!user) return;
    renderUser(user);
    loadChips();
    refreshWelcomeBonus(user);
    if (window.location) window.location.hash = 'accountPanel';
    if (nodes.account && typeof nodes.account.scrollIntoView === 'function') nodes.account.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setBlockVisibility(node, isVisible){
    if (!node) return;
    node.hidden = !isVisible;
    node.style.display = isVisible ? '' : 'none';
  }

  function setStatus(message, tone){
    if (!nodes.status) return;
    nodes.status.textContent = message || '';
    nodes.status.dataset.tone = tone || '';
    nodes.status.hidden = !message;
  }

  function klog(kind, data){
    try {
      if (window && window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function getUserKey(user){
    if (!user) return '';
    return String(user.id || user.user_id || user.sub || 'current');
  }

  function parseSortId(value){
    if (value === null || value === undefined) return null;
    var text = String(value);
    if (!/^\d+$/.test(text)) return null;
    try {
      return BigInt(text);
    } catch (_err){
      return null;
    }
  }

  function normalizeTimestampToIso(value){
    if (!value) return null;
    if (value instanceof Date){
      if (Number.isNaN(value.getTime())) return null;
      return value.toISOString();
    }
    if (typeof value !== 'string') return null;
    var normalized = value.trim();
    if (!normalized) return null;
    var spaceIndex = normalized.indexOf(' ');
    if (spaceIndex !== -1){
      normalized = normalized.slice(0, spaceIndex) + 'T' + normalized.slice(spaceIndex + 1);
    }
    normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    normalized = normalized.replace(/\+00$/, 'Z');
    if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized)){
      normalized += 'Z';
    }
    var parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  function resolveSortTimestamp(entry){
    if (!entry) return '';
    var normalized = normalizeTimestampToIso(entry.display_created_at || entry.created_at || entry.tx_created_at || '');
    return normalized ? normalized : '';
  }

  function renderUser(user){
    var hasUser = !!user;
    var previousUserKey = getUserKey(currentUser);
    var nextUserKey = getUserKey(user);
    currentUser = user || null;
    if (previousUserKey !== nextUserKey){
      publicProfileGeneration += 1;
      publicProfileInFlight = null;
      if (window.ProfileClient && typeof window.ProfileClient.clear === 'function') window.ProfileClient.clear();
    }

    // Toggle panels
    setBlockVisibility(nodes.forms, !hasUser);
    setBlockVisibility(nodes.account, hasUser);
    setBlockVisibility(nodes.chipPanel, hasUser);
    setWelcomeBonusVisibility(false);

    if (!hasUser){
      publicProfile = null;
      setBlockVisibility(nodes.publicProfileEditor, false);
      clearChips();
      return;
    }

    var meta = user.user_metadata || {};
    var displayName = meta.full_name || meta.name || user.email || 'Player';
    if (nodes.userEmail){ nodes.userEmail.textContent = user.email || 'Unknown email'; }
    if (nodes.userName){ nodes.userName.textContent = displayName; }
    loadPublicProfile();
  }

  function setPublicProfileErrors(errors){
    if (nodes.publicDisplayNameError) nodes.publicDisplayNameError.textContent = errors && errors.displayName ? errors.displayName : '';
    if (nodes.publicHandleError) nodes.publicHandleError.textContent = errors && errors.handle ? errors.handle : '';
    if (nodes.publicBioError) nodes.publicBioError.textContent = errors && errors.bio ? errors.bio : '';
  }

  function publicProfileError(error){
    var code = error && error.code ? error.code : 'request_failed';
    var messages = {
      invalid_handle: t('publicProfileInvalidHandle', 'Use 3-24 lowercase letters, digits, hyphens, or underscores.'),
      handle_taken: t('publicProfileHandleTaken', 'This handle is already taken.'),
      reserved_handle: t('publicProfileReservedHandle', 'This handle is reserved.'),
      handle_locked: t('publicProfileHandleLocked', 'Your handle is permanent and cannot be changed again.'),
      invalid_display_name: t('publicProfileInvalidDisplayName', 'Use 2-40 characters for your display name.'),
      bio_too_long: t('publicProfileBioTooLong', 'Your bio can contain up to 160 characters.')
    };
    return { code: code, message: messages[code] || t('publicProfileSaveError', 'Could not save your public profile.') };
  }

  function setPublicProfileSaveState(state, message){
    if (publicProfileSaveResetTimer){ clearTimeout(publicProfileSaveResetTimer); publicProfileSaveResetTimer = null; }
    if (nodes.publicProfileSave){
      nodes.publicProfileSave.dataset.state = state;
      nodes.publicProfileSave.disabled = state === 'saving';
      nodes.publicProfileSave.setAttribute('aria-busy', state === 'saving' ? 'true' : 'false');
    }
    if (nodes.publicProfileSaveLabel){
      nodes.publicProfileSaveLabel.textContent = state === 'saving'
        ? t('savingPublicProfile', 'Saving...')
        : state === 'saved' ? t('publicProfileSavedShort', 'Saved') : t('savePublicProfile', 'Save public profile');
    }
    if (nodes.publicProfileSaveStatus) nodes.publicProfileSaveStatus.textContent = message || '';
    if (state === 'saved'){
      publicProfileSaveResetTimer = setTimeout(function(){ setPublicProfileSaveState('idle', ''); }, 1800);
    }
  }

  function renderPublicProfile(profile){
    publicProfile = profile || null;
    setBlockVisibility(nodes.publicProfileEditor, !!profile);
    if (!profile) return;
    if (window.ProfileClient && window.ProfileClient.applyAvatar) window.ProfileClient.applyAvatar(nodes.publicProfileAvatar, profile);
    if (nodes.publicAvatarRemove) nodes.publicAvatarRemove.hidden = !(profile.avatar && profile.avatar.type === 'uploaded');
    if (nodes.publicDisplayName) nodes.publicDisplayName.value = profile.displayName || '';
    if (nodes.publicHandle){ nodes.publicHandle.value = profile.handle || ''; nodes.publicHandle.disabled = !profile.handleCanBeCustomized; }
    if (nodes.publicBio) nodes.publicBio.value = profile.bio || '';
    if (nodes.publicHandleHint) nodes.publicHandleHint.textContent = profile.handleCanBeCustomized ? t('publicHandleHint', 'You can change your generated handle once. It then becomes permanent.') : t('publicHandleLockedHint', 'This handle is permanent.');
    if (nodes.publicProfileUrl){ nodes.publicProfileUrl.href = '/u/' + encodeURIComponent(profile.handle || ''); nodes.publicProfileUrl.textContent = '/u/' + (profile.handle || ''); }
    setPublicProfileErrors(null);
  }

  function setAvatarState(state, message, tone){
    var busy = state === 'validating' || state === 'uploading' || state === 'processing' || state === 'removing';
    if (nodes.publicAvatarChoose) nodes.publicAvatarChoose.disabled = !!busy;
    if (nodes.publicAvatarRemove) nodes.publicAvatarRemove.disabled = !!busy;
    if (nodes.publicAvatarInput) nodes.publicAvatarInput.disabled = !!busy;
    if (nodes.publicAvatarStatus){
      nodes.publicAvatarStatus.textContent = message || t('publicAvatarRequirements', 'JPEG, PNG or WebP, up to 1 MB.');
      nodes.publicAvatarStatus.dataset.tone = tone || '';
    }
    if (nodes.publicProfileAvatar){
      nodes.publicProfileAvatar.dataset.uploadState = state || 'idle';
      nodes.publicProfileAvatar.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
  }

  function avatarErrorMessage(error){
    var code = error && error.code ? error.code : 'avatar_upload_failed';
    if (code === 'unsupported_avatar_type' || code === 'invalid_avatar_file') return t('publicAvatarInvalidType', 'Choose a valid JPEG, PNG or WebP image.');
    if (code === 'avatar_too_large' || code === 'avatar_dimensions_too_large') return t('publicAvatarTooLarge', 'Use an image up to 1 MB and 1024 x 1024 pixels.');
    return t('publicAvatarUploadError', 'Could not update your avatar. Please try again.');
  }

  function handleAvatarChoose(){ if (nodes.publicAvatarInput && !nodes.publicAvatarInput.disabled) nodes.publicAvatarInput.click(); }

  function handleAvatarSelected(){
    var file = nodes.publicAvatarInput && nodes.publicAvatarInput.files ? nodes.publicAvatarInput.files[0] : null;
    if (!file || !window.ProfileClient || typeof window.ProfileClient.uploadAvatar !== 'function') return;
    if (typeof window.FileReader === 'function' && nodes.publicProfileAvatar){
      var previewReader = new window.FileReader();
      previewReader.onload = function(){
        nodes.publicProfileAvatar.textContent = '';
        nodes.publicProfileAvatar.classList.add('profile-avatar--uploaded');
        nodes.publicProfileAvatar.style.backgroundImage = 'url("' + String(previewReader.result || '').replace(/["\\]/g, '') + '")';
      };
      previewReader.readAsDataURL(file);
    }
    setAvatarState('validating', t('publicAvatarValidating', 'Checking image...'), 'info');
    window.ProfileClient.uploadAvatar(file, function(stage){
      if (stage === 'uploading') setAvatarState('uploading', t('publicAvatarUploading', 'Uploading avatar...'), 'info');
      if (stage === 'processing') setAvatarState('processing', t('publicAvatarProcessing', 'Processing avatar...'), 'info');
    }).then(function(profile){
      renderPublicProfile(profile);
      setAvatarState('success', t('publicAvatarUpdated', 'Avatar updated and visible on your profile.'), 'success');
    }).catch(function(error){
      renderPublicProfile(publicProfile);
      setAvatarState('error', avatarErrorMessage(error), 'error');
    }).finally(function(){
      if (nodes.publicAvatarInput) nodes.publicAvatarInput.value = '';
    });
  }

  function handleAvatarRemove(){
    if (!window.ProfileClient || typeof window.ProfileClient.removeAvatar !== 'function') return;
    if (!window.confirm(t('publicAvatarRemoveConfirm', 'Remove your uploaded avatar and restore the default avatar?'))) return;
    setAvatarState('removing', t('publicAvatarRemoving', 'Restoring default avatar...'), 'info');
    window.ProfileClient.removeAvatar().then(function(profile){
      renderPublicProfile(profile);
      setAvatarState('success', t('publicAvatarRemoved', 'Default avatar restored.'), 'success');
    }).catch(function(error){ setAvatarState('error', avatarErrorMessage(error), 'error'); });
  }

  function loadPublicProfile(force){
    if (!currentUser || !window.ProfileClient || typeof window.ProfileClient.getMe !== 'function') return Promise.resolve(null);
    if (publicProfileInFlight) return publicProfileInFlight;
    var requestedUserKey = getUserKey(currentUser);
    var requestedGeneration = publicProfileGeneration;
    var request = window.ProfileClient.getMe(!!force).then(function(profile){
      if (requestedUserKey !== getUserKey(currentUser) || requestedGeneration !== publicProfileGeneration) return null;
      renderPublicProfile(profile);
      return profile;
    }).catch(function(error){
      klog('profile:account_load_failed', { code: error && error.code ? error.code : 'request_failed' });
      if (requestedUserKey === getUserKey(currentUser) && requestedGeneration === publicProfileGeneration){
        setBlockVisibility(nodes.publicProfileEditor, false);
        setStatus(t('publicProfileLoadError', 'Could not load your public profile. Please refresh and try again.'), 'error');
      }
      return null;
    }).finally(function(){ if (publicProfileInFlight === request) publicProfileInFlight = null; });
    publicProfileInFlight = request;
    return request;
  }

  function handlePublicProfileSave(event){
    event.preventDefault();
    if (!publicProfile || !window.ProfileClient || typeof window.ProfileClient.updateMe !== 'function') return;
    setPublicProfileErrors(null);
    var payload = {};
    var displayName = nodes.publicDisplayName ? nodes.publicDisplayName.value.trim() : '';
    var bio = nodes.publicBio ? nodes.publicBio.value.trim() : '';
    var handle = nodes.publicHandle ? nodes.publicHandle.value.trim().toLowerCase() : '';
    if (displayName !== publicProfile.displayName) payload.displayName = displayName;
    if (bio !== publicProfile.bio) payload.bio = bio;
    if (publicProfile.handleCanBeCustomized && handle && handle !== publicProfile.handle){
      if (!window.confirm(t('publicHandleConfirm', 'Changing your handle is permanent. Continue?'))) return;
      payload.handle = handle;
    }
    if (!Object.keys(payload).length){ setStatus(t('publicProfileNoChanges', 'No profile changes to save.'), 'info'); return; }
    setPublicProfileSaveState('saving', t('savingPublicProfile', 'Saving...'));
    var saveSucceeded = false;
    window.ProfileClient.updateMe(payload).then(function(profile){
      renderPublicProfile(profile);
      saveSucceeded = true;
      setPublicProfileSaveState('saved', t('publicProfileSaved', 'Public profile saved.'));
      setStatus(t('publicProfileSaved', 'Public profile saved.'), 'success');
    }).catch(function(error){
      var result = publicProfileError(error);
      var errors = {};
      if (result.code.indexOf('handle') !== -1 || result.code === 'reserved_handle') errors.handle = result.message;
      else if (result.code === 'bio_too_long') errors.bio = result.message;
      else if (result.code === 'invalid_display_name') errors.displayName = result.message;
      setPublicProfileErrors(errors);
      setPublicProfileSaveState('idle', result.message);
      setStatus(result.message, 'error');
    }).finally(function(){ if (!saveSucceeded) setPublicProfileSaveState('idle', nodes.publicProfileSaveStatus ? nodes.publicProfileSaveStatus.textContent : ''); });
  }

  function clearChips(){
    if (nodes.chipBalanceValue){ nodes.chipBalanceValue.textContent = '—'; }
    if (nodes.chipLedgerList){ nodes.chipLedgerList.innerHTML = ''; }
    if (nodes.chipLedgerSpacer){ nodes.chipLedgerSpacer.style.height = '0px'; }
    if (nodes.chipLedgerScroll){ nodes.chipLedgerScroll.scrollTop = 0; }
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = false; }
    setChipStatus('', '');
    resetLedgerState();
  }

  function setChipStatus(message, tone){
    if (!nodes.chipStatus) return;
    nodes.chipStatus.textContent = message || '';
    nodes.chipStatus.dataset.tone = tone || '';
    nodes.chipStatus.hidden = !message;
  }

  function setWelcomeBonusStatus(message, tone){
    if (!nodes.welcomeBonusStatus) return;
    nodes.welcomeBonusStatus.textContent = message || '';
    nodes.welcomeBonusStatus.dataset.tone = tone || '';
    nodes.welcomeBonusStatus.hidden = !message;
  }

  function setWelcomeBonusVisibility(isVisible){
    setBlockVisibility(nodes.welcomeBonusPanel, isVisible);
    if (nodes.welcomeBonusTitle){ nodes.welcomeBonusTitle.textContent = t('availableChipBonuses', 'Available chip bonuses'); }
    if (nodes.welcomeBonusClaimButton){
      nodes.welcomeBonusClaimButton.hidden = true;
      nodes.welcomeBonusClaimButton.disabled = false;
      nodes.welcomeBonusClaimButton.textContent = t('claimBonus', 'Claim bonus');
    }
    if (!isVisible && nodes.bonusCampaignList){ nodes.bonusCampaignList.innerHTML = ''; }
    if (!isVisible) setWelcomeBonusStatus('', '');
  }

  function formatBonusAmount(value){
    var amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount).toLocaleString() : '0';
  }

  function renderBonusCampaigns(items){
    var campaigns = Array.isArray(items) ? items.filter(function(item){
      return item && item.eligible && !item.alreadyClaimed && item.code;
    }) : [];
    setWelcomeBonusVisibility(campaigns.length > 0);
    if (!nodes.bonusCampaignList) return;
    nodes.bonusCampaignList.innerHTML = '';
    campaigns.forEach(function(item){
      var title = item.title || t('chipBonus', 'Chip bonus');
      var description = item.description || '';
      var amount = formatBonusAmount(item.amount);
      var wrapper = doc.createElement('div');
      wrapper.className = 'account-bonus__item';
      var heading = doc.createElement('div');
      heading.className = 'account-bonus__title';
      heading.textContent = title + ' · +' + amount + ' CH';
      wrapper.appendChild(heading);
      if (description){
        var desc = doc.createElement('p');
        desc.className = 'account-note';
        desc.textContent = description;
        wrapper.appendChild(desc);
      }
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'account-bonus__btn';
      button.dataset.bonusCode = item.code;
      button.textContent = tf('claimBonusAmount', { amount: amount }, 'Claim +{amount} CH');
      wrapper.appendChild(button);
      nodes.bonusCampaignList.appendChild(wrapper);
    });
  }

  function renderChipBalance(balance){
    if (!nodes.chipBalanceValue) return;
    var raw = balance && balance.balance != null ? Number(balance.balance) : null;
    var amount = Number.isFinite(raw) ? raw : null;
    nodes.chipBalanceValue.textContent = amount == null ? '—' : amount.toLocaleString();
  }

  function ledgerEntryKey(entry){
    if (!entry) return null;
    var sortIdText = entry && entry.sort_id != null ? String(entry.sort_id) : '';
    if (sortIdText && /^\d+$/.test(sortIdText)){
      return 'sid:' + sortIdText;
    }
    if (entry.idempotency_key){ return 'idem:' + entry.idempotency_key; }
    if (entry.created_at && entry.entry_seq != null){
      return 'legacy:' + entry.created_at + ':' + entry.entry_seq;
    }
    var resolvedTimestamp = resolveSortTimestamp(entry);
    if (resolvedTimestamp && entry.tx_type && entry.amount != null){
      return 'entry:' + resolvedTimestamp + ':' + entry.tx_type + ':' + entry.amount + ':' + (entry.reference || '');
    }
    if (entry.display_created_at || entry.tx_type || entry.amount != null || entry.reference || entry.description){
      try {
        return 'fallback:' + JSON.stringify({
          display_created_at: entry.display_created_at || entry.created_at || entry.tx_created_at || null,
          tx_type: entry.tx_type || null,
          amount: entry.amount,
          reference: entry.reference || null,
          description: entry.description || null,
        });
      } catch (_err){}
    }
    return null;
  }

  function formatDateTime(value){
    var normalized = normalizeTimestampToIso(value);
    if (!normalized) return '';
    var parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return '';
    var year = String(parsed.getFullYear());
    var month = String(parsed.getMonth() + 1).padStart(2, '0');
    var day = String(parsed.getDate()).padStart(2, '0');
    var hour = String(parsed.getHours()).padStart(2, '0');
    var minute = String(parsed.getMinutes()).padStart(2, '0');
    return year + '-' + month + '-' + day + ' ' + hour + ':' + minute;
  }

  function resolveLedgerTimestamp(entry){
    var candidates = [
      { name: 'display_created_at', value: entry && entry.display_created_at },
      { name: 'created_at', value: entry && entry.created_at },
      { name: 'tx_created_at', value: entry && entry.tx_created_at },
    ];
    for (var i = 0; i < candidates.length; i++){
      var candidate = candidates[i];
      var formatted = formatDateTime(candidate.value);
      if (formatted){ return formatted; }
    }
    klog('chips:ledger_invalid_display_timestamp', {
      display_created_at: entry && entry.display_created_at,
      created_at: entry && entry.created_at,
      tx_created_at: entry && entry.tx_created_at,
      entry_seq: entry && entry.entry_seq,
      sort_id: entry && entry.sort_id,
    });
    return '—';
  }

  function buildLedgerRow(entry){
    var item = doc.createElement('li');
    item.className = 'chip-ledger__item';

    var meta = doc.createElement('div');
    meta.className = 'chip-ledger__meta';

    var type = doc.createElement('div');
    type.className = 'chip-ledger__type';
    type.textContent = entry && entry.tx_type ? entry.tx_type : 'ENTRY';

    var desc = doc.createElement('div');
    desc.className = 'chip-ledger__desc';
    desc.textContent = entry && entry.description ? entry.description : (entry && entry.reference ? entry.reference : '');

    var time = doc.createElement('div');
    time.className = 'chip-ledger__time';
    time.textContent = resolveLedgerTimestamp(entry);

    meta.appendChild(type);
    if (desc.textContent){ meta.appendChild(desc); }
    meta.appendChild(time);

    var amount = doc.createElement('div');
    amount.className = 'chip-ledger__amount';
    var rawAmount = entry && entry.amount != null ? Number(entry.amount) : null;
    var validAmount =
      Number.isFinite(rawAmount) &&
      Math.trunc(rawAmount) === rawAmount &&
      rawAmount !== 0;

    if (validAmount){
      amount.textContent = (rawAmount > 0 ? '+' : '') + rawAmount.toLocaleString();
      amount.className += rawAmount > 0 ? ' chip-ledger__amount--positive' : ' chip-ledger__amount--negative';
    } else {
      amount.textContent = '—';
      item.dataset.invalid = 'amount';
      klog('chips:ledger_invalid_amount', {
        entry_seq: entry && entry.entry_seq,
        raw_amount: entry && entry.raw_amount != null ? entry.raw_amount : null,
        entry: entry,
      });
    }

    item.appendChild(meta);
    item.appendChild(amount);
    return item;
  }

  function buildLedgerStatusRow(message){
    var item = doc.createElement('li');
    item.className = 'chip-ledger__item chip-ledger__item--status';
    item.textContent = message;
    return item;
  }

  function queueLedgerRender(){
    if (ledgerState.renderQueued) return;
    ledgerState.renderQueued = true;
    var raf = (window && window.requestAnimationFrame)
      ? window.requestAnimationFrame
      : function(cb){ return setTimeout(cb, 0); };
    raf(function(){
      ledgerState.renderQueued = false;
      renderLedger();
    });
  }

  function getLedgerTailState(){
    if (ledgerState.loading){ return 'loading'; }
    if (ledgerState.error){ return 'error'; }
    if (!ledgerState.hasMore && ledgerState.entries.length){ return 'end'; }
    return null;
  }

  function renderLedger(){
    if (!nodes.chipLedgerList || !nodes.chipLedgerScroll || !nodes.chipLedgerSpacer) return;
    var entries = ledgerState.entries || [];
    var isEmpty = entries.length === 0 && !ledgerState.loading;
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = !isEmpty; }

    var tailState = getLedgerTailState();
    var totalCount = entries.length + (tailState ? 1 : 0);
    var totalHeight = totalCount * ledgerState.rowHeight;
    nodes.chipLedgerSpacer.style.height = totalHeight + 'px';
    nodes.chipLedgerList.innerHTML = '';
    if (!totalCount) return;

    var scrollTop = nodes.chipLedgerScroll.scrollTop;
    var viewportHeight = nodes.chipLedgerScroll.clientHeight || 0;
    var startIndex = Math.max(0, Math.floor(scrollTop / ledgerState.rowHeight) - ledgerState.overscan);
    var endIndex = Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / ledgerState.rowHeight) + ledgerState.overscan);
    var fragment = doc.createDocumentFragment();
    for (var i = startIndex; i < endIndex; i++){
      var row = null;
      if (i < entries.length){
        row = buildLedgerRow(entries[i]);
      } else if (tailState === 'loading'){
        row = buildLedgerStatusRow(t('loadingMoreActivity', 'Loading more activity...'));
      } else if (tailState === 'error'){
        row = buildLedgerStatusRow(t('chipHistoryLoadMoreError', 'Could not load more activity. Scroll to retry.'));
        row.addEventListener('click', function(){
          loadLedgerPage(true);
        });
      } else if (tailState === 'end'){
        row = buildLedgerStatusRow(t('chipHistoryEnd', 'End of history'));
      }
      if (row){
        row.style.top = (i * ledgerState.rowHeight) + 'px';
        row.style.height = ledgerState.rowHeight + 'px';
        fragment.appendChild(row);
      }
    }
    nodes.chipLedgerList.appendChild(fragment);
  }

  function resetLedgerState(){
    ledgerState.entries = [];
    ledgerState.nextCursor = null;
    ledgerState.hasMore = true;
    ledgerState.loading = false;
    ledgerState.error = null;
    ledgerState.lastLoadAttemptAtMs = 0;
    ledgerState.lastScrollTop = 0;
    ledgerState.renderQueued = false;
    ledgerState.pageIndex = 0;
    ledgerState.pageCursors = [null];
    if (nodes.chipLedgerScroll){ nodes.chipLedgerScroll.scrollTop = 0; }
  }

  function renderLedgerPagination(){
    if (!nodes.chipLedgerPagination) return;
    nodes.chipLedgerPagination.hidden = ledgerState.entries.length === 0 && !ledgerState.loading;
    if (nodes.chipLedgerPrev) nodes.chipLedgerPrev.disabled = ledgerState.loading || ledgerState.pageIndex === 0;
    if (nodes.chipLedgerNext) nodes.chipLedgerNext.disabled = ledgerState.loading || !ledgerState.nextCursor;
    if (nodes.chipLedgerPage) nodes.chipLedgerPage.textContent = tf('chipHistoryPage', { page: ledgerState.pageIndex + 1 }, 'Page {page}');
  }

  function appendLedgerItems(items, nextCursor){
    if (!items || !items.length){
      ledgerState.nextCursor = nextCursor || null;
      ledgerState.hasMore = !!nextCursor;
      queueLedgerRender();
      return;
    }
    var existing = ledgerState.entries || [];
    var merged = [];
    var seen = new Set();
    function addEntry(entry){
      if (!entry) return;
      var key = ledgerEntryKey(entry);
      if (key){
        if (seen.has(key)) return;
        seen.add(key);
      }
      merged.push(entry);
    }
    for (var i = 0; i < existing.length; i++){
      addEntry(existing[i]);
    }
    for (var j = 0; j < items.length; j++){
      addEntry(items[j]);
    }
    merged.sort(function(a, b){
      var aCreated = resolveSortTimestamp(a);
      var bCreated = resolveSortTimestamp(b);
      if (aCreated !== bCreated){
        return aCreated < bCreated ? 1 : -1;
      }
      var aSort = parseSortId(a && a.sort_id != null ? a.sort_id : null);
      var bSort = parseSortId(b && b.sort_id != null ? b.sort_id : null);
      if (aSort === null && bSort === null) {
        var aSeq = a && Number.isInteger(a.entry_seq) ? a.entry_seq : null;
        var bSeq = b && Number.isInteger(b.entry_seq) ? b.entry_seq : null;
        if (aSeq !== null && bSeq !== null) {
          if (aSeq === bSeq) return 0;
          return aSeq < bSeq ? 1 : -1;
        }
        return 0;
      }
      if (aSort === null) return 1;
      if (bSort === null) return -1;
      if (aSort === bSort) {
        var aSeqFallback = a && Number.isInteger(a.entry_seq) ? a.entry_seq : null;
        var bSeqFallback = b && Number.isInteger(b.entry_seq) ? b.entry_seq : null;
        if (aSeqFallback !== null && bSeqFallback !== null) {
          if (aSeqFallback === bSeqFallback) return 0;
          return aSeqFallback < bSeqFallback ? 1 : -1;
        }
        return 0;
      }
      return aSort < bSort ? 1 : -1;
    });
    ledgerState.entries = merged;
    ledgerState.nextCursor = nextCursor || null;
    ledgerState.hasMore = !!nextCursor;
    queueLedgerRender();
  }

  function shouldLoadMore(){
    if (!nodes.chipLedgerScroll) return false;
    if (!ledgerState.hasMore || ledgerState.loading) return false;
    if (ledgerState.error){
      var now = Date.now();
      var scrolledEnough = nodes.chipLedgerScroll.scrollTop >= ledgerState.lastScrollTop + ledgerState.rowHeight;
      var waitedEnough = now - ledgerState.lastLoadAttemptAtMs >= 800;
      if (!scrolledEnough || !waitedEnough) return false;
    }
    var tailState = getLedgerTailState();
    var totalCount = ledgerState.entries.length + (tailState ? 1 : 0);
    var totalHeight = totalCount * ledgerState.rowHeight;
    return nodes.chipLedgerScroll.scrollTop + nodes.chipLedgerScroll.clientHeight >= totalHeight - (ledgerState.rowHeight * 3);
  }

  async function loadLedgerPage(targetIndex){
    if (!window || !window.ChipsClient || typeof window.ChipsClient.fetchLedger !== 'function') return;
    var paginated = !!nodes.chipLedgerPagination;
    var requestedIndex = Number.isInteger(targetIndex) ? targetIndex : ledgerState.pageIndex;
    if ((paginated && (requestedIndex < 0 || requestedIndex >= ledgerState.pageCursors.length)) || (!paginated && !ledgerState.hasMore) || ledgerState.loading) return;
    ledgerState.loading = true;
    ledgerState.error = null;
    ledgerState.lastLoadAttemptAtMs = Date.now();
    ledgerState.lastScrollTop = nodes.chipLedgerScroll ? nodes.chipLedgerScroll.scrollTop : 0;
    queueLedgerRender();
    renderLedgerPagination();
    try {
      var payload = await window.ChipsClient.fetchLedger({
        limit: paginated ? 10 : 50,
        cursor: paginated ? ledgerState.pageCursors[requestedIndex] : ledgerState.nextCursor,
      });
      var items = payload && Array.isArray(payload.items) ? payload.items : (payload && Array.isArray(payload.entries) ? payload.entries : []);
      if (paginated){ ledgerState.entries = []; ledgerState.pageIndex = requestedIndex; }
      appendLedgerItems(items, payload ? payload.nextCursor : null);
      if (paginated){
        if (ledgerState.nextCursor) ledgerState.pageCursors[requestedIndex + 1] = ledgerState.nextCursor;
        ledgerState.pageCursors.length = ledgerState.nextCursor ? requestedIndex + 2 : requestedIndex + 1;
        if (nodes.chipLedgerScroll) nodes.chipLedgerScroll.scrollTop = 0;
      }
      setChipStatus('', '');
    } catch (err){
      setChipStatus(t('chipHistoryLoadError', 'Could not load chip history right now.'), 'error');
      ledgerState.error = 'load_failed';
    } finally {
      ledgerState.loading = false;
      queueLedgerRender();
      renderLedgerPagination();
    }
  }

  function handleLedgerScroll(){
    queueLedgerRender();
    if (!nodes.chipLedgerPagination && shouldLoadMore()) loadLedgerPage();
  }

  async function loadChips(){
    if (
      !currentUser ||
      !window ||
      !window.ChipsClient ||
      typeof window.ChipsClient.fetchBalance !== 'function' ||
      typeof window.ChipsClient.fetchLedger !== 'function'
    ){
      clearChips();
      setBlockVisibility(nodes.chipPanel, false);
      return;
    }

    if (chipsInFlight){ return chipsInFlight; }

    setBlockVisibility(nodes.chipPanel, true);
    setChipStatus(t('syncingChips', 'Syncing chips...'), 'info');
    if (nodes.chipBalanceValue){ nodes.chipBalanceValue.textContent = '—'; }
    if (nodes.chipLedgerList){ nodes.chipLedgerList.innerHTML = ''; }
    if (nodes.chipLedgerSpacer){ nodes.chipLedgerSpacer.style.height = '0px'; }
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = true; }
    resetLedgerState();

    chipsInFlight = (async function(){
      try {
        var balance = await window.ChipsClient.fetchBalance();
        renderChipBalance(balance);
        await loadLedgerPage();
        setChipStatus('', '');
      } catch (err){
        if (err && (err.status === 404 || err.code === 'not_found')){
          clearChips();
          setChipStatus(t('chipsUnavailable', 'Chips are not available right now.'), 'info');
          setBlockVisibility(nodes.chipPanel, false);
          return;
        }
        if (err && err.code === 'not_authenticated'){
          clearChips();
          setBlockVisibility(nodes.chipPanel, false);
          return;
        }
        setChipStatus(t('chipsLoadError', 'Could not load chips right now.'), 'error');
      } finally {
        chipsInFlight = null;
      }
    })();

    return chipsInFlight;
  }

  async function refreshWelcomeBonus(user){
    var userKey = getUserKey(user);
    if (!userKey){
      setWelcomeBonusVisibility(false);
      return null;
    }
    if (
      !window ||
      !window.ChipsClient ||
      typeof window.ChipsClient.fetchBonusCampaigns !== 'function'
    ){
      setWelcomeBonusVisibility(false);
      return null;
    }
    if (welcomeBonusInFlight) return welcomeBonusInFlight;

    welcomeBonusInFlight = (async function(){
      try {
        var payload = await window.ChipsClient.fetchBonusCampaigns();
        var items = payload && Array.isArray(payload.items) ? payload.items : [];
        renderBonusCampaigns(items);
        if (items.length > 0) setWelcomeBonusStatus('', '');
        return payload || null;
      } catch (_err){
        setWelcomeBonusVisibility(false);
        return null;
      } finally {
        welcomeBonusInFlight = null;
      }
    })();

    return welcomeBonusInFlight;
  }

  async function handleWelcomeBonusClaim(e){
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    var target = e && e.target && typeof e.target.closest === 'function'
      ? e.target.closest('[data-bonus-code]')
      : e && e.target && e.target.dataset && e.target.dataset.bonusCode ? e.target : null;
    var code = target && target.dataset && target.dataset.bonusCode
      ? target.dataset.bonusCode
      : target && typeof target.getAttribute === 'function' ? target.getAttribute('data-bonus-code') : '';
    if (!currentUser || !code || !window || !window.ChipsClient || typeof window.ChipsClient.claimBonusCampaign !== 'function') return;
    if (target) target.disabled = true;
    setWelcomeBonusStatus(t('claimingBonus', 'Claiming bonus...'), 'info');
    try {
      var result = await window.ChipsClient.claimBonusCampaign(code);
      if (result && result.claimed){
        setStatus(t('bonusAdded', WELCOME_BONUS_SUCCESS), 'success');
        setWelcomeBonusStatus(t('bonusAdded', WELCOME_BONUS_SUCCESS), 'success');
        loadChips();
        await refreshWelcomeBonus(currentUser);
        return result;
      }
      setWelcomeBonusVisibility(false);
      return result || null;
    } catch (_err){
      setWelcomeBonusStatus(t('bonusClaimError', 'Could not claim your bonus right now.'), 'error');
      if (target) target.disabled = false;
      return null;
    }
  }

  function handleSignIn(e){
    e.preventDefault();
    var email = nodes.signInEmail && nodes.signInEmail.value ? nodes.signInEmail.value.trim() : '';
    var password = nodes.signInPass && nodes.signInPass.value ? nodes.signInPass.value : '';
    if (!validEmail(email)){
      setStatus(t('invalidEmail', 'Enter a valid email address.'), 'error');
      nodes.signInEmail.focus();
      return;
    }
    if (!password){
      setStatus(t('authFieldsRequired', 'Enter both email and password to sign in.'), 'error');
      return;
    }

    if (!auth || !auth.signIn){
      setStatus(t('authenticationNotReady', 'Authentication is not ready. Refresh and try again.'), 'error');
      return;
    }

    setStatus(t('signingIn', 'Signing in...'), 'info');
    auth.signIn(email, password).then(function(res){
      var user = res && res.data && res.data.user ? res.data.user : null;
      if (user){
        setStatus(t('signedInSuccessfully', 'Signed in successfully.'), 'success');
        openAccountPanel(user);
      } else {
        setStatus(t('signedInRedirecting', 'Signed in. Redirecting...'), 'success');
      }
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : t('signInError', 'Could not sign in. Please try again.');
      setStatus(msg, 'error');
    });
  }

  function handleSignUp(e){
    e.preventDefault();
    var email = nodes.signUpEmail && nodes.signUpEmail.value ? nodes.signUpEmail.value.trim() : '';
    var password = nodes.signUpPass && nodes.signUpPass.value ? nodes.signUpPass.value : '';
    var passwordConfirm = nodes.signUpPassConfirm && nodes.signUpPassConfirm.value ? nodes.signUpPassConfirm.value : '';
    if (!validEmail(email)){
      setStatus(t('invalidEmail', 'Enter a valid email address.'), 'error');
      nodes.signUpEmail.focus();
      return;
    }
    if (password.length < 8){
      setStatus(t('passwordTooShort', 'Password must contain at least 8 characters.'), 'error');
      nodes.signUpPass.focus();
      return;
    }
    if (password !== passwordConfirm){
      setStatus(t('passwordsDoNotMatch', 'Passwords do not match.'), 'error');
      nodes.signUpPassConfirm.focus();
      return;
    }
    if (!email || !password){
      setStatus(t('signUpFieldsRequired', 'Enter both email and password to sign up.'), 'error');
      return;
    }

    if (!auth || !auth.signUp){
      setStatus(t('authenticationNotReady', 'Authentication is not ready. Refresh and try again.'), 'error');
      return;
    }

    setStatus(t('creatingAccount', 'Creating your account...'), 'info');
    auth.signUp(email, password).then(function(res){
      var needsVerify = res && res.data && res.data.user && res.data.user.confirmation_sent_at;
      if (needsVerify){
        setStatus(t('verifyEmail', 'Check your inbox to confirm your email.'), 'success');
      } else {
        setStatus(t('accountCreated', 'Account created. You are signed in.'), 'success');
      }
      var user = res && res.data && res.data.user ? res.data.user : null;
      if (user){ renderUser(user); }
      loadChips();
      refreshWelcomeBonus(user || currentUser);
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : t('signUpError', 'Could not sign up. Please try again.');
      setStatus(msg, 'error');
    });
  }

  function showPasswordReset(show){
    if (nodes.signInForm) nodes.signInForm.hidden = !!show;
    if (nodes.passwordResetForm) nodes.passwordResetForm.hidden = !show;
    if (show && nodes.passwordResetEmail){ nodes.passwordResetEmail.value = nodes.signInEmail ? nodes.signInEmail.value : ''; nodes.passwordResetEmail.focus(); }
  }

  function handlePasswordReset(e){
    e.preventDefault();
    var email = nodes.passwordResetEmail && nodes.passwordResetEmail.value ? nodes.passwordResetEmail.value.trim() : '';
    if (!validEmail(email)){ setStatus(t('invalidEmail', 'Enter a valid email address.'), 'error'); return; }
    if (!auth || typeof auth.requestPasswordReset !== 'function'){ setStatus(t('authenticationNotReady', 'Authentication is not ready. Refresh and try again.'), 'error'); return; }
    setStatus(t('sendResetLink', 'Send reset link') + '...', 'info');
    auth.requestPasswordReset(email).then(function(){ setStatus(t('resetLinkSent', 'Check your inbox for the password reset link.'), 'success'); }).catch(function(err){ setStatus(err && err.message ? String(err.message) : t('signInError', 'Could not sign in. Please try again.'), 'error'); });
  }

  function handlePasswordRecovery(e){
    e.preventDefault();
    var password = nodes.recoveryPassword ? nodes.recoveryPassword.value : '';
    var confirmation = nodes.recoveryPasswordConfirm ? nodes.recoveryPasswordConfirm.value : '';
    if (password.length < 8){ setStatus(t('passwordTooShort', 'Password must contain at least 8 characters.'), 'error'); return; }
    if (password !== confirmation){ setStatus(t('passwordsDoNotMatch', 'Passwords do not match.'), 'error'); return; }
    auth.updatePassword(password).then(function(){
      return auth.getCurrentUser();
    }).then(function(user){
      if (!user) throw new Error('not_authenticated');
      if (nodes.recoveryPassword) nodes.recoveryPassword.value = '';
      if (nodes.recoveryPasswordConfirm) nodes.recoveryPasswordConfirm.value = '';
      if (nodes.passwordRecoveryForm) nodes.passwordRecoveryForm.hidden = true;
      passwordRecoveryActive = false;
      openAccountPanel(user);
      setStatus(t('passwordUpdated', 'Password updated. You can continue to your profile.'), 'success');
    }).catch(function(err){ setStatus(err && err.message ? String(err.message) : t('signInError', 'Could not sign in. Please try again.'), 'error'); });
  }

  function showPasswordRecovery(){
    passwordRecoveryActive = true;
    setBlockVisibility(nodes.forms, true);
    setBlockVisibility(nodes.account, false);
    if (nodes.signInForm) nodes.signInForm.hidden = true;
    if (nodes.passwordResetForm) nodes.passwordResetForm.hidden = true;
    if (nodes.passwordRecoveryForm) nodes.passwordRecoveryForm.hidden = false;
    if (nodes.recoveryPassword) nodes.recoveryPassword.focus();
  }

  function handleSignOut(){
    setStatus(t('signingOut', 'Signing out...'), 'info');
    if (!auth || !auth.signOut){
      setStatus(t('authenticationNotReady', 'Authentication is not ready. Refresh and try again.'), 'error');
      return;
    }

    auth.signOut().then(function(){
      setStatus(t('signedOut', 'Signed out.'), 'success');
      renderUser(null);
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : t('signOutError', 'Could not sign out right now.');
      setStatus(msg, 'error');
    });
  }

  function wireEvents(){
    if (nodes.signInForm){ nodes.signInForm.addEventListener('submit', handleSignIn); }
    if (nodes.signUpForm){ nodes.signUpForm.addEventListener('submit', handleSignUp); }
    if (nodes.forgotPasswordButton) nodes.forgotPasswordButton.addEventListener('click', function(){ showPasswordReset(true); });
    if (nodes.passwordResetBack) nodes.passwordResetBack.addEventListener('click', function(){ showPasswordReset(false); });
    if (nodes.passwordResetForm) nodes.passwordResetForm.addEventListener('submit', handlePasswordReset);
    if (nodes.passwordRecoveryForm) nodes.passwordRecoveryForm.addEventListener('submit', handlePasswordRecovery);
    if (nodes.signOut){ nodes.signOut.addEventListener('click', handleSignOut); }
    if (nodes.bonusCampaignList){ nodes.bonusCampaignList.addEventListener('click', handleWelcomeBonusClaim); }
    if (nodes.welcomeBonusClaimButton){ nodes.welcomeBonusClaimButton.addEventListener('click', handleWelcomeBonusClaim); }
    if (nodes.publicProfileForm){ nodes.publicProfileForm.addEventListener('submit', handlePublicProfileSave); }
    if (nodes.publicAvatarChoose){ nodes.publicAvatarChoose.addEventListener('click', handleAvatarChoose); }
    if (nodes.publicAvatarInput){ nodes.publicAvatarInput.addEventListener('change', handleAvatarSelected); }
    if (nodes.publicAvatarRemove){ nodes.publicAvatarRemove.addEventListener('click', handleAvatarRemove); }
    if (nodes.deleteBtn && nodes.deleteNote){
      nodes.deleteBtn.addEventListener('click', function(e){
        e.preventDefault();
        setStatus(t('deleteAccountSupport', 'Contact support to request account deletion for this profile.'), 'info');
        nodes.deleteNote.focus();
      });
    }

    doc.addEventListener('auth:signin-request', function(){
      setBlockVisibility(nodes.forms, true);
      setBlockVisibility(nodes.account, false);
      if (nodes.signInEmail){ nodes.signInEmail.focus(); }
    });

    if (nodes.chipLedgerScroll) nodes.chipLedgerScroll.addEventListener('scroll', handleLedgerScroll);
    if (nodes.chipLedgerPrev) nodes.chipLedgerPrev.addEventListener('click', function(){ loadLedgerPage(ledgerState.pageIndex - 1); });
    if (nodes.chipLedgerNext) nodes.chipLedgerNext.addEventListener('click', function(){ if (ledgerState.nextCursor) loadLedgerPage(ledgerState.pageIndex + 1); });
    window.addEventListener('resize', queueLedgerRender);
  }

  function hydrateUser(){
    if (!auth || !auth.getCurrentUser){
      setStatus(t('authNotConfigured', 'Authentication is not configured yet.'), 'error');
      return;
    }

    if (typeof auth.isPasswordRecoveryPending === 'function' && auth.isPasswordRecoveryPending()) showPasswordRecovery();
    setStatus(passwordRecoveryActive ? '' : t('checkingSession', 'Checking session...'), passwordRecoveryActive ? '' : 'info');
    auth.getCurrentUser().then(function(user){
      if (passwordRecoveryActive) return;
      renderUser(user);
      setStatus(user ? t('signedIn', 'Signed in.') : '', user ? 'success' : '');
      if (user){
        loadChips();
        refreshWelcomeBonus(user);
      } else {
        clearChips();
        setWelcomeBonusVisibility(false);
        setBlockVisibility(nodes.chipPanel, false);
      }
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : t('signInError', 'Could not load your session. Please try again.');
      setStatus(msg, 'error');
    });

    if (auth.onAuthChange){
      auth.onAuthChange(function(event, user){
        if (event === 'PASSWORD_RECOVERY'){
          showPasswordRecovery();
          return;
        }
        renderUser(user);
        if (user){
          setStatus(t('signedIn', 'Signed in.'), 'success');
          loadChips();
          refreshWelcomeBonus(user);
        } else {
          setStatus(t('signedOutNotice', 'You have been signed out.'), 'info');
          clearChips();
          setWelcomeBonusVisibility(false);
          setBlockVisibility(nodes.chipPanel, false);
        }
      });
    }
  }

  function init(){
    auth = (typeof window !== 'undefined' && window.SupabaseAuth) ? window.SupabaseAuth : null;
    selectNodes();
    setWelcomeBonusVisibility(false);
    wireEvents();
    hydrateUser();

    doc.addEventListener('chips:tx-complete', loadChips);
    doc.addEventListener('profile:updated', function(event){ renderPublicProfile(event && event.detail ? event.detail : null); });
    doc.addEventListener('langchange', function(){
      setWelcomeBonusVisibility(nodes.welcomeBonusPanel && !nodes.welcomeBonusPanel.hidden);
      if (currentUser){ refreshWelcomeBonus(currentUser); }
      queueLedgerRender();
    });
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
