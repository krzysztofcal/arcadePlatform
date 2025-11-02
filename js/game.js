// Game page composed from small services (no bundler)
(function(){
  const { CONFIG, StorageService, AudioService, FullscreenService, InputController, CatsRules } = window;
  const gameWrap = document.getElementById('gameWrap');
  const btnEnterFs = document.getElementById('btnEnterFs');
  const btnExitFs = document.getElementById('btnExitFs');
  const overlayExit = document.getElementById('overlayExit');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const analytics = window.Analytics;
  const slug = 'cats-arcade';
  const pageId = 'game_cats';
  const getLang = ()=> (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'en';

  if (window.XP){
    try { window.XP.stopSession({ flush: true }); } catch (_){}
    if (typeof window.XP.startSession === 'function'){
      try { window.XP.startSession(slug); } catch (_){}
    }
  }
  function xpNudge(){
    if (window.XP && typeof window.XP.nudge === 'function'){
      try { window.XP.nudge(); } catch (_){}
    }
  }

  // Fullscreen service integration
  const fs = FullscreenService({
    wrap: gameWrap,
    btnEnter: btnEnterFs,
    btnExit: btnExitFs,
    overlayExit,
    canvas,
    aspect: window.CONFIG.ASPECT_RATIO,
    reserved: window.CONFIG.FULLSCREEN_RESERVED,
    onResizeRequest: resizeCanvas,
    analyticsContext: { slug, page: pageId }
  });
  fs.init();

  if (analytics && analytics.viewGame){
    analytics.viewGame({ slug, page: pageId, lang: getLang(), source: 'self' });
  }

  // === Game ===
  const storage = StorageService(CONFIG);
  const audio = AudioService();
  let state = storage.load();

  const tokensEl = document.getElementById("tokens");
  const timeLeftEl = document.getElementById("timeLeft");
  const levelEl = document.getElementById("level");
  const lastScoreEl = document.getElementById("lastScore");
  const highScoreEl = document.getElementById("highScore");
  const playBtn = document.getElementById("playBtn");
  const buyBtn = document.getElementById("buyBtn");
  const resetBtn = document.getElementById("resetBtn");
  const statusEl = document.getElementById("status");
  const leftBtn = document.getElementById("leftBtn");
  const rightBtn = document.getElementById("rightBtn");
  const btnMute = document.getElementById("btnMute");
  const btnPause = document.getElementById("btnPause");
  const centerOverlay = document.getElementById('centerOverlay');
  const bigStartBtn = document.getElementById('bigStartBtn');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const statsPoints = document.getElementById('statsPoints');
  const statsLevel = document.getElementById('statsLevel');
  const statsTime = document.getElementById('statsTime');
  const replayBtn = document.getElementById('replayBtn');

  // Audio handled via AudioService

  let running=false, paused=false, score=0, msLeft=15000, level=1, startTs=0;
  let paddle={x:0, w:window.CONFIG.PADDLE.width, h:window.CONFIG.PADDLE.height, speed:window.CONFIG.PADDLE.speed, left:false, right:false};
  let cats=[], spawnCooldown=0, effects=[];

  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    const prevW = rect.width || 1;
    const relX = (paddle && prevW) ? (paddle.x / prevW) : 0.5;
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.width * (1/window.CONFIG.ASPECT_RATIO) * window.devicePixelRatio;
    const newW = canvas.getBoundingClientRect().width || prevW;
    paddle.x = Math.max(0, Math.min(newW - paddle.w, (isFinite(relX) ? relX : 0.5) * newW));
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }
  new ResizeObserver(()=>{ requestAnimationFrame(resizeCanvas); }).observe(canvas);
  window.addEventListener('resize', ()=>{ fitCanvasStandard(); requestAnimationFrame(resizeCanvas); });
  document.addEventListener('fullscreenchange', ()=>requestAnimationFrame(resizeCanvas));
  document.addEventListener('webkitfullscreenchange', ()=>requestAnimationFrame(resizeCanvas));
  resizeCanvas();
  const canvasWidth = () => canvas.getBoundingClientRect().width;
  const canvasHeight = () => canvas.getBoundingClientRect().width * (1/window.CONFIG.ASPECT_RATIO);
  // Fit canvas even when not in fullscreen so UI remains visible on small screens
  function __measureReservedPx(){
    let total = 0; try {
      const wrap = document.getElementById('gameWrap');
      const pad = getComputedStyle(wrap);
      total += (parseFloat(pad.paddingTop)||0) + (parseFloat(pad.paddingBottom)||0);
      wrap.querySelectorAll('.stats, .controls-row').forEach(el=>{ const r=el.getBoundingClientRect(); total += r.height; });
      const status = wrap.querySelector('#status'); if (status){ total += status.getBoundingClientRect().height; }
      total += 20; // small buffer
    } catch {}
    return Math.max(100, Math.min(window.innerHeight * 0.7, total));
  }
  function fitCanvasStandard(){
    if (fs && fs.isActive && fs.isActive()) return; // fullscreen will manage
    const wrapRect = gameWrap.getBoundingClientRect();
    const maxW = Math.max(160, wrapRect.width - 20);
    const availH = Math.max(160, window.innerHeight - __measureReservedPx());
    const fitW = Math.min(maxW, Math.floor(availH * window.CONFIG.ASPECT_RATIO));
    if (fitW > 0) { canvas.style.width = fitW + 'px'; requestAnimationFrame(resizeCanvas); }
  }

  const currentLevel = () => CatsRules.currentLevel(score);
  function levelParams(lv){ return CatsRules.levelParams(lv, window.CONFIG.LEVEL); }
  const fmtTime = (ms)=> (Math.max(0, ms)/1000).toFixed(1)+"s";
  function renderHud(){ tokensEl.textContent=state.tokens; timeLeftEl.textContent=fmtTime(msLeft); lastScoreEl.textContent=state.lastScore; highScoreEl.textContent=state.highScore; levelEl.textContent=level; playBtn.disabled=state.tokens<=0||running; statusEl.textContent=running?("Punkty: "+score):"Gotowy"; }
  function spawnCat(){
    const {fallBase}=levelParams(level);
    const r=window.CONFIG.CAT.radius;
    const H = canvasHeight();
    const scale = Math.max(0.6, Math.min(2.0, H/320));
    cats.push({ x:Math.random()*(canvasWidth()-2*r)+r, y:-r-5, r, vy:(fallBase+Math.random()*2)*scale });
  }
  function pushEffect(x,y,text,color){ effects.push({x,y,text,color,vy:-0.6,life:60}); }

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const H=canvasHeight();
    const Y=window.CONFIG.PADDLE.baselineOffset;
    ctx.fillStyle="#60a5fa"; ctx.fillRect(paddle.x,H-Y,paddle.w,paddle.h);
    for(const c of cats){ ctx.beginPath(); ctx.arc(c.x,c.y,c.r+3,0,Math.PI*2); ctx.fillStyle="#1f2937"; ctx.fill();
      ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,Math.PI*2); ctx.fillStyle="#fbbf24"; ctx.fill();
      ctx.font="16px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji'"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle="#0b1220"; ctx.fillText("🐱", c.x, c.y+1); }
    for(const e of effects){ ctx.globalAlpha=Math.max(0,e.life/60); ctx.font="bold 16px system-ui"; ctx.textAlign="center"; ctx.fillStyle=e.color; ctx.fillText(e.text,e.x,e.y); ctx.globalAlpha=1; }
    ctx.fillStyle="#9fb0d0"; ctx.font="12px system-ui"; ctx.fillText(running?"Łap koty! ← → / dotknij":"Naciśnij Zagraj",10,18);
  }
  function endGame(){
    running=false; paused=false; state.lastScore=score; if(score>state.highScore) state.highScore=score; storage.save(state);
    setPauseUI && setPauseUI(); renderHud();
    // Show game over overlay with stats
    if (statsPoints) statsPoints.textContent = String(score);
    if (statsLevel) statsLevel.textContent = String(level);
    if (statsTime){ const secs = Math.max(0, (performance.now()-startTs)/1000); statsTime.textContent = secs.toFixed(1)+"s"; }
    if (gameOverOverlay) gameOverOverlay.classList.remove('hidden');
    if (centerOverlay) centerOverlay.classList.add('hidden');
  }
  function update(dt){
    if(!running || paused) return;
    const W=canvasWidth(), H=canvasHeight(), Y=window.CONFIG.PADDLE.baselineOffset;
    msLeft -= dt; if(msLeft<=0){ msLeft=0; endGame(); return; }
    const newLevel=currentLevel(); if(newLevel!==level) level=newLevel;
    const {maxCats,spawnEvery}=levelParams(level);
    if(paddle.left) paddle.x -= paddle.speed; if(paddle.right) paddle.x += paddle.speed;
    paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x));
    spawnCooldown -= 1; if(spawnCooldown<=0 && cats.length<maxCats){ spawnCat(); spawnCooldown=spawnEvery; }
    for(let i=cats.length-1;i>=0;i--){
      const c=cats[i]; c.y+=c.vy;
      const withinX=(c.x+c.r)>=paddle.x && (c.x-c.r)<=paddle.x+paddle.w;
      const withinY=(c.y+c.r)>=(H-Y) && (c.y-c.r)<=(H-Y+paddle.h);
      if(withinX && withinY){ score+=1; msLeft+=1000; timeLeftEl.classList.remove("pulse"); void timeLeftEl.offsetWidth; timeLeftEl.classList.add("pulse");
        pushEffect(c.x, Math.max(20,c.y-8), "+1", "#facc15"); audio.meow(); cats.splice(i,1); continue; }
      if(c.y-c.r>H){ msLeft=Math.max(0, msLeft-1000); timeLeftEl.classList.remove("pulse"); void timeLeftEl.offsetWidth; timeLeftEl.classList.add("pulse");
          pushEffect(c.x, H-30, "-1", "#f87171"); audio.hiss(); cats.splice(i,1); if(msLeft<=0){ endGame(); return; } }
    }
    for(let i=effects.length-1;i>=0;i--){ const e=effects[i]; e.y+=e.vy; e.life-=1; if(e.life<=0) effects.splice(i,1); }
    renderHud();
  }
  let last=0; function loop(ts){ if(!last) last=ts; const dt=ts-last; last=ts; update(dt); draw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  function startGame(){
    xpNudge();
    if(running||state.tokens<=0) return; audio.ensure(); state.tokens-=1; storage.save(state);
    running=true; paused=false; score=0; level=1; cats=[]; spawnCooldown=0; msLeft=15000; startTs = performance.now(); setPauseUI && setPauseUI();
    if (centerOverlay) centerOverlay.classList.add('hidden');
    if (gameOverOverlay) gameOverOverlay.classList.add('hidden');
    renderHud();
    if (analytics && analytics.startGame){
      analytics.startGame({ slug, page: pageId, mode: 'self', lang: getLang(), tokens_remaining: state.tokens });
    }
  }
  const buy=()=>{ xpNudge(); if(running) return; state.tokens+=10; storage.save(state); renderHud(); };
  const resetDemo=()=>{ xpNudge(); if(running) return; state={...window.CONFIG.DEFAULT_STATE}; storage.save(state); renderHud(); };

  function setMuteUI(){
    if (!btnMute) return;
    const muted = audio.isMuted ? audio.isMuted() : !!state.muted;
    btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btnMute.title = muted ? 'Unmute' : 'Mute';
    btnMute.textContent = muted ? '🔈' : '🔇';
  }
  function toggleMute(){
    xpNudge();
    if (audio.setMuted) {
      audio.setMuted(!(audio.isMuted && audio.isMuted()));
    }
    state.muted = audio.isMuted ? audio.isMuted() : !state.muted;
    storage.save(state);
    setMuteUI();
  }
  function setPauseUI(){
    if (!btnPause) return;
    btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    btnPause.title = paused ? 'Resume' : 'Pause';
    btnPause.textContent = paused ? '▶' : '⏸';
    btnPause.disabled = !running;
  }
  function togglePause(){ xpNudge(); if (!running) return; paused = !paused; setPauseUI(); renderHud(); }

  // Use InputController for all inputs
  InputController({
    canvas, paddle, leftBtn, rightBtn, playBtn, buyBtn, resetBtn,
    widthProvider: () => canvas.getBoundingClientRect().width,
    onStart: startGame,
    onBuy: buy,
    onReset: resetDemo,
    btnMute, btnPause,
    onToggleMute: toggleMute,
    onTogglePause: togglePause,
    onActivity: xpNudge
  });

  // Redundant direct bindings as a safety net (in case controller wiring fails)
  try {
    playBtn && playBtn.addEventListener('click', startGame);
    buyBtn && buyBtn.addEventListener('click', buy);
    resetBtn && resetBtn.addEventListener('click', resetDemo);
    bigStartBtn && bigStartBtn.addEventListener('click', startGame);
    replayBtn && replayBtn.addEventListener('click', startGame);
  } catch {}

  window.addEventListener('visibilitychange', ()=>{ if (document.hidden && running) { paused = true; setPauseUI(); } });
  (function(){
    if (audio.setMuted) audio.setMuted(!!state.muted);
    setMuteUI(); setPauseUI(); fs.syncButtons(); fitCanvasStandard(); renderHud(); draw();
    // Show center start overlay on load
    if (centerOverlay) centerOverlay.classList.remove('hidden');
    if (gameOverOverlay) gameOverOverlay.classList.add('hidden');
  })();
  if (typeof window !== 'undefined'){
    const stop = () => {
      if (window.XP && typeof window.XP.stopSession === 'function'){
        try { window.XP.stopSession({ flush: true }); } catch (_){}
      }
    };
    window.addEventListener('beforeunload', stop);
    window.addEventListener('pagehide', (event) => {
      if (!event || !event.persisted) stop();
    });
    window.addEventListener('pageshow', (event) => {
      if (event && event.persisted && window.XP && typeof window.XP.resumeSession === 'function'){
        try { window.XP.resumeSession(); } catch (_){ /* noop */ }
      }
    });
  }
})();
window.addEventListener('beforeunload', stop);
// --- bfcache handling: stop only on real unload; resume on pageshow ---
(function () {
  // Stop on pagehide only if the page is not being placed into bfcache
  window.addEventListener('pagehide', function (e) {
    if (!e || !e.persisted) { try { stop(); } catch (_) {} }
  });

  // If restored from bfcache, resume XP timers/session
  var handlePageShow = function (e) {
    var fromBFCache = (e && e.persisted) ||
      (performance && performance.getEntriesByType &&
       (performance.getEntriesByType('navigation')[0] || {}).type === 'back_forward');
    if (fromBFCache) {
      try { if (window.XP && typeof window.XP.resumeSession === 'function') window.XP.resumeSession(); } catch (_) {}
    }
  };
})();
// --- ensure XP resumes when restored from bfcache or back/forward nav ---
(function () {
  window.addEventListener('pageshow', function (event) {
    try {
      var fromBFCache = (event && event.persisted) ||
        (performance && performance.getEntriesByType &&
         ((performance.getEntriesByType('navigation')[0] || {}).type === 'back_forward'));
      if (fromBFCache && window.XP && typeof window.XP.resumeSession === 'function') {
        window.XP.resumeSession();
      }
    } catch (_) { /* noop */ }
  });
})();
