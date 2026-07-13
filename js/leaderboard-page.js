(function(window, document){
  if (!window || !document) return;

  var PUBLIC_URL = '/.netlify/functions/xp-leaderboard';
  var ME_URL = '/.netlify/functions/xp-leaderboard-me';
  var PERIODS = ['today', 'week', 'all_time'];
  var PAGE_LIMIT = 25;
  var state = { period: 'all_time', page: 1, hasMore: false, publicData: null, me: null, generation: 0, meGeneration: 0, controller: null, booted: false };
  var nodes = {};

  function klog(kind, data){
    try { if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {}); } catch (_err){}
  }

  function t(key, fallback, values){
    try {
      if (window.I18N && typeof window.I18N.format === 'function'){
        var formatted = window.I18N.format(key, values || {});
        if (formatted) return formatted;
      }
      if (window.I18N && typeof window.I18N.t === 'function'){
        var translated = window.I18N.t(key);
        if (translated) return translated;
      }
    } catch (_err){}
    return fallback;
  }

  function locale(){
    try { return window.I18N && window.I18N.getLang() === 'pl' ? 'pl-PL' : 'en-US'; } catch (_err){ return 'en-US'; }
  }

  function formatNumber(value){ return new Intl.NumberFormat(locale()).format(Math.max(0, Number(value) || 0)); }

  function formatReset(value){
    var timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    return new Intl.DateTimeFormat(locale(), { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
  }

  function positiveInteger(value, fallback){
    var parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  function readRoute(){
    var params = new URLSearchParams(window.location.search || '');
    var period = params.get('period');
    state.period = PERIODS.indexOf(period) >= 0 ? period : 'all_time';
    state.page = Math.min(20, positiveInteger(params.get('page'), 1));
  }

  function writeRoute(push){
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('period', state.period);
      if (state.page > 1) url.searchParams.set('page', String(state.page)); else url.searchParams.delete('page');
      window.history[push ? 'pushState' : 'replaceState'](null, '', url.toString());
    } catch (_err){}
  }

  function normalizeAvatar(avatar){
    if (!avatar || typeof avatar !== 'object') return { type: 'default', variant: 'default' };
    if (avatar.type === 'uploaded' && typeof avatar.url === 'string' && /^https:\/\//.test(avatar.url)) return { type: 'uploaded', url: avatar.url };
    return { type: 'default', variant: typeof avatar.variant === 'string' ? avatar.variant : 'default' };
  }

  function normalizeRow(row){
    if (!row || typeof row !== 'object') return null;
    var handle = typeof row.handle === 'string' ? row.handle.trim().toLowerCase() : '';
    var displayName = typeof row.displayName === 'string' ? row.displayName.trim() : '';
    var rank = Number(row.rank);
    var xp = Number(row.xp);
    var level = Number(row.level);
    if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(handle) || !displayName || !Number.isSafeInteger(rank) || rank < 1 || !Number.isSafeInteger(xp) || xp < 0 || !Number.isSafeInteger(level) || level < 1) return null;
    return { rank: rank, handle: handle, displayName: displayName, avatar: normalizeAvatar(row.avatar), xp: xp, level: level, profileUrl: '/u/' + encodeURIComponent(handle) };
  }

  function parsePayload(response){
    return response.json().catch(function(){ return {}; }).then(function(payload){
      if (response.ok) return payload;
      var error = new Error(payload && payload.error ? payload.error : 'leaderboard_unavailable');
      error.code = payload && payload.error ? payload.error : 'leaderboard_unavailable';
      error.status = response.status;
      throw error;
    });
  }

  function publicRequest(signal){
    var params = new URLSearchParams({ period: state.period, page: String(state.page), limit: String(PAGE_LIMIT) });
    return fetch(PUBLIC_URL + '?' + params.toString(), { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', signal: signal }).then(parsePayload);
  }

  function accessToken(){
    var bridge = window.SupabaseAuthBridge;
    if (!bridge || typeof bridge.getAccessToken !== 'function') return Promise.resolve(null);
    return Promise.resolve(bridge.getAccessToken()).catch(function(){ return null; });
  }

  function meRequest(signal){
    return accessToken().then(function(token){
      if (!token) return null;
      var params = new URLSearchParams({ period: state.period });
      return fetch(ME_URL + '?' + params.toString(), { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }, credentials: 'omit', cache: 'no-store', signal: signal }).then(parsePayload).then(function(payload){ return normalizeRow(payload && payload.me); }).catch(function(error){
        if (error && error.name === 'AbortError') throw error;
        klog('leaderboard_me_unavailable', { status: error && error.status ? error.status : 0 });
        return null;
      });
    });
  }

  function clear(node){ while (node && node.firstChild) node.removeChild(node.firstChild); }

  function avatarNode(row){
    var avatar = document.createElement('span');
    avatar.className = 'leaderboard-entry__avatar';
    avatar.setAttribute('role', 'img');
    avatar.setAttribute('aria-label', t('leaderboardAvatarAria', 'Avatar of ' + row.displayName, { name: row.displayName }));
    if (window.ProfileClient && typeof window.ProfileClient.applyAvatar === 'function') window.ProfileClient.applyAvatar(avatar, row);
    else avatar.textContent = row.displayName.slice(0, 2).toUpperCase();
    return avatar;
  }

  function entryNode(row, options){
    var opts = options || {};
    var item = document.createElement('li');
    item.className = opts.podium ? 'leaderboard-entry' : 'leaderboard-entry leaderboard-entry--row';
    if (opts.isMe) item.classList.add('leaderboard-entry--me');

    var rank = document.createElement('span');
    rank.className = 'leaderboard-entry__rank';
    rank.textContent = '#' + row.rank;

    var profile = document.createElement('a');
    profile.className = 'leaderboard-entry__profile';
    profile.href = row.profileUrl;
    profile.setAttribute('aria-label', t('leaderboardProfileAria', 'Open public profile for ' + row.displayName, { name: row.displayName }));
    profile.appendChild(avatarNode(row));

    var identity = document.createElement('span');
    identity.className = 'leaderboard-entry__identity';
    var name = document.createElement('span');
    name.className = 'leaderboard-entry__name';
    name.textContent = row.displayName;
    if (opts.isMe){
      var you = document.createElement('span');
      you.className = 'leaderboard-entry__you';
      you.textContent = t('leaderboardYou', 'You');
      name.appendChild(you);
    }
    var handle = document.createElement('span');
    handle.className = 'leaderboard-entry__handle';
    handle.textContent = '@' + row.handle;
    identity.appendChild(name);
    identity.appendChild(handle);
    profile.appendChild(identity);

    var score = document.createElement('span');
    score.className = 'leaderboard-entry__score';
    score.textContent = formatNumber(row.xp) + ' XP';
    var level = document.createElement('span');
    level.className = 'leaderboard-entry__level';
    level.textContent = t('leaderboardLevel', 'Level') + ' ' + row.level;

    item.appendChild(rank);
    item.appendChild(profile);
    item.appendChild(score);
    item.appendChild(level);
    return item;
  }

  function setPeriodControls(){
    nodes.periodButtons.forEach(function(button){ button.setAttribute('aria-pressed', button.dataset.period === state.period ? 'true' : 'false'); });
  }

  function resetText(data){
    if (!data){ nodes.reset.textContent = ''; return; }
    var reset = formatReset(data.nextResetAt);
    if (state.period === 'today') nodes.reset.textContent = t('leaderboardTodayReset', 'Today resets at 03:00 Warsaw time. Next reset: ' + reset + '.', { time: reset });
    else if (state.period === 'week') nodes.reset.textContent = t('leaderboardWeekReset', 'The week resets Monday at 03:00 Warsaw time. Next reset: ' + reset + '.', { time: reset });
    else nodes.reset.textContent = t('leaderboardAllTimeHint', 'All confirmed XP earned by authenticated players.');
  }

  function showLoading(){
    nodes.loading.hidden = false;
    nodes.results.hidden = true;
    nodes.state.hidden = true;
    nodes.live.textContent = t('leaderboardLoading', 'Loading leaderboard...');
  }

  function showState(kind){
    var content = kind === 'rate_limit'
      ? ['leaderboardRateLimitTitle', 'Please wait a moment', 'leaderboardRateLimitText', 'The leaderboard was refreshed too often. Try again in one minute.']
      : kind === 'not_enabled'
        ? ['leaderboardUnavailableTitle', 'Leaderboard unavailable', 'leaderboardNotEnabledText', 'The leaderboard is not available in this environment yet.']
        : kind === 'empty'
          ? ['leaderboardWarmupTitle', 'The ranking is warming up', 'leaderboardWarmupText', 'No confirmed XP has been recorded for this period yet. Play a game and check back soon.']
          : ['leaderboardUnavailableTitle', 'Leaderboard unavailable', 'leaderboardUnavailableText', 'We could not load the ranking right now. Please try again.'];
    nodes.loading.hidden = true;
    nodes.results.hidden = true;
    nodes.state.hidden = false;
    nodes.stateTitle.textContent = t(content[0], content[1]);
    nodes.stateText.textContent = t(content[2], content[3]);
    nodes.retry.hidden = kind === 'empty' || kind === 'not_enabled';
    nodes.live.textContent = nodes.stateTitle.textContent + '. ' + nodes.stateText.textContent;
  }

  function renderEmptyPage(data, me){
    clear(nodes.podium);
    clear(nodes.list);
    clear(nodes.meRow);
    nodes.podium.hidden = true;
    nodes.tableHead.hidden = true;
    nodes.pageEmpty.hidden = false;
    nodes.pageEmptyTitle.textContent = t('leaderboardPageEmptyTitle', 'No results on this page');
    nodes.pageEmptyText.textContent = t('leaderboardPageEmptyText', 'No public profiles are available in this part of the ranking. Use the page controls to continue.');
    nodes.me.hidden = !me;
    if (me) nodes.meRow.appendChild(entryNode(me, { isMe: true }));
    nodes.previous.disabled = state.page <= 1;
    nodes.next.disabled = !state.hasMore;
    nodes.pageNumber.textContent = t('leaderboardPageStatus', 'Page ' + state.page, { page: state.page });
    nodes.loading.hidden = true;
    nodes.state.hidden = true;
    nodes.results.hidden = false;
    resetText(data);
    nodes.live.textContent = nodes.pageEmptyTitle.textContent + '. ' + nodes.pageNumber.textContent + '.';
  }

  function renderResults(data, me){
    var rows = Array.isArray(data && data.rows) ? data.rows.map(normalizeRow).filter(Boolean) : [];
    state.hasMore = data.hasMore === true;
    if (!rows.length){
      if (state.page === 1 && !state.hasMore) showState('empty');
      else renderEmptyPage(data, me);
      return;
    }
    clear(nodes.podium);
    clear(nodes.list);
    clear(nodes.meRow);
    nodes.pageEmpty.hidden = true;
    var loadedHandles = new Set(rows.map(function(row){ return row.handle; }));
    var podiumRows = state.page === 1 ? rows.slice(0, 3) : [];
    var listRows = state.page === 1 ? rows.slice(3) : rows;
    podiumRows.forEach(function(row){ nodes.podium.appendChild(entryNode(row, { podium: true, isMe: !!me && me.handle === row.handle })); });
    listRows.forEach(function(row){ nodes.list.appendChild(entryNode(row, { isMe: !!me && me.handle === row.handle })); });
    nodes.podium.hidden = podiumRows.length === 0;
    nodes.tableHead.hidden = listRows.length === 0;
    nodes.me.hidden = !me || loadedHandles.has(me.handle);
    if (!nodes.me.hidden) nodes.meRow.appendChild(entryNode(me, { isMe: true }));
    nodes.previous.disabled = state.page <= 1;
    nodes.next.disabled = !state.hasMore;
    nodes.pageNumber.textContent = t('leaderboardPageStatus', 'Page ' + state.page, { page: state.page });
    nodes.loading.hidden = true;
    nodes.state.hidden = true;
    nodes.results.hidden = false;
    resetText(data);
    nodes.live.textContent = t('leaderboardLoaded', 'Leaderboard loaded.') + ' ' + nodes.pageNumber.textContent + '.';
  }

  function renderCurrent(){
    setPeriodControls();
    if (state.publicData) renderResults(state.publicData, state.me);
    document.title = t('leaderboardPageTitle', 'XP Leaderboard') + ' - Arcade Hub';
  }

  function load(){
    state.generation += 1;
    state.meGeneration += 1;
    var generation = state.generation;
    var meGeneration = state.meGeneration;
    if (state.controller) state.controller.abort();
    state.controller = typeof AbortController === 'function' ? new AbortController() : null;
    var signal = state.controller ? state.controller.signal : undefined;
    state.publicData = null;
    state.me = null;
    state.hasMore = false;
    setPeriodControls();
    showLoading();
    resetText(null);
    return Promise.all([publicRequest(signal), meRequest(signal)]).then(function(results){
      if (generation !== state.generation) return;
      state.publicData = results[0];
      if (meGeneration === state.meGeneration) state.me = results[1];
      renderResults(state.publicData, state.me);
      klog('leaderboard_page_loaded', { period: state.period, page: state.page, rows: Array.isArray(state.publicData.rows) ? state.publicData.rows.length : 0 });
    }).catch(function(error){
      if (error && error.name === 'AbortError') return;
      if (generation !== state.generation) return;
      if (error && (error.status === 429 || error.code === 'rate_limit_exceeded')) showState('rate_limit');
      else if (error && error.status === 404) showState('not_enabled');
      else showState('error');
      klog('leaderboard_page_failed', { period: state.period, page: state.page, status: error && error.status ? error.status : 0 });
    });
  }

  function refreshMe(){
    state.meGeneration += 1;
    var generation = state.meGeneration;
    state.me = null;
    if (state.publicData) renderCurrent();
    return meRequest().then(function(me){
      if (generation !== state.meGeneration) return;
      state.me = me;
      if (state.publicData) renderCurrent();
    });
  }

  function changePage(nextPage){
    if (nextPage < 1 || nextPage > 20 || nextPage === state.page) return;
    state.page = nextPage;
    writeRoute(true);
    load();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_err){}
  }

  function bind(){
    nodes.periodButtons.forEach(function(button){ button.addEventListener('click', function(){
      var period = button.dataset.period;
      if (PERIODS.indexOf(period) < 0 || period === state.period) return;
      state.period = period;
      state.page = 1;
      writeRoute(true);
      load();
    }); });
    nodes.previous.addEventListener('click', function(){ changePage(state.page - 1); });
    nodes.next.addEventListener('click', function(){ changePage(state.page + 1); });
    nodes.retry.addEventListener('click', load);
    window.addEventListener('popstate', function(){ readRoute(); load(); });
    document.addEventListener('langchange', renderCurrent);
    try {
      if (window.SupabaseAuth && typeof window.SupabaseAuth.onAuthChange === 'function') window.SupabaseAuth.onAuthChange(function(){ refreshMe().catch(function(){}); });
    } catch (_err){}
  }

  function boot(){
    if (state.booted) return;
    nodes = {
      periodButtons: Array.from(document.querySelectorAll('.leaderboard-period')),
      reset: document.getElementById('leaderboardReset'),
      live: document.getElementById('leaderboardLive'),
      loading: document.getElementById('leaderboardLoading'),
      state: document.getElementById('leaderboardState'),
      stateTitle: document.getElementById('leaderboardStateTitle'),
      stateText: document.getElementById('leaderboardStateText'),
      retry: document.getElementById('leaderboardRetry'),
      results: document.getElementById('leaderboardResults'),
      pageEmpty: document.getElementById('leaderboardPageEmpty'),
      pageEmptyTitle: document.getElementById('leaderboardPageEmptyTitle'),
      pageEmptyText: document.getElementById('leaderboardPageEmptyText'),
      podium: document.getElementById('leaderboardPodium'),
      tableHead: document.getElementById('leaderboardTableHead'),
      list: document.getElementById('leaderboardList'),
      me: document.getElementById('leaderboardMe'),
      meRow: document.getElementById('leaderboardMeRow'),
      previous: document.getElementById('leaderboardPrevious'),
      next: document.getElementById('leaderboardNext'),
      pageNumber: document.getElementById('leaderboardPageNumber')
    };
    if (!nodes.results || !nodes.periodButtons.length) return;
    state.booted = true;
    readRoute();
    writeRoute(false);
    bind();
    load();
  }

  window.LeaderboardPage = { boot: boot, normalizeRow: normalizeRow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
