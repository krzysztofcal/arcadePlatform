(function(){
  if (typeof window === 'undefined') return;

  var VERSION = 1;
  var PREFIX = 'kcswh:user-ui:';
  var CHANNEL_NAME = 'kcswh:user-ui:v1';
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

  function normalizeAvatar(value){
    var avatar = value && typeof value === 'object' ? value : {};
    var type = avatar.type === 'uploaded' ? 'uploaded' : 'default';
    var variant = typeof avatar.variant === 'string' && /^[a-z0-9-]{1,40}$/.test(avatar.variant) ? avatar.variant : 'default';
    var result = { type: type, variant: variant };
    if (type === 'uploaded' && typeof avatar.url === 'string' && /^https:\/\/[^\s"\\]{1,2048}$/.test(avatar.url)) result.url = avatar.url;
    if (type === 'uploaded' && !result.url) result.type = 'default';
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

  function clearUser(userId){
    if (!validUserId(userId)) return;
    var store = storage();
    if (store){
      ['profile', 'xp', 'chips'].forEach(function(slice){ try { store.removeItem(key(slice, userId)); } catch (_err){} });
    }
    if (activeUserId === userId){ activeUserId = null; appliedAt = { profile: 0, xp: 0, chips: 0 }; generation += 1; setAllSliceStates('pending'); }
  }

  function setAnonymous(){ activeUserId = null; appliedAt = { profile: 0, xp: 0, chips: 0 }; generation += 1; setAllSliceStates('anonymous'); }

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

  window.UserUiState = { hydrate: hydrate, publish: publish, readActiveSlice: readActiveSlice, getActiveContext: getActiveContext, clearUser: clearUser, setAnonymous: setAnonymous, isCurrent: isCurrent, markSliceApplied: markSliceApplied, markActiveSliceApplied: markActiveSliceApplied, markRefreshFailed: markRefreshFailed, onChange: onChange };
  klog('user_ui_state_ready', { version: VERSION });
})();
