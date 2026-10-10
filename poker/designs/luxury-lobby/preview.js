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
  window.addEventListener('resize', updatePosition);
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
  function openPanel(panel){
    var trigger = document.querySelector('[data-panel="' + panel + '"]');
    var dialog = document.getElementById(panel + 'Dialog');
    if (!trigger || !dialog || dialog.open) return;
    trigger.focus();
    dialog.showModal();
  }
  document.querySelectorAll('[data-panel]').forEach(function(button){ button.addEventListener('click', function(){ openPanel(button.dataset.panel); }); });
  document.querySelectorAll('[data-close]').forEach(function(button){ button.addEventListener('click', function(){ button.closest('dialog').close(); }); });
  var themeRequest = 0;
  var themeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-theme]'));
  var autoTheme = document.getElementById('autoTheme');
  function showTheme(button, auto){
    var request = ++themeRequest;
    var assets = ['room', 'dealer', 'rail', 'felt', 'face', 'back', 'frame'];
    var paths = assets.map(function(key){ return button.dataset[key]; }).filter(Boolean);
    Promise.all(paths.map(function(path){
      var img = new Image();
      img.src = path;
      return img.decode();
    })).then(function(){
      if (request !== themeRequest) return;
      ['room', 'dealer'].forEach(function(key){ document.getElementById('theme' + key.charAt(0).toUpperCase() + key.slice(1)).src = button.dataset[key]; });
      ['rail', 'felt'].forEach(function(key){
        document.getElementById('theme' + key.charAt(0).toUpperCase() + key.slice(1)).style.backgroundImage = button.dataset[key] ? 'url("' + button.dataset[key] + '")' : '';
      });
      ['face', 'back', 'frame'].forEach(function(key){
        var img = document.getElementById('theme' + key.charAt(0).toUpperCase() + key.slice(1));
        img.hidden = !button.dataset[key];
        if (button.dataset[key]) img.src = button.dataset[key];
        else img.removeAttribute('src');
      });
      document.getElementById('themeRoom').alt = button.dataset.label + ' room artwork';
      document.getElementById('themeSummary').textContent = auto ? 'Auto / Random · example: ' + button.dataset.label : button.dataset.label + ' · Free · manual preview';
      document.getElementById('themeSelectionNote').textContent = auto ? 'Auto / Random concept: one theme per participation, stable during play, reload and reconnect. This sample does not roll a random theme or save a preference.' : 'Manual preview: ' + button.dataset.label + '. Free for everyone. This choice is not saved or applied to gameplay.';
      autoTheme.setAttribute('aria-pressed', String(auto));
      themeButtons.forEach(function(entry){ entry.setAttribute('aria-pressed', String(!auto && entry === button)); });
    }).catch(function(){
      if (request === themeRequest) document.getElementById('themeSummary').textContent = 'Artwork unavailable · current preview retained';
    });
  }
  themeButtons.forEach(function(button){ button.addEventListener('click', function(){ showTheme(button, false); }); });
  autoTheme.addEventListener('click', function(){
    var example = themeButtons.filter(function(button){ return button.dataset.theme === 'neon-vegas'; })[0];
    if (example) showTheme(example, true);
  });
  updatePosition();
  function openHashPanel(){
    var panel = window.location.hash === '#daily-bonus' ? 'daily' : window.location.hash === '#cosmetics' ? 'cosmetics' : null;
    if (!panel) return;
    var currentDialog = document.querySelector('dialog[open]');
    if (currentDialog && currentDialog.id !== panel + 'Dialog') currentDialog.close();
    openPanel(panel);
  }
  window.addEventListener('hashchange', openHashPanel);
  openHashPanel();
})();
