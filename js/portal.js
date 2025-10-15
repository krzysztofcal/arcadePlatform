(function(){
  const grid = document.getElementById('gamesGrid');
  if (!grid || !Array.isArray(window.GAMES)) return;

  function cardPlayable(item){
    const a = document.createElement('a');
    a.className = 'card';
    a.href = item.href;
    a.innerHTML = `
      <div class="thumb"></div>
      <span class="label">PLAY</span>
      <div class="title">${item.title}</div>
      <div class="subtitle">${item.subtitle || ''}</div>
    `;
    return a;
  }

  function cardPlaceholder(item){
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <div class="thumb"></div>
      <div class="title">${item.title}</div>
      <div class="subtitle">${item.subtitle || 'Under construction'}</div>
      <div class="uc">Under construction</div>
    `;
    return el;
  }

  for (const item of window.GAMES){
    const node = item.href ? cardPlayable(item) : cardPlaceholder(item);
    grid.appendChild(node);
  }
})();

