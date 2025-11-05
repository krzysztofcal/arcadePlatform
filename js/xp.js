/* XP client runtime: score-first, time fallback (1 Hz) */
'use strict';

(function(){
  const XP_ENDPOINT = '/.netlify/functions/award-xp';
  const TICK_MS = 1000;           // call at most once per second
  const ACTIVE_GRACE_MS = 1500;   // user input in last 1.5s counts as active

  // --- MMO-like floating +XP animation -------------------------------
  const styleId = 'xp-fx-style';
  if (!document.getElementById(styleId)) {
    const css = `
    .xp-fx-layer{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647}
    .xp-fx{position:absolute;font-weight:800;font-size:20px;
      text-shadow:0 2px 6px rgba(0,0,0,.6);
      animation:xp-pop 900ms ease-out forwards;will-change:transform,opacity}
    @keyframes xp-pop{
      0%{transform:translateY(0) scale(0.9);opacity:0}
      12%{opacity:1}
      40%{transform:translateY(-20px) scale(1.05)}
      70%{transform:translateY(-36px) scale(1.0)}
      100%{transform:translateY(-46px) scale(0.98);opacity:0}
    }
    @media (prefers-reduced-motion: reduce){
      .xp-fx{animation:xp-pop 300ms ease-out forwards}
    }`;
    const s = document.createElement('style');
    s.id = styleId; s.textContent = css;
    document.head.appendChild(s);
    const layer = document.createElement('div');
    layer.className = 'xp-fx-layer'; layer.id = 'xpFxLayer';
    document.body.appendChild(layer);
  }
  function showXpFx(text, anchorEl){ // anchor near score HUD if provided
    const layer = document.getElementById('xpFxLayer'); if (!layer) return;
    const el = document.createElement('div');
    el.className = 'xp-fx';
    el.textContent = text || '+1 XP';
    let x = window.innerWidth * 0.85, y = window.innerHeight * 0.2;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      x = r.right - 10; y = r.top + 10;
    }
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth-48))}px`;
    el.style.top  = `${Math.max(8, Math.min(y, window.innerHeight-48))}px`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // --- input/activity tracker ----------------------------------------
  let lastInputAt = 0;
  const markInput = () => { lastInputAt = performance.now(); };
  ['pointerdown','pointermove','keydown','wheel','touchstart'].forEach(e =>
    addEventListener(e, markInput, { passive:true }));

  function isActiveNow(){
    if (document.visibilityState !== 'visible') return false;
    return (performance.now() - lastInputAt) <= ACTIVE_GRACE_MS;
  }

  // --- public API -----------------------------------------------------
  const xp = {
    /**
     * Initialize XP reporting for a game.
     * @param {string} gameId - stable id of the game (e.g., 'tetris', 'trex')
     * @param {object} opts
     *   - mode: 'score' | 'time'
     *   - scoreGetter?: ()=>number (required for mode 'score')
     *   - anchor?: HTMLElement (where to place +XP effect)
     *   - getUserId?: ()=>string (optional, else device id)
     */
    init(gameId, opts){
      if (!gameId) throw new Error('xp.init: gameId required');
      const mode = opts?.mode || 'score';
      const scoreGetter = opts?.scoreGetter;
      const anchor = opts?.anchor || null;
      const getUserId = opts?.getUserId || ensureDeviceId;

      let timer = null;
      let bestSeen = 0; // session-local best (prevents calls if no progress)
      let lastSentAt = 0;

      function tick(){
        const now = performance.now();
        if (now - lastSentAt < TICK_MS - 5) return; // ensure <= 1 Hz

        if (mode === 'score'){
          if (typeof scoreGetter !== 'function') return;
          const s = Number(scoreGetter() || 0);
          if (!Number.isFinite(s) || s < 0) return;
          if (s <= bestSeen) return;           // no call if not better score
          if (!isActiveNow()) return;          // must be actively playing
          bestSeen = s;
          send({ gameId, mode:'score', score: s, active:true }, anchor);
          lastSentAt = now;
        } else {
          // time-based fallback: only when actively playing
          if (!isActiveNow()) return;
          send({ gameId, mode:'time', active:true }, anchor);
          lastSentAt = now;
        }
      }

      function start(){
        if (timer) return;
        lastInputAt = performance.now(); // give a short grace to start
        timer = setInterval(tick, 40);   // coarse loop, internal 1 Hz gate
        addEventListener('visibilitychange', tick);
        addEventListener('pagehide', tick);
        addEventListener('beforeunload', tick);
      }

      function stop(){
        if (timer) clearInterval(timer);
        timer = null;
      }

      async function send(payload, anchorEl){
        const userId = getUserId();
        try{
          const res = await fetch(XP_ENDPOINT, {
            method: 'POST',
            keepalive: true,
            headers: {
              'content-type':'application/json',
              'x-user-id': userId
            },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(()=> ({}));
          if (data && data.awardedXp > 0){
            showXpFx(`+${data.awardedXp} XP`, anchorEl);
          }
        }catch{ /* network ignored */ }
      }

      start();
      return { stop, getBestSeen:()=>bestSeen };
    }
  };

  function ensureDeviceId(){
    try{
      const k = 'xp_device_id';
      let id = localStorage.getItem(k);
      if (!id){
        id = 'dev:' + Math.random().toString(36).slice(2) + ':' + Date.now();
        localStorage.setItem(k, id);
      }
      return id;
    }catch{ return 'dev:anon'; }
  }

  // expose globally
  window.xp = xp;
})();
