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
  const introSection = document.getElementById('gameIntro');
  const coverWrap = document.getElementById('gameCoverWrap');
  const coverEl = document.getElementById('gameCover');
  const descriptionEl = document.getElementById('gameDescription');
  const categoriesEl = document.getElementById('gameCategories');
  const tagsEl = document.getElementById('gameTags');
  const similarSection = document.getElementById('similarSection');
  const similarList = document.getElementById('similarList');
  const canonicalLink = document.querySelector('link[rel="canonical"]');

  const analytics = window.Analytics;
  const catalog = window.ArcadeCatalog;
  const gameUtils = window.GameUtils && typeof window.GameUtils === 'object'
    ? window.GameUtils
    : null;
  let currentSlug = '';
  let pendingFsAction = null;
  let lastFsState = false;

  const SITE_NAME = 'Arcade Hub';
  const DEFAULT_PAGE_TITLE = SITE_NAME + ' — Game';
  const DEFAULT_DESCRIPTION = 'Discover and play hand-picked arcade games on Arcade Hub.';
  const FALLBACK_BASE = 'https://arcadehub.example/game.html';

  const metaSelectors = {
    description: 'meta[name="description"]',
    ogTitle: 'meta[property="og:title"]',
    ogDescription: 'meta[property="og:description"]',
    ogUrl: 'meta[property="og:url"]',
    twitterTitle: 'meta[name="twitter:title"]',
    twitterDescription: 'meta[name="twitter:description"]'
  };
  const metaDefaults = {};
  const metaElements = {};
  Object.keys(metaSelectors).forEach(key => {
    const el = document.querySelector(metaSelectors[key]);
    if (el){
      metaElements[key] = el;
      metaDefaults[key] = el.getAttribute('content') || '';
    }
  });
  const canonicalDefault = canonicalLink ? canonicalLink.getAttribute('href') : '';

  function track(method, payload){
    if (analytics && typeof analytics[method] === 'function'){
      analytics[method](payload);
    }
  }

  function qsParam(name){ return new URLSearchParams(location.search).get(name); }
  function getLang(){ return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'en'; }

  function updateMeta(key, value){
    const el = metaElements[key];
    if (!el) return;
    const fallback = metaDefaults[key] || '';
    el.setAttribute('content', value || fallback);
  }

  function updateCanonical(url){
    if (!canonicalLink) return;
    canonicalLink.setAttribute('href', url || canonicalDefault || FALLBACK_BASE);
  }

  function sanitizeSameOriginUrl(urlString){
    if (gameUtils && typeof gameUtils.sanitizeSelfPage === 'function'){
      return gameUtils.sanitizeSelfPage(urlString, location.href);
    }
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

  function setDocTitle(text){ try { document.title = text ? (text + ' — ' + SITE_NAME) : DEFAULT_PAGE_TITLE; } catch {}
    if (titleEl) titleEl.textContent = text || 'Game';
  }

  function computeShareUrl(slug){
    if (slug){
      try {
        const url = new URL(location.href);
        url.searchParams.set('slug', slug);
        return url.toString();
      } catch {}
      return FALLBACK_BASE + '?slug=' + encodeURIComponent(slug);
    }
    try { return new URL(location.href).toString(); } catch {}
    return FALLBACK_BASE;
  }

  function isPlayable(game){
    if (gameUtils && typeof gameUtils.isPlayable === 'function'){
      return gameUtils.isPlayable(game, location.href);
    }
    if (!game || !game.source) return false;
    if (game.source.type === 'placeholder') return false;
    if (game.source.page) return true;
    if (game.source.type === 'distributor' && (game.source.embedUrl || game.source.url)) return true;
    return false;
  }

  function updateMetaTags(params){
    const title = params && params.title ? params.title : '';
    const description = params && params.description ? params.description : DEFAULT_DESCRIPTION;
    const slug = params && params.slug ? params.slug : '';
    const shareTitle = title ? (title + ' — ' + SITE_NAME) : DEFAULT_PAGE_TITLE;
    const shareUrl = computeShareUrl(slug);
    updateMeta('description', description);
    updateMeta('ogTitle', shareTitle);
    updateMeta('ogDescription', description);
    updateMeta('ogUrl', shareUrl);
    updateMeta('twitterTitle', shareTitle);
    updateMeta('twitterDescription', description);
    updateCanonical(shareUrl);
  }

  function aspectFor(orientation){
    if (orientation === 'portrait') return '9 / 16';
    return '16 / 9';
  }

  function updateRotateOverlay(orientation){
    if (!rotateOverlay) return;
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

  function normalizeList(rawList){
    if (catalog && typeof catalog.normalizeGameList === 'function'){
      return catalog.normalizeGameList(rawList);
    }
    return Array.isArray(rawList) ? rawList.filter(Boolean) : [];
  }

async function loadCatalog(){
  try {
    const res = await fetch('js/games.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load games.json');
    const data = await res.json();
    if (data && Array.isArray(data.games)) return normalizeList(data.games);
    if (Array.isArray(data)) return normalizeList(data);
    throw new Error('Unexpected games catalog format');
  } catch (e) {
    console.error(e);
    return [];
  }
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

  const IFRAME_ACTIVITY_BRIDGE_ID = '__kcswhActivityBridge';
  const IFRAME_ACTIVITY_BRIDGE_SCRIPT = "(function(){" +
    "if (window.__kcswhActivityBridge) return;" +
    "window.__kcswhActivityBridge = true;" +
    "var TYPE='kcswh:activity';" +
    "var TARGET='*';" +
    "var last=Date.now();" +
    "var ACTIVE_WINDOW=5000;" +
    "var HEARTBEAT=4000;" +
    "var send=function(){ try { parent.postMessage({ type: TYPE }, TARGET); } catch (_){} };" +
    "var onActive=function(){ last=Date.now(); send(); };" +
    "['pointerdown','pointermove','pointerup','touchstart','touchmove','keydown'].forEach(function(evt){ try { document.addEventListener(evt,onActive,{ passive:true }); } catch(_){ document.addEventListener(evt,onActive); } });" +
    "var beat=function(){ if (Date.now() - last <= ACTIVE_WINDOW) send(); };" +
    "var timer=setInterval(beat, HEARTBEAT);" +
    "document.addEventListener('visibilitychange', function(){ if (document.hidden){ if (timer){ clearInterval(timer); timer=null; } } else if (!timer){ last=Date.now(); send(); timer=setInterval(beat, HEARTBEAT); } }, { passive:true });" +
    "send();" +
  "})();";

  function injectActivityBridgeIntoIframe(iframe){
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.documentElement) return;
      if (doc.getElementById(IFRAME_ACTIVITY_BRIDGE_ID)) return;
      const script = doc.createElement('script');
      script.id = IFRAME_ACTIVITY_BRIDGE_ID;
      script.type = 'text/javascript';
      script.text = IFRAME_ACTIVITY_BRIDGE_SCRIPT;
      doc.documentElement.appendChild(script);
    } catch (_){ /* noop */ }
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
    const postTarget = (function(){
      try {
        if (typeof window !== 'undefined' && window.location && window.location.origin){
          return window.location.origin;
        }
      } catch (_){ }
      return '*';
    })();
    const iframeEvents = ['pointerover', 'pointermove', 'touchstart', 'focus'];
    let listenersAttached = false;
    const onIframeActivity = () => {
      try { window.postMessage({ type: 'kcswh:activity' }, postTarget); } catch (_){ }
    };
    const attachIframeActivityListeners = () => {
      if (listenersAttached) return;
      listenersAttached = true;
      iframeEvents.forEach(evt => {
        try { iframe.addEventListener(evt, onIframeActivity, { passive: true }); }
        catch (_){ iframe.addEventListener(evt, onIframeActivity); }
      });
    };
    try {
      attachIframeActivityListeners();
      if (typeof iframe.addEventListener === 'function'){
        iframe.addEventListener('load', () => {
          attachIframeActivityListeners();
          injectActivityBridgeIntoIframe(iframe);
        });
      }
      injectActivityBridgeIntoIframe(iframe);
    } catch (_){ }
    // Aspect ratio via CSS variable
    frameBox.style.setProperty('--frame-aspect', aspectFor(orientation));
    track('startGame', {
      slug: currentSlug || undefined,
      page: 'game',
      mode: 'iframe',
      embed_url: url
    });
  }

  function renderPills(target, values, type){
    if (!target) return;
    target.innerHTML = '';
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length){
      target.hidden = true;
      target.style.display = 'none';
      return;
    }
    target.hidden = false;
    target.style.display = '';
    items.forEach(item => {
      const span = document.createElement('span');
      span.className = 'pill' + (type === 'tag' ? ' tag' : '');
      span.textContent = item;
      target.appendChild(span);
    });
  }

  function renderHero(game, title, description){
    if (descriptionEl){
      descriptionEl.textContent = description || DEFAULT_DESCRIPTION;
    }
    if (coverWrap){
      const thumb = game && game.thumbnail;
      if (thumb && coverEl){
        coverEl.src = thumb;
        coverEl.alt = title ? (title + ' cover art') : 'Game cover art';
        coverWrap.hidden = false;
        coverWrap.style.display = '';
      } else {
        if (coverEl){
          coverEl.removeAttribute('src');
          coverEl.alt = '';
        }
        coverWrap.hidden = true;
        coverWrap.style.display = 'none';
      }
    }
    renderPills(categoriesEl, game && game.category, 'category');
    renderPills(tagsEl, game && game.tags, 'tag');
    if (introSection){
      introSection.hidden = false;
      introSection.style.display = '';
    }
  }

  function renderMetaBar(game){
    if (!metaEl) return;
    if (!game){
      metaEl.textContent = '';
      return;
    }
    const bits = [];
    if (Array.isArray(game.category) && game.category.length){
      bits.push('Category: ' + game.category.join(', '));
    }
    if (Array.isArray(game.tags) && game.tags.length){
      bits.push('Tags: ' + game.tags.join(', '));
    }
    if (game.orientation && game.orientation !== 'any'){
      bits.push('Best on ' + game.orientation + ' screens');
    }
    metaEl.textContent = bits.join(' • ');
  }

  function scoreSimilar(base, candidate){
    if (!base || !candidate) return 0;
    const baseCats = new Set((base.category || []).map(c => c && c.toLowerCase()));
    const baseTags = new Set((base.tags || []).map(t => t && t.toLowerCase()));
    let score = 0;
    (candidate.category || []).forEach(cat => {
      if (cat && baseCats.has(cat.toLowerCase())) score += 2;
    });
    (candidate.tags || []).forEach(tag => {
      if (tag && baseTags.has(tag.toLowerCase())) score += 1;
    });
    if (candidate.orientation && base.orientation && candidate.orientation === base.orientation) score += 0.5;
    return score;
  }

  function renderSimilarGames(game, list, lang){
    if (!similarSection || !similarList){
      return;
    }
    similarList.innerHTML = '';
    const others = Array.isArray(list) ? list.filter(g => g && g.slug !== game.slug && isPlayable(g)) : [];
    if (!others.length){
      similarSection.hidden = true;
      return;
    }
    let ranked = others.map(g => ({ game: g, score: scoreSimilar(game, g) }))
      .filter(entry => entry.score > 0);
    if (!ranked.length){
      ranked = others.map(g => ({ game: g, score: 0 }));
    }
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTitle = (a.game.title && (a.game.title[lang] || a.game.title.en)) || a.game.slug || '';
      const bTitle = (b.game.title && (b.game.title[lang] || b.game.title.en)) || b.game.slug || '';
      return aTitle.localeCompare(bTitle);
    });
    const picks = ranked.slice(0, 4).map(entry => entry.game);
    if (!picks.length){
      similarSection.hidden = true;
      return;
    }
    picks.forEach(g => {
      const card = document.createElement('a');
      card.className = 'similarCard';
      const slug = g.slug || g.id || '';
      let href = '#';
      if (g.source && g.source.page){
        const safe = sanitizeSameOriginUrl(g.source.page);
        if (safe){
          try {
            safe.searchParams.set('lang', lang);
            if (slug) safe.searchParams.set('slug', slug);
            href = safe.toString();
          } catch (_){
            href = safe.toString();
          }
        }
      } else if (slug) {
        try {
          const url = new URL('game.html', location.href);
          url.searchParams.set('slug', slug);
          url.searchParams.set('lang', lang);
          href = url.toString();
        } catch (_){
          href = 'game.html?slug=' + encodeURIComponent(slug) + '&lang=' + encodeURIComponent(lang);
        }
      }
      if (href === '#') return;
      card.href = href;
      const title = (g.title && (g.title[lang] || g.title.en)) || slug || 'Game';
      card.setAttribute('aria-label', 'Open ' + title);
      if (g.thumbnail){
        const img = document.createElement('img');
        img.className = 'similarThumb';
        img.src = g.thumbnail;
        img.alt = title + ' cover art';
        img.loading = 'lazy';
        img.decoding = 'async';
        card.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'similarThumb';
        placeholder.setAttribute('aria-hidden', 'true');
        card.appendChild(placeholder);
      }
      const body = document.createElement('div');
      body.className = 'similarBody';
      const heading = document.createElement('h3');
      heading.textContent = title;
      body.appendChild(heading);
      const metaWrap = document.createElement('div');
      metaWrap.className = 'similarMeta';
      const metaItems = (g.category && g.category.length ? g.category : (g.tags || [])).slice(0, 2);
      metaItems.forEach(item => {
        const span = document.createElement('span');
        span.className = 'metaChip';
        span.textContent = item;
        metaWrap.appendChild(span);
      });
      if (metaWrap.childElementCount){
        body.appendChild(metaWrap);
      }
      card.appendChild(body);
      similarList.appendChild(card);
    });
    similarSection.hidden = false;
  }

