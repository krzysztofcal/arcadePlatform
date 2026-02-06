(function(){
  if (typeof document === 'undefined') return;
  const doc = document;
  const chipNodes = { badge: null, amount: null, ready: false };
  let chipInFlight = null;
  let chipsClientPromise = null;
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
    if (node.parentNode !== container){
      try {
        if (node.parentNode){ node.parentNode.removeChild(node); }
      } catch (_err){}
    }
    if (before && before.parentNode === container && before !== node){
      container.insertBefore(node, before);
    } else if (node.parentNode !== container || node !== container.lastChild){
      container.appendChild(node);
    }
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
      label.appendChild(doc.createTextNode('Chips: '));
      const amount = doc.createElement('span');
      amount.id = 'chipBadgeAmount';
      amount.textContent = '…';
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
      amount.textContent = '…';
      if (label){
        if (label.textContent.indexOf('Chips:') === -1){
          label.insertBefore(doc.createTextNode('Chips: '), label.firstChild || null);
        }
        label.appendChild(amount);
      } else {
        const wrap = doc.createElement('span');
        wrap.className = 'chip-badge__label';
        wrap.appendChild(doc.createTextNode('Chips: '));
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
    if (xpBadge){
      moveNode(xpBadge, topbarRight, avatarShell || topbarRight.firstChild);
    }
    const chipBadge = ensureChipBadge(topbarRight);
    if (chipBadge){
      if (xpBadge && xpBadge.parentNode === topbarRight){
        moveNode(chipBadge, topbarRight, xpBadge.nextSibling || avatarShell);
      } else if (avatarShell){
        moveNode(chipBadge, topbarRight, avatarShell);
      } else {
        moveNode(chipBadge, topbarRight);
      }
    }
  }

  function refreshXpBadge(){
    if (!window || !window.XPClient || typeof window.XPClient.refreshBadgeFromServer !== 'function') return;
    try {
      window.XPClient.refreshBadgeFromServer({ bumpBadge: true });
    } catch (_err){}
  }

  function ensureChipNodes(){
    if (chipNodes.ready) return;
    normalizeTopbarBadges();
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
    const text = amount == null ? 'Chips unavailable' : `${amount.toLocaleString()} chips`;
    setChipBadge(text, { loading: false });
  }

  function renderChipBadgeSignedOut(){
    hideChipBadge();
  }

  function ensureChipsClientLoaded(){
    if (window && window.ChipsClient && typeof window.ChipsClient.fetchBalance === 'function'){
      return Promise.resolve(true);
    }
    if (chipsClientPromise) return chipsClientPromise;
    chipsClientPromise = new Promise(resolve => {
      if (!doc || typeof doc.createElement !== 'function'){ resolve(false); return; }
      let script = doc.getElementById('chipsClientScript');
      if (!script){
        script = doc.createElement('script');
        script.id = 'chipsClientScript';
        script.src = '/js/chips/client.js';
        script.defer = true;
        script.addEventListener('load', () => resolve(true));
        script.addEventListener('error', () => resolve(false));
        const target = doc.head || doc.body || doc.documentElement;
        if (target && target.appendChild){ target.appendChild(script); }
        else { resolve(false); }
      } else {
        script.addEventListener('load', () => resolve(true));
        script.addEventListener('error', () => resolve(false));
      }
    });
    return chipsClientPromise;
  }

  async function refreshChipBadge(){
    ensureChipNodes();
    if (!chipNodes.badge) return;
    if (!window || !window.ChipsClient || typeof window.ChipsClient.fetchBalance !== 'function'){
      const loaded = await ensureChipsClientLoaded();
      if (!loaded || !window.ChipsClient || typeof window.ChipsClient.fetchBalance !== 'function'){
        hideChipBadge();
        return;
      }
    }
    if (chipInFlight){ return chipInFlight; }
    setChipBadge('Syncing chips…', { loading: true });
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
          renderChipBadgeSignedOut();
          return;
        }
        setChipBadge('Chip sync failed', { loading: false });
      } finally {
        chipInFlight = null;
      }
    })();

    return chipInFlight;
  }

  function handleAuthChange(event, _user, _session){
    if (event === 'SIGNED_IN'){
      refreshXpBadge();
      refreshChipBadge();
      return;
    }
    if (event === 'SIGNED_OUT'){
      renderChipBadgeSignedOut();
    }
  }

  function wireAuthBridge(){
    if (!window || !window.SupabaseAuth || typeof window.SupabaseAuth.onAuthChange !== 'function') return;
    window.SupabaseAuth.onAuthChange(handleAuthChange);
  }

  function wireChipEvents(){
    if (!doc || typeof doc.addEventListener !== 'function') return;
    doc.addEventListener('chips:tx-complete', refreshChipBadge);
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', wireAuthBridge, { once: true });
  } else {
    wireAuthBridge();
  }

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
