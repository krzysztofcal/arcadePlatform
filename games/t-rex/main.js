(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WORLD_WIDTH = 600;
  const WORLD_HEIGHT = 200;
  const scoreEl = document.getElementById('score');
  const hiScoreEl = document.getElementById('hi-score');
  const restartBtn = document.getElementById('restart');

  const GROUND_Y = 170;
  const GRAVITY = 2000;
  const JUMP_VELOCITY = -680;
  const INITIAL_SPEED = 360;
  const XP_GAME_ID = 't-rex';

  const state = {
    running: false,
    lastTime: 0,
    speed: INITIAL_SPEED,
    spawnTimer: 0,
    spawnInterval: 1.6,
    score: 0,
    hiScore: Number(localStorage.getItem('trex-hi') || '0'),
    dino: { x: 60, y: GROUND_Y, width: 44, height: 48, vy: 0, isJumping: false },
    obstacles: [],
    clouds: [],
  };

  function formatScore(value) { return value.toString().padStart(5, '0'); }

  let lastScorePulse = 0;

  function getBridge() {
    const bridge = window.GameXpBridge;
    return bridge && typeof bridge === 'object' ? bridge : null;
  }

  function notifyScorePulse(totalScore) {
    const payload = { type: 'game-score', gameId: XP_GAME_ID, score: totalScore };
    const origin = (window.location && window.location.origin) ? window.location.origin : '*';
    try { window.postMessage(payload, origin); } catch (_) {}
    if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
      try { window.parent.postMessage(payload, origin); } catch (_) {}
    }
  }

  function signalGameOver() {
    const bridge = getBridge();
    if (bridge && typeof bridge.gameOver === 'function') {
      try { bridge.gameOver({ score: Math.floor(state.score) }); } catch (_) {}
    }
  }

  function addScoreDelta(delta) {
    if (!delta || !Number.isFinite(delta) || delta <= 0) return;
    const bridge = getBridge();
    if (bridge && typeof bridge.add === 'function') {
      try { bridge.add(delta); } catch (_) {}
    }
  }

  function nudgeXP() {
    const bridge = getBridge();
    if (bridge && typeof bridge.nudge === 'function') {
      try { bridge.nudge(); } catch (_) {}
    }
  }
  function setupCanvas(){
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WORLD_WIDTH * dpr;
    canvas.height = WORLD_HEIGHT * dpr;
    canvas.style.width = '100%';
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
  }

  function reset(){
    state.running=false; state.lastTime=0; state.speed=INITIAL_SPEED; state.spawnTimer=0; state.spawnInterval=1.6; state.score=0;
    state.dino.y=GROUND_Y; state.dino.vy=0; state.dino.isJumping=false; state.obstacles.length=0; state.clouds.length=0;
    lastScorePulse = 0;
    spawnCloud(); spawnCloud(); render(); updateScoreboard();
  }
  function start(){ if(state.running) return; state.running=true; state.lastTime=performance.now(); requestAnimationFrame(loop); }
  function jump(){ nudgeXP(); if(!state.running) start(); if(state.dino.isJumping) return; state.dino.isJumping=true; state.dino.vy=JUMP_VELOCITY; }
  function loop(ts){ if(!state.running) return; const dt=Math.min((ts-state.lastTime)/1000,0.035); state.lastTime=ts; update(dt); render(); requestAnimationFrame(loop); }
    function update(dt){
      state.speed += dt*12;
      state.spawnTimer += dt;
      if(state.spawnTimer>state.spawnInterval){
        state.spawnTimer=0;
        state.spawnInterval=Math.max(1.0,1.8-state.speed/900);
        spawnObstacle();
      }
      const d=state.dino;
      d.vy+=GRAVITY*dt;
      d.y+=d.vy*dt;
      if(d.y>=GROUND_Y){
        d.y=GROUND_Y;
        d.vy=0;
        d.isJumping=false;
      }
      state.obstacles.forEach(ob=> ob.x -= state.speed*dt);
      state.obstacles = state.obstacles.filter(ob=> ob.x+ob.width>-10);
      state.clouds.forEach(c=> c.x -= c.speed*dt);
      if(state.clouds.length<3) spawnCloud();
      state.clouds = state.clouds.filter(c=> c.x+c.width>0);
      detectCollision();
      state.score += dt*12;
      if(Math.floor(state.score)%100===0){ state.speed+=5; }
      updateScoreboard();
      const wholeScore = Math.max(0, Math.floor(state.score));
      if (wholeScore > lastScorePulse) {
        const delta = wholeScore - lastScorePulse;
        lastScorePulse = wholeScore;
        notifyScorePulse(wholeScore);
        addScoreDelta(delta);
      }
    }
  function detectCollision(){
    const d = state.dino;
    const dLeft = d.x;
    const dRight = d.x + d.width;
    const dBottom = d.y;
    const dTop = d.y - d.height;
    for(const ob of state.obstacles){
      const oLeft = ob.x;
      const oRight = ob.x + ob.width;
      const oTop = ob.y;
      const oBottom = ob.y + ob.height;
      if(dLeft < oRight && dRight > oLeft && dTop < oBottom && dBottom > oTop){
        gameOver();
        break;
      }
    }
  }
  function gameOver(){
    state.running=false;
    if(state.score>state.hiScore){ state.hiScore=Math.floor(state.score); localStorage.setItem('trex-hi', state.hiScore.toString()); }
    updateScoreboard();
    signalGameOver();
    drawGameOver();
  }
  function drawGameOver(){ ctx.save(); ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#f5f6fb'; ctx.font='24px "Courier New", monospace'; ctx.textAlign='center'; ctx.fillText('Game Over', WORLD_WIDTH/2, WORLD_HEIGHT/2-10); ctx.font='16px "Courier New", monospace'; ctx.fillText('Press restart or jump to try again', WORLD_WIDTH/2, WORLD_HEIGHT/2+14); ctx.restore(); }
  function spawnObstacle(){ const h=40+Math.random()*40,w=20+Math.random()*20; state.obstacles.push({x:WORLD_WIDTH+Math.random()*60, y:GROUND_Y+2-h, width:w, height:h}); }
  function spawnCloud(){ state.clouds.push({ x:WORLD_WIDTH+Math.random()*200, y:20+Math.random()*60, width:60+Math.random()*40, height:20+Math.random()*10, speed:30+Math.random()*20 }); }
  function updateScoreboard(){ scoreEl.textContent=formatScore(Math.floor(state.score)); hiScoreEl.textContent='HI '+formatScore(Math.floor(state.hiScore)); }
  function render(){ ctx.clearRect(0,0,WORLD_WIDTH,WORLD_HEIGHT); const grad=ctx.createLinearGradient(0,0,0,WORLD_HEIGHT); grad.addColorStop(0,'#15223c'); grad.addColorStop(1,'#0b0e19'); ctx.fillStyle=grad; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#23324d'; ctx.fillRect(0,GROUND_Y+10,WORLD_WIDTH,3); ctx.fillStyle='#2f3e5f'; ctx.fillRect(0,GROUND_Y+13,WORLD_WIDTH,2); ctx.fillStyle='rgba(255,255,255,.2)'; state.clouds.forEach(c=> drawRoundedRect(c.x,c.y,c.width,c.height,10)); ctx.fillStyle='rgba(0,0,0,.35)'; drawEllipse(state.dino.x+state.dino.width/2,GROUND_Y+12,26,6); drawDino(); ctx.fillStyle='#7cf58e'; state.obstacles.forEach(ob=> drawCactus(ob.x,ob.y,ob.width,ob.height)); }
  function drawDino(){ const d=state.dino; ctx.save(); ctx.translate(d.x,d.y-d.height); ctx.fillStyle='#9df785'; drawRoundedRect(0,12,36,28,6); drawRoundedRect(24,0,18,16,6); drawRoundedRect(6,32,14,18,6); drawRoundedRect(22,32,14,18,6); ctx.fillStyle='#17202d'; ctx.fillRect(30,6,6,6); ctx.restore(); }
  function drawCactus(x,y,w,h){ const seg=Math.max(10,w*0.4); ctx.save(); ctx.translate(x,y); drawRoundedRect(0,0,w,h,w*0.2); ctx.fillRect(w/2-seg/2,h*0.25,seg,h*0.35); ctx.fillRect(w*0.1,h*0.4,seg*0.7,h*0.2); ctx.fillRect(w-seg*0.7-w*0.1,h*0.55,seg*0.7,h*0.2); ctx.restore(); }
  function drawRoundedRect(x,y,w,h,r){ const rr=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.lineTo(x+w-rr,y); ctx.quadraticCurveTo(x+w,y,x+w,y+rr); ctx.lineTo(x+w,y+h-rr); ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h); ctx.lineTo(x+rr,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-rr); ctx.lineTo(x,y+rr); ctx.quadraticCurveTo(x,y,x+rr,y); ctx.closePath(); ctx.fill(); }
  function drawEllipse(cx,cy,rx,ry){ ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.fill(); }
  function handleKeydown(e){ if(e.repeat) return; if(e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW'){ e.preventDefault(); if(!state.running){ reset(); } jump(); } else if(e.code==='Enter'){ e.preventDefault(); reset(); start(); nudgeXP(); } }
  function handlePointer(e){ e.preventDefault(); if(!state.running){ reset(); } jump(); }
  restartBtn.addEventListener('click', ()=>{ nudgeXP(); reset(); start(); });
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', () => { setupCanvas(); render(); });
  canvas.addEventListener('pointerdown', handlePointer);
  canvas.addEventListener('touchstart', handlePointer, { passive:false });
  setupCanvas();
  reset();
})();

