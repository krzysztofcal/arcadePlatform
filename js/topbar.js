(function(){
  if (typeof document === 'undefined') return;
  const doc = document;
  const chipNodes = { badge: null, amount: null, ready: false };
  let chipInFlight = null;
  let chipsClientPromise = null;
  let isSignedIn = false;
  let authWired = false;
  let authWireAttempts = 0;
  const CHIP_BADGE_HREF = '/account.html#chipPanel';

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
    badge.hidden = false;
    amount.textContent = text;
    const loading = options && options.loading;
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
    if (chipNodes.badge){ chipNodes.badge.hidden = true; }
  }

  function renderChipBadgeBalance(amount){
    const text = amount == null ? '—' : formatCompactNumber(amount);
    setChipBadge(text, { loading: false });
  }

  function renderChipBadgeSignedOut(){
    hideChipBadge();
  }

  function formatCompactNumber(value){
    if (window && window.ArcadeFormat && typeof window.ArcadeFormat.formatCompactNumber === 'function'){
      return window.ArcadeFormat.formatCompactNumber(value);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    const abs = Math.abs(numeric);
    const sign = numeric < 0 ? '-' : '';
    if (abs < 1000) return `${sign}${Math.round(abs)}`;
    let divisor = 1000;
    let suffix = 'k';
    if (abs >= 1e9){ divisor = 1e9; suffix = 'b'; }
    else if (abs >= 1e6){ divisor = 1e6; suffix = 'm'; }
    const scaled = abs / divisor;
    const rounded = scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${sign}${text}${suffix}`;
  }

  function setSignedIn(next){
    const value = !!next;
    if (isSignedIn === value) return;
    isSignedIn = value;
    if (!isSignedIn){
      hideChipBadge();
      return;
    }
    refreshChipBadge();
  }

  function resolveInitialAuth(){
    if (!window || !window.SupabaseAuth || typeof window.SupabaseAuth.getCurrentUser !== 'function') return;
    window.SupabaseAuth.getCurrentUser().then(function(user){
      setSignedIn(!!user);
      if (user){ refreshXpBadge(); }
    }).catch(function(){
      setSignedIn(false);
    });
  }

  function isChipsClientReady(){
    return !!(window && window.ChipsClient && typeof window.ChipsClient.fetchBalance === 'function');
  }

  function ensureChipsClientLoaded(){
    if (isChipsClientReady()){
      return Promise.resolve(true);
    }
    if (chipsClientPromise) return chipsClientPromise;
    chipsClientPromise = new Promise(resolve => {
      if (!doc || typeof doc.createElement !== 'function'){ resolve(false); return; }
      let resolved = false;
      let pollTimer = null;
      let timeoutTimer = null;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (!value){ chipsClientPromise = null; }
        resolve(value);
      };

      if (isChipsClientReady()){
        finish(true);
        return;
      }

      let script = doc.getElementById('chipsClientScript');
      if (!script && doc.querySelectorAll){
        const scripts = doc.querySelectorAll('script[src]');
        for (let i = 0; i < scripts.length; i++){
          const item = scripts[i];
          const src = item && item.getAttribute ? item.getAttribute('src') : null;
          if (src && src.indexOf('/js/chips/client.js') !== -1){
            script = item;
            break;
          }
        }
      }

      if (!script){
        script = doc.createElement('script');
        script.id = 'chipsClientScript';
        script.src = '/js/chips/client.js';
        script.async = true;
        const target = doc.head || doc.body || doc.documentElement;
        if (target && target.appendChild){ target.appendChild(script); }
      }

      if (script && script.addEventListener){
        script.addEventListener('load', () => finish(isChipsClientReady()));
        script.addEventListener('error', () => finish(false));
      }

      pollTimer = setInterval(() => {
        if (isChipsClientReady()){
          finish(true);
        }
      }, 50);

      timeoutTimer = setTimeout(() => finish(false), 1500);
    });
    return chipsClientPromise;
  }

  async function refreshChipBadge(){
    normalizeTopbarBadges();
    ensureChipNodes();
    if (!isSignedIn){
      hideChipBadge();
      return;
    }
    if (!chipNodes.badge) return;
    if (!window || !window.ChipsClient || typeof window.ChipsClient.fetchBalance !== 'function'){
      const loaded = await ensureChipsClientLoaded();
      if (!loaded || !window.ChipsClient || typeof window.ChipsClient.fetchBalance !== 'function'){
        hideChipBadge();
        return;
      }
    }
    if (chipInFlight){ return chipInFlight; }
    setChipBadge('', { loading: true });
    chipInFlight = (async function(){
      try {
        const balance = await window.ChipsClient.fetchBalance();
        const raw = balance && balance.balance != null ? Number(balance.balance) : null;
        const value = Number.isFinite(raw) ? raw : null;
        renderChipBadgeBalance(value);
      } catch (err){
        if (err && (err.status === 404 || err.code === 'not_found')){
          hideChipBadge();
          return;
        }
        if (err && err.code === 'not_authenticated'){
          setSignedIn(false);
          renderChipBadgeSignedOut();
          return;
        }
        setChipBadge('—', { loading: false });
      } finally {
        chipInFlight = null;
      }
    })();

    return chipInFlight;
  }

  function handleAuthChange(event, _user, _session){
    if (event === 'SIGNED_OUT'){
      setSignedIn(false);
      renderChipBadgeSignedOut();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED'){
      setSignedIn(true);
      refreshXpBadge();
      return;
    }
    if (_user || _session){
      setSignedIn(true);
      refreshXpBadge();
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
      refreshChipBadge();
      wireChipEvents();
    }, { once: true });
  } else {
    normalizeTopbarBadges();
    refreshChipBadge();
    wireChipEvents();
  }
})();
