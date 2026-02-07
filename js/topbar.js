(function(){
  if (typeof document === 'undefined') return;
  const doc = document;
  const win = window;
  if (win.__topbarBooted) return;
  win.__topbarBooted = true;
  const chipNodes = { badge: null, amount: null, ready: false };
  let chipInFlight = null;
  let chipsClientWaitTries = 0;
  const AuthState = { UNKNOWN: 0, SIGNED_OUT: 1, SIGNED_IN: 2 };
  let authState = AuthState.SIGNED_OUT;
  let authWired = false;
  let authWireAttempts = 0;
  const CHIP_BADGE_HREF = '/account.html#chipPanel';

  function setAuthDataset(state){
    if (!doc || !doc.documentElement) return;
    doc.documentElement.dataset.auth = state;
  }

  setAuthDataset('out');

  function isAuthed(){
    return authState === AuthState.SIGNED_IN;
  }

  function pickPreferredTopbar(list){
    if (!list || !list.length) return null;
    for (let i = 0; i < list.length; i++){
      const el = list[i];
      try {
        if (el && el.querySelector && el.querySelector('#xpBadge')){
          return el;
        }
      } catch (_){ /* noop */ }
    }
    return list[0] || null;
  }

  function prune(){
    const topbars = Array.from(doc.querySelectorAll('.topbar'));
    if (topbars.length > 1){
      const keep = pickPreferredTopbar(topbars);
      topbars.forEach(el => {
        if (!el || el === keep) return;
        try {
          el.remove();
        } catch (_){
          if (el.parentNode){
            try { el.parentNode.removeChild(el); } catch (_err){}
          }
        }
      });
    }

    const toggleButtons = Array.from(doc.querySelectorAll('#sbToggle'));
    if (toggleButtons.length > 1){
      const keepToggle = toggleButtons.find(btn => {
        try {
          return !!(btn && btn.closest && btn.closest('.topbar'));
        } catch (_){ return false; }
      }) || toggleButtons[0];

      toggleButtons.forEach(btn => {
        if (btn === keepToggle) return;
        try {
          btn.removeAttribute('id');
        } catch (_){ }
      });
    }
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', prune, { once: true });
  } else {
    prune();
  }

  function ensureTopbarRight(){
    const topbar = doc.querySelector('.topbar');
    if (!topbar) return null;
    let right = topbar.querySelector('.topbar-right');
    if (!right){
      right = doc.createElement('div');
      right.className = 'topbar-right';
      topbar.appendChild(right);
    }
    return right;
  }

  function moveNode(node, container, before){
    if (!node || !container) return;
    if (before && before.parentNode === container){
      container.insertBefore(node, before);
      return;
    }
    container.appendChild(node);
  }

  function ensureChipBadge(topbarRight){
    let badge = doc.getElementById('chipBadge');
    if (!badge){
      badge = doc.createElement('a');
      badge.id = 'chipBadge';
      badge.className = 'chip-badge chip-pill chip-pill--loading';
      badge.setAttribute('aria-live', 'polite');
      badge.setAttribute('aria-busy', 'true');
      badge.setAttribute('href', CHIP_BADGE_HREF);
      badge.hidden = true;
      const label = doc.createElement('span');
      label.className = 'chip-badge__label';
      label.appendChild(doc.createTextNode('CH: '));
      const amount = doc.createElement('span');
      amount.id = 'chipBadgeAmount';
      amount.textContent = '';
      label.appendChild(amount);
      badge.appendChild(label);
    } else if (badge.getAttribute('href') !== CHIP_BADGE_HREF){
      badge.setAttribute('href', CHIP_BADGE_HREF);
    }
    let amount = doc.getElementById('chipBadgeAmount');
    if (!amount){
      const label = badge.querySelector('.chip-badge__label');
      amount = doc.createElement('span');
      amount.id = 'chipBadgeAmount';
      amount.textContent = '';
      if (label){
        if (label.textContent.indexOf('CH:') === -1){
          label.insertBefore(doc.createTextNode('CH: '), label.firstChild || null);
        }
        label.appendChild(amount);
      } else {
        const wrap = doc.createElement('span');
        wrap.className = 'chip-badge__label';
        wrap.appendChild(doc.createTextNode('CH: '));
        wrap.appendChild(amount);
        badge.textContent = '';
        badge.appendChild(wrap);
      }
    }
    if (topbarRight && badge.parentNode !== topbarRight){
      topbarRight.appendChild(badge);
    }
    return badge;
  }

  function normalizeTopbarBadges(){
    const topbarRight = ensureTopbarRight();
    if (!topbarRight) return;
    const avatarShell = doc.getElementById('avatarShell');
    const xpBadge = doc.getElementById('xpBadge');
    const chipBadge = ensureChipBadge(topbarRight);
    if (xpBadge && xpBadge.parentNode !== topbarRight){ topbarRight.appendChild(xpBadge); }
    if (chipBadge && chipBadge.parentNode !== topbarRight){ topbarRight.appendChild(chipBadge); }
    if (avatarShell && avatarShell.parentNode !== topbarRight){ topbarRight.appendChild(avatarShell); }
    if (xpBadge && chipBadge){ moveNode(xpBadge, topbarRight, chipBadge); }
    if (chipBadge && avatarShell){ moveNode(chipBadge, topbarRight, avatarShell); }
    if (xpBadge && avatarShell && !chipBadge){ moveNode(xpBadge, topbarRight, avatarShell); }
  }

  function refreshXpBadge(){
    if (!window || !window.XPClient || typeof window.XPClient.refreshBadgeFromServer !== 'function') return;
    try {
      window.XPClient.refreshBadgeFromServer({ bumpBadge: true });
    } catch (_err){}
  }

  function ensureChipNodes(){
    if (chipNodes.ready) return;
    chipNodes.badge = doc.getElementById('chipBadge');
    chipNodes.amount = doc.getElementById('chipBadgeAmount');
    chipNodes.ready = true;
  }

  function setChipBadge(text, options){
    ensureChipNodes();
    const badge = chipNodes.badge;
    const amount = chipNodes.amount;
    if (!badge || !amount) return;
    if (!isAuthed()) return;
    const loading = !!(options && options.loading);
    amount.textContent = text || '';
    if (loading){
      badge.classList.add('chip-pill--loading');
      badge.setAttribute('aria-busy', 'true');
    } else {
      badge.classList.remove('chip-pill--loading');
      badge.setAttribute('aria-busy', 'false');
    }
  }

  function hideChipBadge(){
    ensureChipNodes();
    if (chipNodes.badge){
      chipNodes.badge.classList.remove('chip-pill--loading');
      chipNodes.badge.setAttribute('aria-busy', 'false');
      chipNodes.badge.hidden = true;
    }
    if (chipNodes.amount){ chipNodes.amount.textContent = ''; }
  }

  function renderChipBadgeBalance(amount){
    const formatKey = 'format' + 'CompactNumber';
    const formatter = window && window.ArcadeFormat && typeof window.ArcadeFormat[formatKey] === 'function'
      ? window.ArcadeFormat[formatKey]
      : null;
    const text = amount == null ? '—' : formatter ? formatter(amount) : String(Math.round(amount));
    setChipBadge(text, { loading: false });
  }

  function setAuthState(next){
    if (authState === next) return;
    authState = next;
    setAuthDataset(next === AuthState.SIGNED_IN ? 'in' : 'out');
    const badge = doc.getElementById('chipBadge');
    const amount = doc.getElementById('chipBadgeAmount');
    if (badge){
      badge.hidden = !isAuthed();
      badge.classList.remove('chip-pill--loading');
      badge.setAttribute('aria-busy', 'false');
    }
    if (amount){ amount.textContent = ''; }
    if (!isAuthed()){
      hideChipBadge();
      return;
    }
    if (badge){ badge.hidden = false; }
    setChipBadge('', { loading: true });
    refreshChipBadge();
  }

  function resolveInitialAuth(){
    if (!window || !window.SupabaseAuth || typeof window.SupabaseAuth.getCurrentUser !== 'function') return;
    window.SupabaseAuth.getCurrentUser().then(function(user){
      setAuthState(user ? AuthState.SIGNED_IN : AuthState.SIGNED_OUT);
      if (!isAuthed()){
        hideChipBadge();
        return;
      }
      refreshXpBadge();
      refreshChipBadge();
    }).catch(function(){
      setAuthState(AuthState.SIGNED_OUT);
      hideChipBadge();
    });
  }

  async function refreshChipBadge(){
    normalizeTopbarBadges();
    ensureChipNodes();
    if (!isAuthed()){
      hideChipBadge();
      return;
    }
    if (!chipNodes.badge) return;
    if (!window || !window.ChipsClient || typeof window.ChipsClient.fetchBalance !== 'function'){
      if (chipsClientWaitTries < 6){
        chipsClientWaitTries += 1;
        setChipBadge('', { loading: true });
        setTimeout(refreshChipBadge, 150);
        return;
      }
      chipsClientWaitTries = 0;
      hideChipBadge();
      return;
    }
    chipsClientWaitTries = 0;
    if (chipInFlight){ return chipInFlight; }
    setChipBadge('', { loading: true });
    chipInFlight = (async function(){
      let timeoutId = null;
      try {
        const timeoutMs = 5000;
        const timeoutPromise = new Promise(function(_resolve, reject){
          timeoutId = setTimeout(function(){
            const err = new Error('chips_timeout');
            err.code = 'timeout';
            reject(err);
          }, timeoutMs);
        });
        const balance = await Promise.race([window.ChipsClient.fetchBalance(), timeoutPromise]);
        const raw = balance && balance.balance != null ? Number(balance.balance) : null;
        const value = Number.isFinite(raw) ? raw : null;
        renderChipBadgeBalance(value);
      } catch (err){
        if (err && err.code === 'timeout'){
          hideChipBadge();
          return;
        }
        if (err && (err.status === 404 || err.code === 'not_found')){
          hideChipBadge();
          return;
        }
        if (err && err.code === 'not_authenticated'){
          setAuthState(AuthState.SIGNED_OUT);
          hideChipBadge();
          return;
        }
        hideChipBadge();
      } finally {
        if (timeoutId){ clearTimeout(timeoutId); }
        chipInFlight = null;
      }
    })();

    return chipInFlight;
  }

  function handleAuthChange(event, user, session){
    const hasUser = !!(user || (session && session.user));
    if (event === 'SIGNED_OUT'){
      setAuthState(AuthState.SIGNED_OUT);
      hideChipBadge();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION'){
      setAuthState(hasUser ? AuthState.SIGNED_IN : AuthState.SIGNED_OUT);
      if (!isAuthed()){
        hideChipBadge();
        return;
      }
      refreshXpBadge();
      refreshChipBadge();
      return;
    }
  }

  function wireAuthBridge(){
    if (authWired) return;
    if (!window || !window.SupabaseAuth || typeof window.SupabaseAuth.onAuthChange !== 'function') return;
    authWired = true;
    window.SupabaseAuth.onAuthChange(handleAuthChange);
    resolveInitialAuth();
  }

  function wireChipEvents(){
    if (!doc || typeof doc.addEventListener !== 'function') return;
    doc.addEventListener('chips:tx-complete', refreshChipBadge);
  }

  function tryWireAuthBridge(){
    if (authWired) return;
    wireAuthBridge();
    if (authWired) return;
    authWireAttempts += 1;
    if (authWireAttempts >= 8) return;
    setTimeout(tryWireAuthBridge, 250);
  }

  tryWireAuthBridge();

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', function(){
      normalizeTopbarBadges();
      wireChipEvents();
    }, { once: true });
  } else {
    normalizeTopbarBadges();
    wireChipEvents();
  }
})();
