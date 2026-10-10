(function(){
  'use strict';
  var carousel = document.querySelector('.carousel');
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.tile'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('.dot'));
  var current = 0;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var descriptions = {
    single: ['Single Player', 'Planned online poker against existing bots, with exactly one human at a table. This is not offline poker. Admission, tier eligibility and bot funding require separate implementation in #1077.'],
    world: ['World Tour', 'A planned free choice of play path through designated country-themed tables. It is not a purchased cosmetic or reward. Table discovery, tier access and routing belong to #1075.'],
    seasons: ['Seasons', 'Planned winter, spring, summer and autumn visuals rotating weekly on designated themed tables. Ordinary Quick Play tables stay unchanged. Scheduling and gameplay routing belong to #1075.'],
    sitgo: ['Sit & Go', 'A planned tournament format that starts after enough players register. Tournament admission, blinds, bankroll and payouts are future work in #797.']
  };
  function goTo(index){
    index = Math.max(0, Math.min(tiles.length - 1, index));
    carousel.scrollTo({ left: tiles[index].offsetLeft - tiles[0].offsetLeft, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }
  function updatePosition(){
    var distance = Infinity;
    tiles.forEach(function(tile, index){
      var nextDistance = Math.abs(tile.offsetLeft - tiles[0].offsetLeft - carousel.scrollLeft);
      if (nextDistance < distance){ distance = nextDistance; current = index; }
    });
    if (carousel.scrollLeft >= carousel.scrollWidth - carousel.clientWidth - 2) current = tiles.length - 1;
    dots.forEach(function(dot, index){ dot.setAttribute('aria-current', String(index === current)); });
    document.querySelectorAll('[data-step]').forEach(function(button){ button.disabled = Number(button.dataset.step) < 0 ? current === 0 : current === tiles.length - 1; });
  }
  dots.forEach(function(dot){ dot.addEventListener('click', function(){ goTo(Number(dot.dataset.index)); }); });
  document.querySelectorAll('[data-step]').forEach(function(button){ button.addEventListener('click', function(){ goTo(current + Number(button.dataset.step)); }); });
  carousel.addEventListener('scroll', updatePosition, { passive: true });
  carousel.addEventListener('keydown', function(event){
    if (event.target !== carousel) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft'){ event.preventDefault(); goTo(current + (event.key === 'ArrowRight' ? 1 : -1)); }
    if (event.key === 'Home' || event.key === 'End'){ event.preventDefault(); goTo(event.key === 'Home' ? 0 : tiles.length - 1); }
  });
  document.querySelectorAll('[data-mode]').forEach(function(button){ button.addEventListener('click', function(){
    var description = descriptions[button.dataset.mode];
    document.getElementById('infoTitle').textContent = description[0];
    document.getElementById('infoCopy').textContent = description[1];
    document.getElementById('infoDialog').showModal();
  }); });
  document.querySelectorAll('[data-panel]').forEach(function(button){ button.addEventListener('click', function(){ document.getElementById(button.dataset.panel + 'Dialog').showModal(); }); });
  document.querySelectorAll('[data-close]').forEach(function(button){ button.addEventListener('click', function(){ button.closest('dialog').close(); }); });
  document.querySelectorAll('[data-theme]').forEach(function(button){ button.addEventListener('click', function(){
    document.getElementById('themeRoom').src = button.dataset.room;
    document.getElementById('themeRoom').alt = button.dataset.label + ' room artwork';
    document.getElementById('themeDealer').src = button.dataset.dealer;
    var felt = document.getElementById('themeFelt');
    felt.style.background = button.dataset.theme === 'classic-casino' ? '' : 'url("/poker/assets/themes/' + button.dataset.theme + '/felt.svg") center / cover';
    document.getElementById('themeSummary').textContent = button.dataset.label + ' · artwork preview only';
  }); });
  updatePosition();
})();
