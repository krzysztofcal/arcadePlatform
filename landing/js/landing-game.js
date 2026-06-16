(function(){
  var game = document.querySelector('[data-landing-game]');
  if (!game) return;

  var target = game.querySelector('[data-target]');
  var scoreEl = game.querySelector('[data-score]');
  var streakEl = game.querySelector('[data-streak]');
  var bestEl = game.querySelector('[data-best]');
  if (!target || !scoreEl || !streakEl || !bestEl) return;

  var score = 0;
  var streak = 0;
  var best = readBest();
  var speed = 42;
  var lastFrame = 0;
  var lastEvent = 0;
  var nextEventDelay = randomBetween(3600, 6200);
  var shrinkTimer = 0;
  var clones = [];
  var pixel = createPixelState(target, true);

  bestEl.textContent = String(best);
  resetPixel(pixel, true);
  requestAnimationFrame(tick);

  target.addEventListener('click', function(event){
    event.stopPropagation();
    hitPixel(pixel);
  });

  game.addEventListener('pointerdown', function(event){
    if (event.target && event.target.classList && event.target.classList.contains('pixel-target')) return;
    streak = 0;
    streakEl.textContent = '0';
  });

  window.addEventListener('resize', function(){
    clampPixel(pixel);
    clones.forEach(clampPixel);
    renderPixel(pixel);
    clones.forEach(renderPixel);
  });

  function tick(now){
    if (!lastFrame) lastFrame = now;
    var dt = Math.min(0.032, (now - lastFrame) / 1000);
    lastFrame = now;

    movePixel(pixel, dt);
    clones.forEach(function(clone){ movePixel(clone, dt); });
    clones = clones.filter(function(clone){
      if (now <= clone.expiresAt) return true;
      clone.el.remove();
      return false;
    });

    if (!lastEvent) lastEvent = now;
    if (now - lastEvent > nextEventDelay) {
      runRandomEvent(now);
      lastEvent = now;
      nextEventDelay = randomBetween(4200, 7600);
    }

    renderPixel(pixel);
    clones.forEach(renderPixel);
    requestAnimationFrame(tick);
  }

  function hitPixel(activePixel){
    score += 1;
    streak += 1;
    speed = Math.min(380, speed + 18 + streak * 1.4);

    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      writeBest(best);
    }

    scoreEl.textContent = String(score);
    streakEl.textContent = String(streak);
    burst(activePixel.x, activePixel.y);
    activePixel.el.classList.add('is-hit');
    window.setTimeout(function(){ activePixel.el.classList.remove('is-hit'); }, 110);
    redirectPixel(activePixel);
  }

  function runRandomEvent(now){
    if (Math.random() > 0.48) {
      shrinkPixel();
      return;
    }
    duplicatePixel(now);
  }

  function shrinkPixel(){
    window.clearTimeout(shrinkTimer);
    target.classList.add('is-small');
    shrinkTimer = window.setTimeout(function(){
      target.classList.remove('is-small');
    }, 1700);
  }

  function duplicatePixel(now){
    var count = Math.random() > 0.55 ? 2 : 1;
    for (var i = 0; i < count; i += 1) {
      var cloneEl = document.createElement('button');
      cloneEl.type = 'button';
      cloneEl.className = 'pixel-target is-clone';
      cloneEl.setAttribute('aria-label', 'Catch the bonus pixel');
      game.appendChild(cloneEl);

      var clone = createPixelState(cloneEl, false);
      clone.expiresAt = now + randomBetween(1800, 2600);
      resetPixel(clone, false);
      cloneEl.addEventListener('click', function(event){
        event.stopPropagation();
        var activeClone = clones.find(function(item){ return item.el === event.currentTarget; });
        if (!activeClone) return;
        hitPixel(activeClone);
        activeClone.expiresAt = 0;
      });
      clones.push(clone);
    }
  }

  function createPixelState(el, primary){
    var angle = Math.random() * Math.PI * 2;
    return {
      el: el,
      primary: primary,
      x: 0,
      y: 0,
      vx: Math.cos(angle),
      vy: Math.sin(angle),
      size: primary ? 52 : 38,
      expiresAt: Infinity,
    };
  }

  function resetPixel(item, centered){
    var bounds = game.getBoundingClientRect();
    item.size = item.primary ? 52 : 38;
    item.x = centered ? bounds.width * 0.5 : randomBetween(54, Math.max(54, bounds.width - 54));
    item.y = centered ? bounds.height * 0.58 : randomBetween(94, Math.max(120, bounds.height - 54));
    redirectPixel(item);
    clampPixel(item);
    renderPixel(item);
  }

  function redirectPixel(item){
    var angle = Math.random() * Math.PI * 2;
    item.vx = Math.cos(angle);
    item.vy = Math.sin(angle);
  }

  function movePixel(item, dt){
    var multiplier = item.primary ? 1 : 0.82;
    item.x += item.vx * speed * multiplier * dt;
    item.y += item.vy * speed * multiplier * dt;
    bouncePixel(item);
  }

  function bouncePixel(item){
    var bounds = game.getBoundingClientRect();
    var pad = item.size / 2 + 8;
    var topPad = 84;
    var maxX = Math.max(pad, bounds.width - pad);
    var maxY = Math.max(topPad, bounds.height - pad);

    if (item.x < pad || item.x > maxX) {
      item.x = Math.min(maxX, Math.max(pad, item.x));
      item.vx *= -1;
    }
    if (item.y < topPad || item.y > maxY) {
      item.y = Math.min(maxY, Math.max(topPad, item.y));
      item.vy *= -1;
    }
  }

  function clampPixel(item){
    bouncePixel(item);
  }

  function renderPixel(item){
    var bounds = game.getBoundingClientRect();
    var xPercent = bounds.width ? (item.x / bounds.width) * 100 : 50;
    var yPercent = bounds.height ? (item.y / bounds.height) * 100 : 50;

    item.el.style.setProperty('--target-left', item.x + 'px');
    item.el.style.setProperty('--target-top', item.y + 'px');
    item.el.style.setProperty('--target-size', item.size + 'px');

    if (item.primary) {
      game.style.setProperty('--target-left', item.x + 'px');
      game.style.setProperty('--target-top', item.y + 'px');
      game.style.setProperty('--target-size', item.size + 'px');
      game.style.setProperty('--target-x', xPercent + '%');
      game.style.setProperty('--target-y', yPercent + '%');
    }
  }

  function burst(x, y){
    var node = document.createElement('span');
    node.className = 'pixel-burst';
    node.style.setProperty('--burst-left', x + 'px');
    node.style.setProperty('--burst-top', y + 'px');
    game.appendChild(node);
    window.setTimeout(function(){ node.remove(); }, 560);
  }

  function randomBetween(min, max){
    if (max <= min) return min;
    return Math.round(min + Math.random() * (max - min));
  }

  function readBest(){
    try {
      return Number(window.localStorage.getItem('landingPixelBest')) || 0;
    } catch (_err) {
      return 0;
    }
  }

  function writeBest(value){
    try {
      window.localStorage.setItem('landingPixelBest', String(value));
    } catch (_err) {}
  }
})();
