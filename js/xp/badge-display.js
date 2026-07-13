(function(window, document){
  if (!window || !document || window.XP) return;

  var LEVEL_BASE_XP = 100;
  var LEVEL_MULTIPLIER = 1.35;
  var state = { totalXp: null, level: null };

  function computeLevel(totalXp){
    var total = Math.max(0, Math.floor(Number(totalXp) || 0));
    var level = 1;
    var requirement = LEVEL_BASE_XP;
    var accumulated = 0;
    while (total >= accumulated + requirement){
      accumulated += requirement;
      level += 1;
      requirement = Math.max(1, Math.ceil(requirement * LEVEL_MULTIPLIER));
    }
    return level;
  }

  function locale(){
    try { return window.I18N && window.I18N.getLang() === 'pl' ? 'pl-PL' : 'en-US'; } catch (_err){ return 'en-US'; }
  }

  function badge(){ return document.getElementById('xpBadge'); }

  function render(){
    var node = badge();
    if (!node || !Number.isSafeInteger(state.totalXp) || state.totalXp < 0) return;
    var label = node.querySelector('.xp-badge__label');
    if (!label){
      label = document.createElement('span');
      label.className = 'xp-badge__label';
      node.textContent = '';
      node.appendChild(label);
    }
    label.textContent = 'Lvl ' + state.level + ', ' + state.totalXp.toLocaleString(locale()) + ' XP';
    node.classList.remove('xp-badge--loading');
    node.setAttribute('aria-busy', 'false');
  }

  function refreshFromServerStatus(payload){
    var total = Number(payload && payload.totalLifetime);
    if (!Number.isSafeInteger(total) || total < 0) return null;
    state.totalXp = total;
    state.level = computeLevel(total);
    render();
    return payload;
  }

  function resetIdentityCache(options){
    state.totalXp = null;
    state.level = null;
    if (options && options.preserveBadge === true) return;
    var node = badge();
    if (!node) return;
    var label = node.querySelector('.xp-badge__label');
    if (label) label.textContent = 'XP';
    node.classList.add('xp-badge--loading');
    node.setAttribute('aria-busy', 'true');
  }

  function getSnapshot(){
    if (!Number.isSafeInteger(state.totalXp) || !Number.isSafeInteger(state.level)) return null;
    return { totalXp: state.totalXp, level: state.level };
  }

  document.addEventListener('langchange', render);
  window.XP = { refreshFromServerStatus: refreshFromServerStatus, resetIdentityCache: resetIdentityCache, getSnapshot: getSnapshot };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
