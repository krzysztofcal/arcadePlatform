(function(){
  if (typeof document === 'undefined') return;
  const doc = document;

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

  function handleAuthChange(event, _user, _session){
    if (event !== 'SIGNED_IN') return;
    refreshXpBadge();
  }

  function wireAuthBridge(){
    if (!window || !window.SupabaseAuth || typeof window.SupabaseAuth.onAuthChange !== 'function') return;
    window.SupabaseAuth.onAuthChange(handleAuthChange);
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', wireAuthBridge, { once: true });
  } else {
    wireAuthBridge();
  }
})();
