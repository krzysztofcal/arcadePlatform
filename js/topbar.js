(function(){
  if (typeof document === 'undefined') return;
  const doc = document;
  const win = window;
  if (win.__topbarBooted) return;
  win.__topbarBooted = true;
  const chipNodes = { badge: null, amount: null, bonus: null, ready: false };
  let chipInFlight = null;
  let chipHasHydratedValue = false;
  let chipRequestGeneration = 0;
  let chipIdentityUserId = null;
  let welcomeBonusInFlight = null;
  let welcomeBonusRequestGeneration = 0;
  let welcomeBonusRefreshQueued = false;
  let chipsClientWaitTries = 0;
  let welcomeBonusClientWaitTries = 0;
  const AuthState = { UNKNOWN: 0, SIGNED_OUT: 1, SIGNED_IN: 2 };
  let authState = AuthState.SIGNED_OUT;
  let authWired = false;
  let authWireAttempts = 0;
  const CHIP_BADGE_HREF = '/account.html#chipPanel';

  function installPageTransition(){
    if (!doc.body || doc.getElementById('pageTransition')) return;
    const overlay = doc.createElement('div');
    overlay.id = 'pageTransition';
    overlay.className = 'page-transition';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<div class="page-transition__orb"></div><div class="page-transition__shell"><div class="page-transition__bar"></div><div class="page-transition__hero"></div><div class="page-transition__cards"><i></i><i></i><i></i></div></div>';
    doc.body.appendChild(overlay);

    let shownAt = Date.now();
    let fallbackHideTimer = null;
    function show(){
      shownAt = Date.now();
      overlay.hidden = false;
      overlay.classList.add('is-visible');
      if (fallbackHideTimer) clearTimeout(fallbackHideTimer);
      fallbackHideTimer = setTimeout(hide, 1600);
    }
    function hide(){
      if (fallbackHideTimer){
        clearTimeout(fallbackHideTimer);
        fallbackHideTimer = null;
      }
      const remaining = Math.max(0, 180 - (Date.now() - shownAt));
      setTimeout(function(){
        overlay.classList.remove('is-visible');
        setTimeout(function(){
          overlay.hidden = true;
          const pageBoot = doc.getElementById('pageBoot');
          if (pageBoot) pageBoot.hidden = true;
        }, 220);
      }, remaining);
    }
    function isPageNavigation(event, link){
      if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return false;
      const href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return false;
      try {
        const next = new URL(link.href, win.location.href);
        const current = new URL(win.location.href);
        if (next.origin !== current.origin) return false;
        return next.pathname !== current.pathname || next.search !== current.search;
      } catch (_err){
        return false;
      }
    }
    doc.addEventListener('click', function(event){
      const target = event.target;
      const link = target && target.closest ? target.closest('a[href]') : null;
      if (!isPageNavigation(event, link)) return;
      setTimeout(function(){
        if (!event.defaultPrevented) show();
      }, 0);
    });
    show();
    if (doc.readyState === 'complete') hide();
    else win.addEventListener('load', hide, { once: true, passive: true });
  }

  installPageTransition();

  function setAuthDataset(state){
    if (!doc || !doc.documentElement) return;
    doc.documentElement.dataset.auth = state;
  }

  setAuthDataset('out');

  function isAuthed(){
    return authState === AuthState.SIGNED_IN;
  }

  function isTopbarEditableTarget(target){
    if (!target || target === doc || target === win) return false;
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    const editable = target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
    if (!editable) return false;
    try {
      return !!(target.closest && target.closest('.topbar'));
    } catch (_){
      return false;
    }
  }

  function protectTopbarInputKeys(event){
    if (!event || event.key === 'Escape' || event.key === 'Tab') return;
    if (!isTopbarEditableTarget(event.target)) return;
    event.stopImmediatePropagation();
  }

  doc.addEventListener('keydown', protectTopbarInputKeys, true);

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
      const bonus = doc.createElement('span');
      bonus.id = 'welcomeBonusTopbarBadge';
      bonus.className = 'welcome-bonus-badge';
      bonus.textContent = '+500';
      bonus.hidden = true;
      label.appendChild(bonus);
      badge.appendChild(label);
    } else if (badge.getAttribute('href') !== CHIP_BADGE_HREF){
      badge.setAttribute('href', CHIP_BADGE_HREF);
    }
    let amount = badge.querySelector('#chipBadgeAmount') || doc.getElementById('chipBadgeAmount');
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
    let bonus = badge.querySelector('#welcomeBonusTopbarBadge') || doc.getElementById('welcomeBonusTopbarBadge');
    if (!bonus){
      const label = badge.querySelector('.chip-badge__label');
      bonus = doc.createElement('span');
      bonus.id = 'welcomeBonusTopbarBadge';
      bonus.className = 'welcome-bonus-badge';
      bonus.textContent = '+500';
      bonus.hidden = true;
      if (label){
        label.appendChild(bonus);
      } else {
        badge.appendChild(bonus);
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
      window.XPClient.refreshBadgeFromServer();
    } catch (_err){}
  }

  function ensureChipNodes(){
    if (chipNodes.ready && chipNodes.badge && chipNodes.amount && chipNodes.bonus) return;
    chipNodes.badge = doc.getElementById('chipBadge');
    chipNodes.amount = doc.getElementById('chipBadgeAmount');
    chipNodes.bonus = doc.getElementById('welcomeBonusTopbarBadge');
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

  function hideWelcomeBonusBadge(){
    ensureChipNodes();
    if (chipNodes.bonus){ chipNodes.bonus.hidden = true; }
  }

  function invalidateWelcomeBonusBadge(){
    welcomeBonusRequestGeneration += 1;
    hideWelcomeBonusBadge();
  }

  function setWelcomeBonusBadgeVisible(isVisible, amount){
    ensureChipNodes();
    if (!chipNodes.bonus) return;
    if (!isAuthed() || !isVisible){
      chipNodes.bonus.hidden = true;
      return;
    }
    const raw = amount == null ? 500 : Number(amount);
    const value = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 500;
    chipNodes.bonus.textContent = '+' + value;
    chipNodes.bonus.hidden = false;
  }

  function renderChipBadgeBalance(amount, uiState){
    const formatKey = 'format' + 'CompactNumber';
    const formatter = window && window.ArcadeFormat && typeof window.ArcadeFormat[formatKey] === 'function'
      ? window.ArcadeFormat[formatKey]
      : null;
    const text = amount == null ? '—' : formatter ? formatter(amount) : String(Math.round(amount));
    setChipBadge(text, { loading: false });
    chipHasHydratedValue = amount != null;
    if (window.UserUiState && typeof window.UserUiState.markActiveSliceApplied === 'function'){
      window.UserUiState.markActiveSliceApplied('chips', uiState || 'ready');
    }
  }

  function hydrateChipBadge(){
    const ui = window.UserUiState;
    if (!ui || typeof ui.readActiveSlice !== 'function') return false;
    const cached = ui.readActiveSlice('chips');
    const balance = cached && Number.isSafeInteger(cached.balance) && cached.balance >= 0 ? cached.balance : null;
    if (balance == null) return false;
    renderChipBadgeBalance(balance, 'hydrated');
    return true;
  }

  function retainCachedChipBadge(){
    if (!chipHasHydratedValue) return false;
    if (window.UserUiState && typeof window.UserUiState.markActiveSliceApplied === 'function'){
      window.UserUiState.markActiveSliceApplied('chips', 'stale');
    }
    return true;
  }

  function prepareChipIdentity(expectedUserId){
    const ui = window.UserUiState;
    const context = ui && typeof ui.getActiveContext === 'function' ? ui.getActiveContext() : null;
    const userId = expectedUserId || (context && context.userId ? context.userId : null);
    if (userId && userId === chipIdentityUserId){
      if (!chipHasHydratedValue) hydrateChipBadge();
      return;
    }
    chipRequestGeneration += 1;
    chipInFlight = null;
    chipHasHydratedValue = false;
    invalidateWelcomeBonusBadge();
    chipIdentityUserId = userId;
    const contextMatches = !expectedUserId || (context && context.userId === expectedUserId);
    if (!contextMatches || !hydrateChipBadge()) setChipBadge('', { loading: true });
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
      chipRequestGeneration += 1;
      chipInFlight = null;
      chipIdentityUserId = null;
      chipHasHydratedValue = false;
      hideChipBadge();
      invalidateWelcomeBonusBadge();
      return;
    }
    if (badge){ badge.hidden = false; }
    prepareChipIdentity();
    refreshChipBadge();
    refreshWelcomeBonusBadge();
  }

  function resolveInitialAuth(){
    if (!window || !window.SupabaseAuth || typeof window.SupabaseAuth.getCurrentUser !== 'function') return;
    window.SupabaseAuth.getCurrentUser().then(function(user){
      setAuthState(user ? AuthState.SIGNED_IN : AuthState.SIGNED_OUT);
      if (!isAuthed()){
        hideChipBadge();
        return;
      }
      prepareChipIdentity(user && user.id ? String(user.id) : null);
      refreshXpBadge();
      refreshChipBadge();
      refreshWelcomeBonusBadge();
    }).catch(function(){
      setAuthState(AuthState.SIGNED_OUT);
      hideChipBadge();
      hideWelcomeBonusBadge();
    });
  }

  async function refreshWelcomeBonusBadge(options){
    normalizeTopbarBadges();
    ensureChipNodes();
    if (!isAuthed()){
      hideWelcomeBonusBadge();
      return;
    }
    if (!window || !window.ChipsClient || typeof window.ChipsClient.fetchWelcomeBonusStatus !== 'function'){
      if (welcomeBonusClientWaitTries < 6){
        welcomeBonusClientWaitTries += 1;
        setTimeout(refreshWelcomeBonusBadge, 150);
        return;
      }
      welcomeBonusClientWaitTries = 0;
      hideWelcomeBonusBadge();
      return;
    }
    welcomeBonusClientWaitTries = 0;
    if (welcomeBonusInFlight){
      if (options && options.force) welcomeBonusRefreshQueued = true;
      return welcomeBonusInFlight;
    }
    const requestGeneration = welcomeBonusRequestGeneration;
    welcomeBonusInFlight = (async function(){
      try {
        const status = await window.ChipsClient.fetchWelcomeBonusStatus();
        if (requestGeneration !== welcomeBonusRequestGeneration) return;
        const canClaim = !!(status && status.eligible && !status.alreadyClaimed);
        setWelcomeBonusBadgeVisible(canClaim, status && status.amount);
      } catch (err){
        if (err && err.code === 'not_authenticated'){
          setAuthState(AuthState.SIGNED_OUT);
        }
        hideWelcomeBonusBadge();
      } finally {
        welcomeBonusInFlight = null;
        if (welcomeBonusRefreshQueued){
          welcomeBonusRefreshQueued = false;
          refreshWelcomeBonusBadge();
        }
      }
    })();

    return welcomeBonusInFlight;
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
    if (!chipHasHydratedValue) setChipBadge('', { loading: true });
    const requestGeneration = chipRequestGeneration;
    const ui = window.UserUiState;
    const uiContext = ui && typeof ui.getActiveContext === 'function' ? ui.getActiveContext() : null;
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
        if (requestGeneration !== chipRequestGeneration) return;
        if (uiContext && ui && typeof ui.isCurrent === 'function' && !ui.isCurrent(uiContext.userId, uiContext.generation)) return;
        const raw = balance && balance.balance != null ? Number(balance.balance) : null;
        const value = Number.isFinite(raw) ? raw : null;
        renderChipBadgeBalance(value);
      } catch (err){
        if (err && err.code === 'timeout'){
          if (!retainCachedChipBadge()) hideChipBadge();
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
        if (!retainCachedChipBadge()) hideChipBadge();
      } finally {
        if (timeoutId){ clearTimeout(timeoutId); }
        if (requestGeneration === chipRequestGeneration) chipInFlight = null;
      }
    })();

    return chipInFlight;
  }

  function handleAuthChange(event, user, session){
    const hasUser = !!(user || (session && session.user));
    if (window.ChipsClient && typeof window.ChipsClient.clearAuthCache === 'function') window.ChipsClient.clearAuthCache();
    if (event === 'SIGNED_OUT'){
      setAuthState(AuthState.SIGNED_OUT);
      hideChipBadge();
      hideWelcomeBonusBadge();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED'){
      setAuthState(hasUser ? AuthState.SIGNED_IN : AuthState.SIGNED_OUT);
      if (!isAuthed()){
        hideChipBadge();
        hideWelcomeBonusBadge();
        return;
      }
      prepareChipIdentity(user && user.id ? String(user.id) : (session && session.user && session.user.id ? String(session.user.id) : null));
      refreshXpBadge();
      refreshChipBadge();
      refreshWelcomeBonusBadge();
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
    doc.addEventListener('chips:tx-complete', function(){
      refreshChipBadge();
      invalidateWelcomeBonusBadge();
      refreshWelcomeBonusBadge({ force: true });
    });
    if (window.UserUiState && typeof window.UserUiState.onChange === 'function'){
      window.UserUiState.onChange(function(detail){
        if (detail && detail.slice === 'chips' && detail.value) renderChipBadgeBalance(detail.value.balance, 'ready');
      });
    }
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
