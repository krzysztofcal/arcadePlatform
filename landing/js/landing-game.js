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
  var moveTimer = 0;

  bestEl.textContent = String(best);
  placeTarget();
  scheduleMove();

  target.addEventListener('click', function(){
    score += 1;
    streak += 1;
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      writeBest(best);
    }

    scoreEl.textContent = String(score);
    streakEl.textContent = String(streak);
    target.classList.add('is-hit');
    window.setTimeout(function(){ target.classList.remove('is-hit'); }, 110);
    placeTarget();
    scheduleMove();
  });

  game.addEventListener('pointerdown', function(event){
    if (event.target === target) return;
    streak = 0;
    streakEl.textContent = '0';
  });

  window.addEventListener('resize', function(){
    placeTarget();
  });

  function scheduleMove(){
    window.clearTimeout(moveTimer);
    var delay = Math.max(650, 1500 - streak * 75);
    moveTimer = window.setTimeout(function(){
      streak = 0;
      streakEl.textContent = '0';
      placeTarget();
      scheduleMove();
    }, delay);
  }

  function placeTarget(){
    var bounds = game.getBoundingClientRect();
    var size = Math.max(34, 54 - Math.min(streak, 12));
    var padding = Math.max(34, size);
    var x = randomBetween(padding, Math.max(padding, bounds.width - padding));
    var y = randomBetween(82, Math.max(120, bounds.height - padding));
    var xPercent = bounds.width ? (x / bounds.width) * 100 : 50;
    var yPercent = bounds.height ? (y / bounds.height) * 100 : 50;

    game.style.setProperty('--target-left', x + 'px');
    game.style.setProperty('--target-top', y + 'px');
    game.style.setProperty('--target-size', size + 'px');
    game.style.setProperty('--target-x', xPercent + '%');
    game.style.setProperty('--target-y', yPercent + '%');
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
