(function(){
  if (typeof window === 'undefined') return;

  var VERSION = 1;
  var PREFIX = 'kcswh:user-ui:';
  var CHANNEL_NAME = 'kcswh:user-ui:v1';
  var OFFLINE_AVATAR_KEY = 'kcswh:offline-avatar:v1';
  var MAX_AGE = { profile: 7 * 24 * 60 * 60 * 1000, xp: 15 * 60 * 1000, chips: 5 * 60 * 1000 };
  var listeners = [];
  var activeUserId = null;
  var generation = 0;
  var channel = null;
  var appliedAt = { profile: 0, xp: 0, chips: 0 };
  var sliceStates = { profile: 'pending', xp: 'pending', chips: 'pending' };

  function klog(kind, data){
    try { if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {}); } catch (_err){}
  }

  function storage(){
    try { return window.localStorage || null; } catch (_err){ return null; }
  }

  function key(slice, userId){ return PREFIX + slice + ':v' + VERSION + ':' + userId; }

  function validUserId(value){ return typeof value === 'string' && value.length > 0 && value.length <= 128; }

  function decodeBase64(value){
    try {
      if (typeof atob === 'function') return atob(value);
      if (typeof window !== 'undefined' && typeof window.atob === 'function') return window.atob(value);
    } catch (_err){}
    return null;
  }

  function encodeBase64(value){
    try {
      if (typeof btoa === 'function') return btoa(value);
      if (typeof window !== 'undefined' && typeof window.btoa === 'function') return window.btoa(value);
    } catch (_err){}
    return null;
  }

  function validPhoto(userId, path, dataUrl){
    if (!validUserId(userId)) return false;
    if (typeof path !== 'string' || !/^pending\/[0-9a-f-]{36}$/.test(path)) return false;
    if (typeof dataUrl !== 'string') return false;
    var prefix = 'data:image/webp;base64,';
    if (dataUrl.indexOf(prefix) !== 0) return false;
    var b64 = dataUrl.slice(prefix.length);
    if (!b64 || b64.length > 65536 || b64.length % 4 !== 0) return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
    var raw = decodeBase64(b64);
    if (!raw || raw.length < 12 || raw.length > 49152) return false;
    if (raw.slice(0, 4) !== 'RIFF' || raw.slice(8, 12) !== 'WEBP') return false;
    var reencoded = encodeBase64(raw);
    if (reencoded !== b64) return false;
    return true;
  }

  function normalizeAvatar(value){
    var avatar = value && typeof value === 'object' ? value : {};
    var type = avatar.type === 'uploaded' ? 'uploaded' : 'default';
    var variant = typeof avatar.variant === 'string' && /^[a-z0-9-]{1,40}$/.test(avatar.variant) ? avatar.variant : 'default';
    var result = { type: type, variant: variant };
    // Persist only the photo marker, never a signed bearer URL or image.
    return result;
  }

  function normalize(slice, value){
    if (!value || typeof value !== 'object') return null;
    if (slice === 'profile'){
      var displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
      if (!displayName || displayName.length > 40) return null;
      return { displayName: displayName, avatar: normalizeAvatar(value.avatar) };
    }
    if (slice === 'xp'){
      var total = Number(value.totalLifetime);
      var level = Number(value.level);
      if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(level) || level < 1) return null;
      return { totalLifetime: total, level: level };
    }
    if (slice === 'chips'){
      var balance = Number(value.balance);
      if (!Number.isSafeInteger(balance) || balance < 0) return null;
      return { balance: balance };
    }
    return null;
  }

  function parseRecord(slice, userId, raw, now){
    var record;
    try { record = JSON.parse(raw); } catch (_err){ return null; }
    if (!record || record.version !== VERSION || record.userId !== userId) return null;
    var confirmedAt = Number(record.confirmedAt);
    if (!Number.isSafeInteger(confirmedAt) || confirmedAt < 1 || now - confirmedAt > MAX_AGE[slice]) return null;
    var value = normalize(slice, record.value);
    return value ? { version: VERSION, userId: userId, confirmedAt: confirmedAt, value: value } : null;
  }

  function read(slice, userId){
    var store = storage();
    if (!store) return null;
    var cacheKey = key(slice, userId);
    var raw;
    try { raw = store.getItem(cacheKey); } catch (_err){ return null; }
    if (!raw) return null;
    var record = parseRecord(slice, userId, raw, Date.now());
    if (!record){ try { store.removeItem(cacheKey); } catch (_err){} }
    else if (slice === 'profile' && record.value.avatar.type === 'uploaded'){
      // Strip signed URLs left by older clients on this origin.
      try { store.setItem(cacheKey, JSON.stringify(record)); } catch (_err){}
    }
    return record;
  }

  function setTopbarState(value){
    try {
      var bars = document.querySelectorAll('.topbar');
      for (var i = 0; i < bars.length; i++) bars[i].setAttribute('data-user-ui-state', value);
    } catch (_err){}
  }

  function setSliceState(slice, value){
    if (!Object.prototype.hasOwnProperty.call(MAX_AGE, slice)) return false;
    sliceStates[slice] = value;
    try {
      var bars = document.querySelectorAll('.topbar');
      for (var i = 0; i < bars.length; i++) bars[i].setAttribute('data-user-ui-' + slice + '-state', value);
    } catch (_err){}
    if (slice === 'profile') setTopbarState(value);
    return true;
  }

  function setAllSliceStates(value){
    ['profile', 'xp', 'chips'].forEach(function(slice){ setSliceState(slice, value); });
  }

  function emit(detail){
    for (var i = 0; i < listeners.length; i++){
      try { listeners[i](detail); } catch (_err){}
    }
    try { document.dispatchEvent(new CustomEvent('user-ui:change', { detail: detail })); } catch (_err){}
  }

  // Visual-only projection. Offline never needs the account cache or Auth records.
  function syncOfflineAvatar(userId, profile){
    var store = storage();
    if (!store || activeUserId !== userId) return;
    try {
      store.removeItem(OFFLINE_AVATAR_KEY);
      var ownKey = key('offline-avatar', userId);
      var variant = profile ? profile.avatar && profile.avatar.type !== 'uploaded' && profile.avatar.variant : store.getItem(ownKey);
      var catalog = window.ArcadeAvatars;
      if (!catalog || catalog.variants.indexOf(variant) === -1){ if (profile) store.removeItem(ownKey); return; }
      if (profile) store.setItem(ownKey, variant);
      store.setItem(OFFLINE_AVATAR_KEY, variant);
    } catch (_err){ klog('user_ui_offline_avatar_unavailable'); }
  }

  function hydrate(userId){
    if (!validUserId(userId)) return { generation: generation, profile: null, xp: null, chips: null };
    if (activeUserId !== userId){
      generation += 1;
      appliedAt = { profile: 0, xp: 0, chips: 0 };
      setAllSliceStates('loading');
    }
    activeUserId = userId;
    var result = { generation: generation, profile: null, xp: null, chips: null };
    ['profile', 'xp', 'chips'].forEach(function(slice){
      var record = read(slice, userId);
      if (record){
        result[slice] = record.value;
        appliedAt[slice] = record.confirmedAt;
      }
    });
    syncOfflineAvatar(userId, result.profile);
    return result;
  }

  function isCurrent(userId, expectedGeneration){
    return activeUserId === userId && generation === expectedGeneration;
  }

  function getActiveContext(){
    return activeUserId ? { userId: activeUserId, generation: generation } : null;
  }

  function writeRecord(record){
    var store = storage();
    if (!store) return false;
    try { store.setItem(key(record.slice, record.userId), JSON.stringify({ version: VERSION, userId: record.userId, confirmedAt: record.confirmedAt, value: record.value })); return true; }
    catch (_err){ return false; }
  }

  function publish(userId, slice, value, confirmedAt){
    if (!validUserId(userId) || activeUserId !== userId || !Object.prototype.hasOwnProperty.call(MAX_AGE, slice)) return null;
    var normalized = normalize(slice, value);
    if (!normalized) return null;
    var timestamp = Number(confirmedAt);
    if (!Number.isSafeInteger(timestamp) || timestamp < 1) timestamp = Date.now();
    var record = { version: VERSION, userId: userId, slice: slice, confirmedAt: timestamp, value: normalized };
    writeRecord(record);
    if (slice === 'profile') syncOfflineAvatar(userId, normalized);
    appliedAt[slice] = timestamp;
    setSliceState(slice, 'ready');
    emit(record);
    if (channel){ try { channel.postMessage(record); } catch (_err){} }
    return normalized;
  }

  function readActiveSlice(slice){
    if (!activeUserId || !Object.prototype.hasOwnProperty.call(MAX_AGE, slice)) return null;
    var record = read(slice, activeUserId);
    return record ? record.value : null;
  }

  function readPhoto(userId){
    if (!validUserId(userId)) return { available: false };
    var store = storage();
    if (!store) return { available: false };
    var cacheKey = key('photo', userId);
    var raw;
    try {
      raw = store.getItem(cacheKey);
    } catch (_err){
      return { available: false };
    }
    if (!raw) return { available: true, record: null };
    var record;
    try {
      record = JSON.parse(raw);
    } catch (_err){
      try { store.removeItem(cacheKey); } catch (_e){}
      return { available: true, record: null };
    }
    var now = Date.now();
    var savedAt = Number(record && record.savedAt);
    if (!record || record.version !== VERSION || record.userId !== userId || !validPhoto(userId, record.path, record.dataUrl) || !Number.isSafeInteger(savedAt) || savedAt < 1 || now - savedAt > 7 * 24 * 60 * 60 * 1000 || savedAt > now){
      try { store.removeItem(cacheKey); } catch (_e){}
      return { available: true, record: null };
    }
    return { available: true, record: { version: VERSION, userId: userId, savedAt: savedAt, path: record.path, dataUrl: record.dataUrl } };
  }

  function writePhoto(userId, record){
    if (!validUserId(userId) || !record) return false;
    if (!validPhoto(userId, record.path, record.dataUrl)) return false;
    var store = storage();
    if (!store) return false;
    var cacheKey = key('photo', userId);
    var toStore = { version: VERSION, userId: userId, savedAt: Date.now(), path: record.path, dataUrl: record.dataUrl };
    try {
      store.setItem(cacheKey, JSON.stringify(toStore));
      return true;
    } catch (_err){
      return false;
    }
  }

  function clearPhoto(userId){
    if (!validUserId(userId)) return;
    var store = storage();
    if (!store) return;
    try { store.removeItem(key('photo', userId)); } catch (_err){}
  }

  function clearUser(userId){
    if (!validUserId(userId)) return;
    var store = storage();
    if (store){
      ['profile', 'xp', 'chips', 'photo', 'offline-avatar'].forEach(function(slice){ try { store.removeItem(key(slice, userId)); } catch (_err){} });
      if (activeUserId === userId){ try { store.removeItem(OFFLINE_AVATAR_KEY); } catch (_err){} }
    }
    if (activeUserId === userId){ activeUserId = null; appliedAt = { profile: 0, xp: 0, chips: 0 }; generation += 1; setAllSliceStates('pending'); }
  }

  function setAnonymous(){
    try {
      var store = storage();
      if (store){
        store.removeItem(OFFLINE_AVATAR_KEY);
        var photoPrefix = PREFIX + 'photo:v' + VERSION + ':';
        var toRemove = [];
        if (typeof store.length === 'number' && typeof store.key === 'function'){
          for (var i = 0; i < store.length; i++){
            var k = store.key(i);
            if (k && k.indexOf(photoPrefix) === 0) toRemove.push(k);
          }
        } else {
          var keys = Object.keys(store);
          for (var j = 0; j < keys.length; j++){
            if (keys[j] && keys[j].indexOf(photoPrefix) === 0) toRemove.push(keys[j]);
          }
        }
        for (var m = 0; m < toRemove.length; m++) store.removeItem(toRemove[m]);
      }
    } catch (_err){}
    activeUserId = null;
    appliedAt = { profile: 0, xp: 0, chips: 0 };
    generation += 1;
    setAllSliceStates('anonymous');
  }

  function markSliceApplied(userId, slice, value){
    if (activeUserId !== userId) return false;
    return setSliceState(slice, value);
  }

  function markActiveSliceApplied(slice, value){
    if (!activeUserId) return false;
    return setSliceState(slice, value);
  }

  function markRefreshFailed(userId, expectedGeneration, hasCachedValue){
    if (!isCurrent(userId, expectedGeneration)) return;
    setSliceState('profile', hasCachedValue ? 'stale' : 'loading');
  }

  function onChange(listener){
    if (typeof listener !== 'function') return function(){};
    listeners.push(listener);
    return function(){ listeners = listeners.filter(function(item){ return item !== listener; }); };
  }

  function acceptExternal(record){
    if (!record || record.version !== VERSION || record.userId !== activeUserId || !Object.prototype.hasOwnProperty.call(MAX_AGE, record.slice)) return;
    var normalized = normalize(record.slice, record.value);
    var confirmedAt = Number(record.confirmedAt);
    if (!normalized || !Number.isSafeInteger(confirmedAt) || confirmedAt < 1) return;
    if (appliedAt[record.slice] >= confirmedAt) return;
    var accepted = { version: VERSION, userId: activeUserId, slice: record.slice, confirmedAt: confirmedAt, value: normalized };
    writeRecord(accepted);
    if (record.slice === 'profile') syncOfflineAvatar(activeUserId, normalized);
    appliedAt[record.slice] = confirmedAt;
    setSliceState(record.slice, 'ready');
    emit(accepted);
  }

  try {
    if (typeof window.BroadcastChannel === 'function'){
      channel = new window.BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', function(event){ acceptExternal(event && event.data); });
    }
  } catch (_err){ channel = null; }

  window.addEventListener('storage', function(event){
    if (!event || typeof event.key !== 'string' || event.key.indexOf(PREFIX) !== 0 || !event.newValue) return;
    var parts = event.key.split(':');
    var slice = parts[2];
    var userId = parts.slice(4).join(':');
    var parsed;
    try { parsed = JSON.parse(event.newValue); } catch (_err){ return; }
    if (parsed) parsed.slice = slice;
    if (parsed && parsed.userId === userId) acceptExternal(parsed);
  });

  window.UserUiState = { hydrate: hydrate, publish: publish, readActiveSlice: readActiveSlice, getActiveContext: getActiveContext, clearUser: clearUser, setAnonymous: setAnonymous, isCurrent: isCurrent, markSliceApplied: markSliceApplied, markActiveSliceApplied: markActiveSliceApplied, markRefreshFailed: markRefreshFailed, onChange: onChange, readPhoto: readPhoto, writePhoto: writePhoto, clearPhoto: clearPhoto };
  klog('user_ui_state_ready', { version: VERSION });
})();
