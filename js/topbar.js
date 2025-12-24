(function(){
  if (typeof document === 'undefined') return;
  const doc = document;
  const chipNodes = { badge: null, amount: null, ready: false };
  let chipInFlight = null;

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
    const text = amount == null ? 'Chips unavailable' : `${amount.toLocaleString()} chips`;
    setChipBadge(text, { loading: false });
  }

  function renderChipBadgeSignedOut(){
    setChipBadge('Sign in for chips', { loading: false });
  }

  async function refreshChipBadge(){
    ensureChipNodes();
    if (!chipNodes.badge || !window || !window.ChipsClient || typeof window.ChipsClient.fetchBalance !== 'function') return;
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
      refreshChipBadge();
      wireChipEvents();
    }, { once: true });
  } else {
    refreshChipBadge();
    wireChipEvents();
  }
})();