function showEmptyState(titleText, message, options){
  const text = message || 'Game not found.';
  const heading = titleText || 'Game not found';
  const linkHref = options && options.linkHref ? options.linkHref : '';
  const linkLabel = options && options.linkLabel ? options.linkLabel : 'Browse games';
  setDocTitle(heading);
  updateMetaTags({ title: heading, description: text, slug: currentSlug });
  if (descriptionEl) descriptionEl.textContent = text;
  if (introSection){
    introSection.hidden = true;
    introSection.style.display = 'none';
  }
  if (metaEl) metaEl.textContent = text;
  if (frameWrap) frameWrap.classList.add('empty');
  if (frameBox){
    let inner = '<div class="emptyState"><p>' + text + '</p>';
    if (linkHref){
      inner += '<p><a class="emptyStateLink" href="' + linkHref + '">' + linkLabel + '</a></p>';
    }
    inner += '</div>';
    frameBox.innerHTML = inner;
  }
  if (consentOverlay) consentOverlay.classList.add('hidden');
  if (rotateOverlay) rotateOverlay.classList.add('hidden');
  if (btnEnter) btnEnter.style.display = 'none';
  if (btnExit) btnExit.style.display = 'none';
  if (similarSection) similarSection.hidden = true;
  if (similarList) similarList.innerHTML = '';
}

