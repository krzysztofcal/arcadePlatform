/* Minimal distributor game frame: consent gating + responsive iframe */
(function(){
  const titleEl = document.getElementById('gameTitle');
  const metaEl = document.getElementById('gameMeta');
  const frameBox = document.getElementById('frameBox');
  const frameWrap = document.getElementById('frameWrap');
  const consentOverlay = document.getElementById('consentOverlay');
  const rotateOverlay = document.getElementById('rotateOverlay');
  const btnEnter = document.getElementById('btnEnterFs');
  const btnExit = document.getElementById('btnExitFs');

  const analytics = window.Analytics;
  let currentSlug = '';
  let pendingFsAction = null;
  let lastFsState = false;

  function track(method, payload){
    if (analytics && typeof analytics[method] === 'function'){
      analytics[method](payload);
    }
  }

  function qsParam(name){ return new URLSearchParams(location.search).get(name); }
  function getLang(){ return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'en'; }

  function sanitizeSameOriginUrl(urlString){
    if (!urlString) return null;
    try {
      const url = new URL(urlString, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.origin !== location.origin) return null;
      return url;
    } catch (e) {
      return null;
    }
  }

  function setDocTitle(text){ try { document.title = text ? (text + ' — Arcade') : 'Arcade — Game'; } catch {}
    if (titleEl) titleEl.textContent = text || 'Game';
  }

  function aspectFor(orientation){
    if (orientation === 'portrait') return '9 / 16';
    return '16 / 9';
  }

  function updateRotateOverlay(orientation){
    if (!orientation || orientation === 'any'){
      rotateOverlay.classList.add('hidden');
      return;
    }
    const isPhonePortrait = matchMedia('(orientation: portrait)').matches;
    if (orientation === 'landscape' && isPhonePortrait){
      rotateOverlay.classList.remove('hidden');
    } else if (orientation === 'portrait' && !isPhonePortrait){
      rotateOverlay.classList.remove('hidden');
    } else {
      rotateOverlay.classList.add('hidden');
    }
  }

  function onFsChange(){
    const fsActive = !!(document.fullscreenElement && frameWrap.contains(document.fullscreenElement));
    frameWrap.classList.toggle('fsActive', !!fsActive);
    btnEnter.style.display = fsActive ? 'none' : '';
    btnExit.style.display = fsActive ? '' : 'none';
    if (lastFsState !== fsActive){
      track('fullscreenToggle', {
        state: fsActive ? 'enter' : 'exit',
        slug: currentSlug || undefined,
        page: 'game',
        trigger: pendingFsAction && pendingFsAction.trigger ? pendingFsAction.trigger : 'system',
        requested: pendingFsAction && pendingFsAction.requested ? pendingFsAction.requested : undefined
      });
      lastFsState = fsActive;
    }
    pendingFsAction = null;
  }

  function enterFs(){
    pendingFsAction = { trigger: 'button', requested: 'enter' };
    try { frameWrap.requestFullscreen && frameWrap.requestFullscreen(); } catch {}
  }
  function exitFs(){
    pendingFsAction = { trigger: 'button', requested: 'exit' };
    try { document.exitFullscreen && document.exitFullscreen(); } catch {}
  }

  async function loadCatalog(){
    const res = await fetch('js/games.json', { cache: 'no-cache' });
    const data = await res.json();
    return Array.isArray(data?.games) ? data.games : (Array.isArray(data) ? data : []);
  }

  function waitForConsent(timeoutMs){
    return new Promise(resolve => {
      const start = Date.now();
      function giveUp(){ resolve({ ok:true, reason:'no-cmp' }); }
      if (typeof window.__tcfapi !== 'function'){
        // No CMP present; proceed after short delay (dev/staging)
        setTimeout(giveUp, 300);
        return;
      }
      // First, try immediate TCData
      try {
        window.__tcfapi('getTCData', 2, function(tcData, success){
          if (success && tcData && (tcData.eventStatus === 'tcloaded' || tcData.eventStatus === 'useractioncomplete')){
            resolve({ ok:true, tcData });
          } else {
            // Subscribe to changes
            window.__tcfapi('addEventListener', 2, function(tcData2, success2){
              if (success2 && tcData2 && (tcData2.eventStatus === 'tcloaded' || tcData2.eventStatus === 'useractioncomplete')){
                resolve({ ok:true, tcData: tcData2 });
              } else if (Date.now() - start > (timeoutMs || 10000)){
                resolve({ ok:true, reason:'timeout' });
              }
            });
          }
        });
      } catch(e){ giveUp(); }
    });
  }

  function injectIframe(url, orientation){
    frameBox.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'frameIframe';
    iframe.allowFullscreen = true;
    iframe.setAttribute('allow', 'fullscreen; autoplay');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.src = url;
    frameBox.appendChild(iframe);
    // Aspect ratio via CSS variable
    frameBox.style.setProperty('--frame-aspect', aspectFor(orientation));
    track('startGame', {
      slug: currentSlug || undefined,
      page: 'game',
      mode: 'iframe',
      embed_url: url
    });
  }

  async function init(){
    const slug = qsParam('slug');
    currentSlug = slug || '';
    const list = await loadCatalog();
    const lang = getLang();
    const game = list.find(g => (g.slug === slug));
    if (!game){ setDocTitle('Game not found'); if (metaEl) metaEl.textContent = 'Game not found.'; return; }

    const title = (game.title && (game.title[lang] || game.title.en)) || 'Game';
    const desc = (game.description && (game.description[lang] || game.description.en)) || '';
    setDocTitle(title);
    if (metaEl) metaEl.textContent = desc;
    track('viewGame', {
      slug: slug || undefined,
      lang,
      title,
      source: game.source && game.source.type || undefined
    });

    updateRotateOverlay(game.orientation || 'any');
    addEventListener('resize', () => updateRotateOverlay(game.orientation || 'any'));

    // If self-hosted, redirect to dedicated page
    if (game.source && game.source.type === 'self' && game.source.page){
      const safeUrl = sanitizeSameOriginUrl(game.source.page);
      if (!safeUrl){
        if (metaEl) metaEl.textContent = 'Invalid launch URL.';
        return;
      }
      safeUrl.searchParams.set('lang', lang);
      location.replace(safeUrl.toString());
      return;
    }

    const embed = game.source && (game.source.embedUrl || game.source.url);
    if (!embed){ if (metaEl) metaEl.textContent = 'Playable link missing.'; return; }

    // Consent gating
    try { const r = await waitForConsent(12000); } catch {}
    consentOverlay.classList.add('hidden');
    injectIframe(embed, game.orientation || 'any');

    btnEnter.addEventListener('click', enterFs);
    btnExit.addEventListener('click', exitFs);
    document.addEventListener('fullscreenchange', onFsChange);
    track('adImpression', {
      slot: 'game_top',
      page: 'game',
      slug: slug || undefined
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

