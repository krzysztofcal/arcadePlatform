(function(){
  const slug = 'trex-runner';
  const pageId = 'game_trex';
  const ASPECT_RATIO = 4; // width/height
  const STORAGE_KEY = 'trex_runner_state_v1';

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { highScore: 0, muted: false };
      const parsed = JSON.parse(raw);
      return { highScore: parsed.highScore || 0, muted: !!parsed.muted };
    } catch (err){
      return { highScore: 0, muted: false };
    }
  }
  function saveState(state){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err){}
  }

  const state = loadState();

  const gameWrap = document.getElementById('gameWrap');
  const canvas = document.getElementById('trexCanvas');
  const btnEnterFs = document.getElementById('btnEnterFs');
  const btnExitFs = document.getElementById('btnExitFs');
  const overlayExit = document.getElementById('overlayExit');
  const btnMute = document.getElementById('btnMute');
  const btnPause = document.getElementById('btnPause');
  const btnLike = document.getElementById('btnLike');
  const btnShare = document.getElementById('btnShare');
  const bigStartBtn = document.getElementById('bigStartBtn');
  const centerOverlay = document.getElementById('centerOverlay');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const replayBtn = document.getElementById('replayBtn');
  const scoreEl = document.getElementById('score');
  const highScoreEl = document.getElementById('highScore');
  const speedEl = document.getElementById('speed');
  const statusEl = document.getElementById('status');
  const finalScoreEl = document.getElementById('finalScore');
  const finalHighEl = document.getElementById('finalHigh');
  const analytics = window.Analytics;

  function updateLikeState(){
    const liked = btnLike.getAttribute('aria-pressed') === 'true';
    btnLike.title = liked ? 'Unlike' : 'Like';
  }

  if (btnLike){
    btnLike.addEventListener('click', ()=>{
      const liked = btnLike.getAttribute('aria-pressed') === 'true';
      btnLike.setAttribute('aria-pressed', liked ? 'false' : 'true');
      updateLikeState();
    });
    updateLikeState();
  }

  if (btnShare){
    btnShare.addEventListener('click', async ()=>{
      try {
        if (navigator.share){
          await navigator.share({ title: 'Chrome Dino Run', url: location.href });
        } else {
          await navigator.clipboard.writeText(location.href);
          btnShare.classList.add('pulse');
          setTimeout(()=>btnShare.classList.remove('pulse'), 600);
        }
      } catch (err){}
    });
  }

  const runner = window.TrexRunner({
    canvas,
    onScore(score){
      scoreEl.textContent = String(score);
      if (score > state.highScore){
        state.highScore = score;
        highScoreEl.textContent = String(state.highScore);
        saveState(state);
      }
    },
    onSpeed(speed){
      speedEl.textContent = speed.toFixed(2);
    },
    onGameOver(score){
      statusEl.textContent = 'Game over — tap Replay to try again!';
      if (finalScoreEl) finalScoreEl.textContent = String(score);
      if (finalHighEl) finalHighEl.textContent = String(state.highScore);
      if (analytics && analytics.endGame){
        analytics.endGame({ slug, page: pageId, score, lang: getLang() });
      }
      if (gameOverOverlay) gameOverOverlay.classList.remove('hidden');
      updatePauseButton();
    },
    onFrame(){
      // ensure scoreboard is kept in sync when idle
      highScoreEl.textContent = String(state.highScore);
    }
  });

  if (state.muted){
    runner.setMuted(true);
    updateMuteButton(true);
  } else {
    updateMuteButton(false);
  }

  function getLang(){
    return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'en';
  }

  function updateMuteButton(isMuted){
    if (!btnMute) return;
    btnMute.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
    btnMute.title = isMuted ? 'Unmute' : 'Mute';
    btnMute.textContent = isMuted ? '🔈' : '🔇';
  }

  function updatePauseButton(){
    if (!btnPause) return;
    const paused = runner.isPaused();
    btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    btnPause.title = paused ? 'Resume' : 'Pause';
    btnPause.textContent = paused ? '▶' : '⏸';
    btnPause.disabled = !runner.isRunning();
  }

  function updateStatus(){
    if (!statusEl) return;
    if (!runner.isRunning()){
      statusEl.textContent = 'Ready';
    } else if (runner.isPaused()){
      statusEl.textContent = 'Paused';
    } else {
      statusEl.textContent = 'Running';
    }
  }

  const fs = window.FullscreenService({
    wrap: gameWrap,
    btnEnter: btnEnterFs,
    btnExit: btnExitFs,
    overlayExit,
    canvas,
    aspect: ASPECT_RATIO,
    reserved: null,
    onResizeRequest: ()=>{
      resizeCanvas();
      runner.renderOnce();
    },
    analyticsContext: { slug, page: pageId }
  });
  fs.init();

  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.width / ASPECT_RATIO * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    runner.resize();
  }

  new ResizeObserver(()=>{ requestAnimationFrame(()=>{ resizeCanvas(); runner.renderOnce(); }); }).observe(canvas);
  window.addEventListener('resize', ()=>{ fitCanvasStandard(); });
  document.addEventListener('fullscreenchange', ()=>requestAnimationFrame(()=>{ resizeCanvas(); }));
  document.addEventListener('webkitfullscreenchange', ()=>requestAnimationFrame(()=>{ resizeCanvas(); }));

  function measureReserved(){
    let total = 0;
    try {
      const pad = getComputedStyle(gameWrap);
      total += (parseFloat(pad.paddingTop)||0) + (parseFloat(pad.paddingBottom)||0);
      gameWrap.querySelectorAll('.stats, .controls-row').forEach(el=>{ const r = el.getBoundingClientRect(); total += r.height; });
      const status = gameWrap.querySelector('#status');
      if (status) total += status.getBoundingClientRect().height;
      total += 20;
    } catch (err){}
    return Math.max(120, Math.min(window.innerHeight * 0.7, total));
  }

  function fitCanvasStandard(){
    if (fs && fs.isActive && fs.isActive()) return;
    const wrapRect = gameWrap.getBoundingClientRect();
    const maxW = Math.max(220, wrapRect.width - 20);
    const availH = Math.max(160, window.innerHeight - measureReserved());
    const fitW = Math.min(maxW, Math.floor(availH * ASPECT_RATIO));
    if (fitW > 0){
      canvas.style.width = fitW + 'px';
      canvas.style.height = (fitW / ASPECT_RATIO) + 'px';
      requestAnimationFrame(()=>{ resizeCanvas(); runner.renderOnce(); });
    }
  }

  fitCanvasStandard();
  runner.renderOnce();

  if (analytics && analytics.viewGame){
    analytics.viewGame({ slug, page: pageId, lang: getLang(), source: 'self' });
  }

  if (bigStartBtn){
    bigStartBtn.addEventListener('click', startGame);
  }
  if (replayBtn){
    replayBtn.addEventListener('click', startGame);
  }

  function startGame(){
    centerOverlay && centerOverlay.classList.add('hidden');
    gameOverOverlay && gameOverOverlay.classList.add('hidden');
    if (finalScoreEl) finalScoreEl.textContent = '0';
    if (finalHighEl) finalHighEl.textContent = String(state.highScore);
    runner.setMuted(state.muted);
    runner.start();
    updatePauseButton();
    updateStatus();
    if (analytics && analytics.startGame){
      analytics.startGame({ slug, page: pageId, mode: 'self', lang: getLang() });
    }
  }

  if (btnMute){
    btnMute.addEventListener('click', ()=>{
      const muted = !runner.isMuted();
      runner.setMuted(muted);
      state.muted = muted;
      saveState(state);
      updateMuteButton(muted);
    });
  }

  if (btnPause){
    btnPause.addEventListener('click', ()=>{
      if (!runner.isRunning()) return;
      runner.togglePause();
      updatePauseButton();
      updateStatus();
    });
  }

  overlayExit.addEventListener('click', ()=>{
    if (runner.isRunning() && runner.isPaused()){ return; }
    if (fs && fs.isActive && fs.isActive()) return;
  });

  document.addEventListener('keydown', (ev)=>{
    if (ev.code === 'Space' || ev.code === 'ArrowUp'){ ev.preventDefault(); runner.jump(); }
    if (ev.code === 'ArrowDown'){ ev.preventDefault(); runner.duck(true); }
    if (ev.code === 'KeyP'){
      if (!runner.isRunning()) return;
      runner.togglePause();
      updatePauseButton();
      updateStatus();
    }
  });
  document.addEventListener('keyup', (ev)=>{
    if (ev.code === 'ArrowDown'){ runner.duck(false); }
  });

  canvas.addEventListener('pointerdown', ()=>{ runner.jump(); });
  canvas.addEventListener('pointerup', ()=>{ runner.duck(false); });

  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden && runner.isRunning()){
      runner.pause();
      updatePauseButton();
      updateStatus();
    }
  });

  runner.loop();
  updatePauseButton();
  updateStatus();
  highScoreEl.textContent = String(state.highScore);
  if (finalHighEl) finalHighEl.textContent = String(state.highScore);
})();