function showCatalogError(){
  showEmptyState('Catalog error', 'Catalog error. Please try again later.', {
    linkHref: 'index.html',
    linkLabel: 'Return to home'
  });
}

async function init(){
  const slug = qsParam('slug') || '';
  currentSlug = slug;

  let list;
  try {
    list = await loadCatalog();
  } catch (err) {
    console.error(err);
    showCatalogError();
    return;
  }

  const lang = getLang();
  const game = list.find(g => g.slug === slug);

  if (!slug || !game){
    showEmptyState(
      slug ? 'Game not found' : 'No game selected',
      slug ? 'Game not found.' : 'Choose a game from the catalog to start playing.',
      { linkHref: 'index.html', linkLabel: 'Browse games' }
    );
    return;
  }

  // Existing render/meta/iframe logic (unchanged)
  const title = (game.title && (game.title[lang] || game.title.en)) || 'Game';
  const desc = (game.description && (game.description[lang] || game.description.en)) || '';
  if (frameWrap) frameWrap.classList.remove('empty');
  if (frameBox && frameBox.querySelector('.emptyState')) frameBox.innerHTML = '';
  if (btnEnter) btnEnter.style.display = '';
  if (btnExit) btnExit.style.display = 'none';
  setDocTitle(title);
  updateMetaTags({ title, description: desc || DEFAULT_DESCRIPTION, slug });
  renderHero(game, title, desc);
  renderMetaBar(game);
  renderSimilarGames(game, list, lang);
  if (metaEl && !metaEl.textContent){
    metaEl.textContent = desc || 'More details coming soon.';
  }
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
  if (!embed){
    if (metaEl) metaEl.textContent = 'Playable URL missing.';
    return;
  }

  if (window.XP){
    try { window.XP.stopSession({ flush: true }); } catch (_){ /* noop */ }
    if (typeof window.XP.startSession === 'function'){
      try { window.XP.startSession(slug); } catch (_){ /* noop */ }
    }
  }

  // Consent gating
  try { await waitForConsent(12000); } catch(e) {}
  if (consentOverlay) consentOverlay.classList.add('hidden');

  injectIframe(embed, game.orientation || 'any');

  if (btnEnter) btnEnter.addEventListener('click', enterFs);
  if (btnExit) btnExit.addEventListener('click', exitFs);
  document.addEventListener('fullscreenchange', onFsChange);

  track('adImpression', { slot: 'game_top', page: 'game', slug: slug || undefined });
}
  if (typeof window !== 'undefined'){
    const cleanup = () => {
      if (window.XP && typeof window.XP.stopSession === 'function'){
        try { window.XP.stopSession({ flush: true }); } catch (_){ /* noop */ }
      }
    };
    window.addEventListener('pagehide', (event) => {
      if (!event || !event.persisted) cleanup();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

// --- bfcache handling for frame.js ---
(function () {
  window.addEventListener('pagehide', function (e) {
    if (!e || !e.persisted) { try { cleanup(); } catch (_) {} }
  });

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
window.addEventListener('beforeunload', cleanup);
