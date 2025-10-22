(function(){
  const DEFAULTS = {
    gravity: 0.0018,
    jumpVelocity: -0.6,
    groundHeight: 24,
    speedStart: 0.36,
    speedMax: 0.8,
    speedIncrement: 0.00006,
    spawnIntervalMin: 600,
    spawnIntervalMax: 1400,
    cactusHeights: [34, 46, 58]
  };

  function TrexRunner(options){
    const opts = { ...DEFAULTS, ...(options||{}) };
    const canvas = opts.canvas;
    if (!canvas) throw new Error('TrexRunner requires a canvas');
    const ctx = canvas.getContext('2d');
    let dpr = window.devicePixelRatio || 1;

    const trex = {
      x: 48,
      y: 0,
      w: 44,
      h: 48,
      vy: 0,
      grounded: true,
      legTime: 0,
      legFrame: 0,
      ducking: false
    };

    const clouds = [];
    const obstacles = [];
    let running = false;
    let paused = false;
    let gameOver = false;
    let speed = opts.speedStart;
    let score = 0;
    let spawnTimer = 0;
    let lastTs = 0;
    let muted = false;
    let context = null;
    let gainNode = null;

    const callbacks = {
      onScore: opts.onScore,
      onGameOver: opts.onGameOver,
      onSpeed: opts.onSpeed,
      onFrame: opts.onFrame
    };

    function ensureAudio(){
      if (context || muted) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        context = new AudioCtx();
        gainNode = context.createGain();
        gainNode.gain.value = 0.08;
        gainNode.connect(context.destination);
      } catch (err) {
        context = null;
        gainNode = null;
      }
    }

    function playTone(frequency, duration){
      if (muted) return;
      ensureAudio();
      if (!context || !gainNode) return;
      const osc = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      const now = context.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(1, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.type = 'square';
      osc.frequency.setValueAtTime(frequency, now);
      osc.connect(gain);
      gain.connect(gainNode);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    function setMuted(value){
      muted = !!value;
      if (muted && context){
        try { context.suspend(); } catch (e){}
      } else if (!muted && context){
        try { context.resume(); } catch (e){}
      }
    }

    function resize(){
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(dpr, dpr);
    }

    function reset(){
      trex.y = canvas.height / dpr - opts.groundHeight - trex.h;
      trex.vy = 0;
      trex.grounded = true;
      trex.legTime = 0;
      trex.legFrame = 0;
      trex.ducking = false;
      obstacles.length = 0;
      clouds.length = 0;
      speed = opts.speedStart;
      score = 0;
      spawnTimer = 300;
      gameOver = false;
      lastTs = 0;
      for (let i = 0; i < 3; i++){
        clouds.push({ x: 180 + i * 180, y: 20 + 10 * Math.random(), speed: 0.08 + Math.random()*0.04 });
      }
      notifyScore();
      if (callbacks.onSpeed) callbacks.onSpeed(speed);
    }

    function notifyScore(){
      if (callbacks.onScore) callbacks.onScore(Math.floor(score));
    }

    function notifyFrame(){
      if (callbacks.onFrame) callbacks.onFrame();
    }

    function jump(){
      if (!running || paused || gameOver) return;
      if (!trex.grounded) return;
      trex.vy = opts.jumpVelocity;
      trex.grounded = false;
      playTone(880, 0.12);
    }

    function duck(pressed){
      trex.ducking = !!pressed;
      if (!running || paused || gameOver) return;
      if (!trex.grounded) return;
      const groundY = canvas.height / dpr - opts.groundHeight;
      trex.h = trex.ducking ? 36 : 48;
      trex.y = groundY - trex.h;
    }

    function update(dt){
      if (!running || paused) return;
      const groundY = canvas.height / dpr - opts.groundHeight;

      trex.vy += opts.gravity * dt;
      trex.y += trex.vy * dt;
      if (trex.y >= groundY - trex.h){
        trex.y = groundY - trex.h;
        trex.vy = 0;
        trex.grounded = true;
      } else {
        trex.grounded = false;
      }

      const targetHeight = trex.ducking && trex.grounded ? 36 : 48;
      if (trex.h !== targetHeight){
        trex.h = targetHeight;
        trex.y = Math.min(trex.y, groundY - trex.h);
      }

      trex.legTime += dt;
      if (trex.grounded && trex.legTime > 80){
        trex.legTime = 0;
        trex.legFrame = (trex.legFrame + 1) % 2;
      }

      score += speed * dt * 0.1;
      notifyScore();

      if (speed < opts.speedMax){
        speed = Math.min(opts.speedMax, speed + opts.speedIncrement * dt);
        if (callbacks.onSpeed) callbacks.onSpeed(speed);
      }

      spawnTimer -= dt;
      if (spawnTimer <= 0){
        spawnTimer = opts.spawnIntervalMin + Math.random() * (opts.spawnIntervalMax - opts.spawnIntervalMin);
        const height = opts.cactusHeights[Math.floor(Math.random()*opts.cactusHeights.length)];
        const width = 18 + Math.random()*12;
        obstacles.push({ x: canvas.width/dpr + width, y: groundY - height, w: width, h: height });
      }

      for (let i = obstacles.length - 1; i >= 0; i--){
        const obs = obstacles[i];
        obs.x -= speed * dt;
        if (obs.x + obs.w < -10){
          obstacles.splice(i,1);
        } else if (collides(trex, obs)){
          endGame();
          break;
        }
      }

      for (let i = clouds.length - 1; i >= 0; i--){
        const cl = clouds[i];
        cl.x -= cl.speed * dt * 0.3;
        if (cl.x < -120){
          cl.x = canvas.width/dpr + Math.random()*80;
          cl.y = 10 + Math.random()*40;
        }
      }
    }

    function endGame(){
      running = false;
      gameOver = true;
      playTone(220, 0.4);
      if (callbacks.onGameOver) callbacks.onGameOver(Math.floor(score));
    }

    function draw(){
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#1f2a44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, height - opts.groundHeight + 1);
      ctx.lineTo(width, height - opts.groundHeight + 1);
      ctx.stroke();

      ctx.fillStyle = '#1f2a44';
      clouds.forEach(cl=>{
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.ellipse(cl.x, cl.y, 26, 12, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      ctx.fillStyle = '#6ee7e7';
      obstacles.forEach(obs=>{
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
        ctx.fillStyle = '#4cbdbd';
        ctx.fillRect(obs.x + 4, obs.y + 6, obs.w - 8, obs.h - 6);
        ctx.fillStyle = '#6ee7e7';
      });

      drawTrex();

      ctx.fillStyle = '#9fb0d0';
      ctx.font = '12px Poppins, system-ui';
      ctx.textBaseline = 'top';
      ctx.fillText('Score ' + Math.floor(score).toString().padStart(5, '0'), width - 150, 12);
      if (paused){
        ctx.fillStyle = 'rgba(11,17,32,0.75)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 22px Poppins, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Paused', width/2, height/2 - 10);
        ctx.textAlign = 'left';
      }
    }

    function drawTrex(){
      const baseY = trex.y + trex.h;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(trex.x, trex.y, trex.w, trex.h);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(trex.x + trex.w - 10, trex.y + 12, 6, 6);
      ctx.fillRect(trex.x + 6, baseY - 12, 12, 12);
      ctx.fillRect(trex.x + trex.w - 20, baseY - 10, 14, trex.legFrame ? 10 : 6);
      ctx.fillRect(trex.x + 10, baseY - (trex.legFrame ? 6 : 10), 12, trex.legFrame ? 6 : 10);
      ctx.fillRect(trex.x + trex.w - 12, trex.y + 6, 12, 8);
    }

    function collides(player, obs){
      const pad = 4;
      return (
        player.x + player.w - pad > obs.x &&
        player.x + pad < obs.x + obs.w &&
        player.y + player.h - pad > obs.y &&
        player.y + pad < obs.y + obs.h
      );
    }

    function loop(ts){
      if (!running){
        draw();
        notifyFrame();
        return;
      }
      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      update(dt);
      draw();
      notifyFrame();
      requestAnimationFrame(loop);
    }

    function start(){
      if (running) return;
      reset();
      running = true;
      paused = false;
      gameOver = false;
      lastTs = 0;
      requestAnimationFrame(loop);
    }

    function resume(){
      if (!paused) return;
      paused = false;
      lastTs = 0;
      requestAnimationFrame(loop);
    }

    function pause(){
      if (!running || paused || gameOver) return;
      paused = true;
    }

    function isRunning(){ return running; }
    function isPaused(){ return paused; }
    function isMuted(){ return muted; }
    function isGameOver(){ return gameOver; }

    function togglePause(){ if (paused) resume(); else pause(); }

    function renderOnce(){ draw(); }

    resize();
    reset();
    renderOnce();

    return {
      start,
      pause,
      resume,
      togglePause,
      jump,
      duck,
      setMuted,
      isMuted,
      isRunning,
      isPaused,
      isGameOver,
      renderOnce,
      resize,
      loop: ()=>{ requestAnimationFrame(loop); }
    };
  }

  window.TrexRunner = TrexRunner;
})();
