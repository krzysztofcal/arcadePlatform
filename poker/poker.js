(function(){
  if (typeof window === 'undefined') return;

  var LIST_URL = '/.netlify/functions/poker-list-tables';
  var CREATE_URL = '/.netlify/functions/poker-create-table';
  var QUICK_SEAT_URL = '/.netlify/functions/poker-quick-seat';
  var GET_URL = '/.netlify/functions/poker-get-table';
  var JOIN_URL = '/.netlify/functions/poker-join';
  var LEAVE_URL = '/.netlify/functions/poker-leave';
  var HEARTBEAT_URL = '/.netlify/functions/poker-heartbeat';
  var START_HAND_URL = '/.netlify/functions/poker-start-hand';
  var ACT_URL = '/.netlify/functions/poker-act';
  var EXPORT_LOG_URL = '/.netlify/functions/poker-export-log';
  var POLL_INTERVAL_BASE = 2000;
  var POLL_INTERVAL_MAX = 10000;
  var HEARTBEAT_INTERVAL_MS = 20000;
  var PENDING_RETRY_DELAYS = [150, 300, 600, 900];
  var PENDING_RETRY_BUDGET_MS = 2000;
  var UI_VERSION = '2025-02-19';

  var state = { token: null, polling: false, pollTimer: null, pollInterval: POLL_INTERVAL_BASE, pollErrors: 0 };

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function getAuthBridge(){
    if (window.SupabaseAuthBridge && typeof window.SupabaseAuthBridge.getAccessToken === 'function'){
      return window.SupabaseAuthBridge;
    }
    try {
      if (window.parent && window.parent !== window && window.parent.SupabaseAuthBridge && typeof window.parent.SupabaseAuthBridge.getAccessToken === 'function'){
        return window.parent.SupabaseAuthBridge;
      }
    } catch (_err){}
    try {
      if (window.opener && window.opener.SupabaseAuthBridge && typeof window.opener.SupabaseAuthBridge.getAccessToken === 'function'){
        return window.opener.SupabaseAuthBridge;
      }
    } catch (_err2){}
    return null;
  }

  async function getAccessToken(){
    var bridge = getAuthBridge();
    if (!bridge) return null;
    try {
      return await bridge.getAccessToken();
    } catch (_err){
      return null;
    }
  }

  function getSignInBridge(){
    if (window.SupabaseAuthBridge) return window.SupabaseAuthBridge;
    try {
      if (window.parent && window.parent !== window && window.parent.SupabaseAuthBridge){
        return window.parent.SupabaseAuthBridge;
      }
    } catch (_err){}
    try {
      if (window.opener && window.opener.SupabaseAuthBridge){
        return window.opener.SupabaseAuthBridge;
      }
    } catch (_err2){}
    return null;
  }

  function openSignIn(){
    var bridge = getSignInBridge();
    if (bridge){
      var methods = ['signIn', 'openSignIn', 'showAuth', 'startLogin'];
      for (var i = 0; i < methods.length; i++){
        var name = methods[i];
        if (typeof bridge[name] === 'function'){
          try {
            bridge[name]();
            return;
          } catch (_err){
            break;
          }
        }
      }
    }
    window.location.href = '/index.html';
  }

  async function authedFetch(url, options){
    var token = await getAccessToken();
    if (!token){
      var err = new Error('not_authenticated');
      err.code = 'not_authenticated';
      throw err;
    }
    state.token = token;
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    headers.Authorization = 'Bearer ' + token;
    if (opts.body && !headers['Content-Type']){
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  async function parseResponse(res){
    var body = {};
    try { body = await res.json(); } catch (_err){}
    if (res.ok) return body;
    var err = new Error(body.error || 'request_failed');
    err.status = res.status;
    err.code = body.error || 'request_failed';
    throw err;
  }

  function isAuthError(err){
    return !!(err && (err.code === 'not_authenticated' || err.status === 401));
  }

  function handleAuthExpired(opts){
    if (!opts) return;
    if (typeof opts.stopPolling === 'function'){
      opts.stopPolling();
    }
    if (typeof opts.stopHeartbeat === 'function'){
      opts.stopHeartbeat();
    }
    if (opts.authMsg) opts.authMsg.hidden = false;
    if (opts.content) opts.content.hidden = true;
    if (opts.errorEl){
      setError(opts.errorEl, t('pokerAuthExpired', 'Session expired. Please sign in again.'));
    }
    if (typeof opts.onAuthExpired === 'function'){
      opts.onAuthExpired();
    }
  }

  async function apiGet(url){
    var res = await authedFetch(url, { method: 'GET' });
    return await parseResponse(res);
  }

  async function apiPost(url, data){
    var res = await authedFetch(url, { method: 'POST', body: JSON.stringify(data || {}) });
    return await parseResponse(res);
  }

  function shortId(id){
    if (!id || typeof id !== 'string') return '';
    return id.substring(0, 8);
  }

  function isPlainObject(value){
    return !!(value && typeof value === 'object' && !Array.isArray(value));
  }

  function formatChips(amount){
    if (amount == null) return '—';
    var num = typeof amount === 'number' ? amount : parseInt(amount, 10);
    if (!isFinite(num)) return '—';
    num = Math.trunc(num);
    if (num < 0) return '—';
    return String(num);
  }

  function getStakesUiHelper(){
    if (window.PokerStakesUi && typeof window.PokerStakesUi.format === 'function'){
      return window.PokerStakesUi;
    }
    return null;
  }

  function parseStakesUi(stakes){
    var helper = getStakesUiHelper();
    if (helper && typeof helper.parse === 'function') return helper.parse(stakes);
    if (!stakes || typeof stakes !== 'object' || Array.isArray(stakes)) return null;
    var sb = parseInt(stakes.sb, 10);
    var bb = parseInt(stakes.bb, 10);
    if (!isFinite(sb) || !isFinite(bb)) return null;
    if (Math.floor(sb) !== sb || Math.floor(bb) !== bb) return null;
    if (sb < 0 || bb <= 0 || sb >= bb) return null;
    return { sb: sb, bb: bb };
  }

  function formatStakesUi(stakes){
    var helper = getStakesUiHelper();
    if (helper && typeof helper.format === 'function') return helper.format(stakes);
    var parsed = parseStakesUi(stakes);
    if (!parsed) return '—';
    return parsed.sb + '/' + parsed.bb;
  }

  function toFiniteOrNull(value){
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (Math.floor(n) !== n) return null;
    if (n < 0) return null;
    return n;
  }

  function normalizeDeadlineMs(deadline){
    if (deadline == null) return null;
    var num = Number(deadline);
    if (!isFinite(num) || num <= 0) return null;
    if (num < 5e10){
      return num * 1000;
    }
    return num;
  }

  function computeRemainingTurnSeconds(deadline, nowMs){
    var deadlineMs = normalizeDeadlineMs(deadline);
    if (!deadlineMs) return 0;
    var now = Number(nowMs);
    if (!isFinite(now)) now = Date.now();
    return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
  }

  function getConstraintsFromResponse(data){
    if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints;
    var gameState = data && data.state && data.state.state;
    if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints;
    return null;
  }

  function getLegalActionsFromResponse(data){
    if (data && Array.isArray(data.legalActions)) return data.legalActions;
    var gameState = data && data.state && data.state.state;
    if (gameState && Array.isArray(gameState.legalActions)) return gameState.legalActions;
    return [];
  }

  function getSafeConstraints(data){
    var constraints = getConstraintsFromResponse(data);
    return {
      toCall: toFiniteOrNull(constraints ? constraints.toCall : null),
      minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null),
      maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null),
      maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null)
    };
  }

  function getSeatDisplayName(seat){
    if (!seat) return '';
    return seat.displayName || seat.name || seat.username || seat.userName || seat.handle || '';
  }

  function buildPlayersById(seats){
    var map = {};
    if (!Array.isArray(seats)) return map;
    seats.forEach(function(seat){
      if (!seat || !seat.userId) return;
      var uid = typeof seat.userId === 'string' ? seat.userId.trim() : '';
      if (!uid) return;
      var name = getSeatDisplayName(seat);
      if (name) map[uid] = name;
    });
    return map;
  }

  function shouldShowTurnActions(params){
    var phaseValue = params && params.phase;
    var phase = typeof phaseValue === 'string' ? phaseValue.trim().toUpperCase() : '';
    var isActionPhase = phase === 'PREFLOP' || phase === 'FLOP' || phase === 'TURN' || phase === 'RIVER';
    if (!isActionPhase) return false;
    var turnUserId = params && typeof params.turnUserId === 'string' ? params.turnUserId.trim() : '';
    var currentUserId = params && typeof params.currentUserId === 'string' ? params.currentUserId.trim() : '';
    if (!turnUserId || !currentUserId || turnUserId !== currentUserId) return false;
    return Array.isArray(params.legalActions) && params.legalActions.length > 0;
  }

  if (window.__RUNNING_POKER_UI_TESTS__ === true){
    window.__POKER_UI_TEST_HOOKS__ = {
      normalizeDeadlineMs: normalizeDeadlineMs,
      computeRemainingTurnSeconds: computeRemainingTurnSeconds,
      shouldShowTurnActions: shouldShowTurnActions,
      getConstraintsFromResponse: getConstraintsFromResponse,
      getLegalActionsFromResponse: getLegalActionsFromResponse
    };
  }

  function resolveUserLabel(entry, playersById){
    var userId = null;
    if (typeof entry === 'string'){
      userId = entry.trim();
    } else if (entry && typeof entry === 'object'){
      userId = entry.userId || entry.id || entry.uid;
    }
    if (typeof userId !== 'string'){
      userId = null;
    } else {
      userId = userId.trim();
    }
    if (!userId) return t('pokerUnknownUser', 'Unknown');
    if (playersById && playersById[userId]) return playersById[userId];
    var short = shortId(userId);
    return short || t('pokerUnknownUser', 'Unknown');
  }

  function formatWinnerList(winners, playersById){
    if (!Array.isArray(winners) || winners.length === 0) return '—';
    var labels = winners.map(function(winner){
      return resolveUserLabel(winner, playersById);
    }).filter(function(label){ return !!label; });
    return labels.length ? labels.join(', ') : '—';
  }

  function generateRequestId(){
    return 'ui-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
  }

  function getValidRequestId(value){
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed === '[object PointerEvent]') return null;
    if (trimmed.length > 200) return null;
    return trimmed;
  }

  function normalizeRequestId(value){
    var trimmed = getValidRequestId(value);
    return trimmed || String(generateRequestId());
  }

  function resolveRequestId(pendingValue, overrideValue){
    var override = getValidRequestId(overrideValue);
    if (override) return { requestId: override, nextPending: null };
    var pending = getValidRequestId(pendingValue);
    if (pending) return { requestId: pending, nextPending: pending };
    var generated = normalizeRequestId(generateRequestId());
    return { requestId: generated, nextPending: generated };
  }

  function t(key, fallback){
    if (window.I18N && typeof window.I18N.t === 'function'){
      var val = window.I18N.t(key);
      if (val) return val;
    }
    return fallback || key;
  }

  function decodeBase64Url(str){
    var base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    var pad = base64.length % 4;
    if (pad){ base64 += '===='.substring(pad); }
    return atob(base64);
  }

  function decodeJwtPayload(token){
    if (!token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length < 2) return null;
    try {
      var decoded = decodeBase64Url(parts[1]);
      return JSON.parse(decoded);
    } catch (_err){
      return null;
    }
  }

  function getUserIdFromToken(token){
    var payload = decodeJwtPayload(token);
    return payload && payload.sub ? payload.sub : null;
  }

  function setError(el, msg){
    if (!el) return;
    if (msg){
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function setInlineStatus(el, msg, tone){
    if (!el) return;
    if (msg){
      el.textContent = msg;
      el.hidden = false;
      el.classList.remove('poker-inline-status--error', 'poker-inline-status--success');
      if (tone === 'error') el.classList.add('poker-inline-status--error');
      if (tone === 'success') el.classList.add('poker-inline-status--success');
    } else {
      el.textContent = '';
      el.hidden = true;
      el.classList.remove('poker-inline-status--error', 'poker-inline-status--success');
    }
  }

  function setLoading(el, loading){
    if (!el) return;
    el.disabled = loading;
  }

  function setDisabled(el, disabled){
    if (!el) return;
    el.disabled = !!disabled;
  }

  function renderPhaseLabel(state){
    var phaseLabelEl = document.getElementById('pokerPhaseLabel');
    if (!phaseLabelEl) return;
    var phase = state && typeof state.phase === 'string' && state.phase ? state.phase : 'UNKNOWN';
    phaseLabelEl.textContent = 'Phase: ' + phase;
  }

  function getSuitSymbol(suit){
    var key = typeof suit === 'string' ? suit.toUpperCase() : '';
    if (key === 'S') return '♠';
    if (key === 'H') return '♥';
    if (key === 'D') return '♦';
    if (key === 'C') return '♣';
    return '?';
  }

  function formatRank(r){
    if (r == null) return '?';
    if (typeof r === 'string'){
      var upper = r.toUpperCase();
      if (upper === 'A' || upper === 'K' || upper === 'Q' || upper === 'J') return upper;
    }
    var n = Number(r);
    if (!Number.isFinite(n)) return String(r) || '?';
    n = Math.trunc(n);
    if (n === 14) return 'A';
    if (n === 13) return 'K';
    if (n === 12) return 'Q';
    if (n === 11) return 'J';
    if (n >= 2 && n <= 10) return String(n);
    return '?';
  }

  function isRedSuit(suit){
    var key = typeof suit === 'string' ? suit.toUpperCase() : '';
    return key === 'H' || key === 'D';
  }

  function buildCardElement(card){
    var rank = formatRank(card && card.r != null ? card.r : null);
    var suitKey = card && card.s != null ? String(card.s).toUpperCase() : '';
    var suit = getSuitSymbol(suitKey);
    var cardEl = document.createElement('div');
    cardEl.className = 'poker-card' + (isRedSuit(suitKey) ? ' poker-card--red' : '');
    var rankEl = document.createElement('span');
    rankEl.className = 'poker-card__rank';
    rankEl.textContent = rank;
    var suitEl = document.createElement('span');
    suitEl.className = 'poker-card__suit';
    suitEl.textContent = suit;
    cardEl.appendChild(rankEl);
    cardEl.appendChild(suitEl);
    return cardEl;
  }

  function renderCommunityBoard(state){
    var boardEl = document.getElementById('pokerBoard');
    if (!boardEl) return;
    var cards = state && Array.isArray(state.community) ? state.community.slice(0, 5) : [];
    boardEl.innerHTML = '';
    for (var i = 0; i < cards.length; i++){
      var card = cards[i] || {};
      boardEl.appendChild(buildCardElement(card));
    }
  }

  function renderShowdownPanel(opts){
    var panel = document.getElementById('showdownPanel');
    if (!panel) return;
    var winnersEl = document.getElementById('showdownWinners');
    var potsEl = document.getElementById('showdownPots');
    var totalEl = document.getElementById('showdownTotal');
    var totalRowEl = document.getElementById('showdownTotalRow');
    var metaEl = document.getElementById('showdownMeta');
    var viewState = opts && opts.state ? opts.state : {};
    var playersById = opts && opts.playersById ? opts.playersById : {};
    var showdown = viewState && isPlainObject(viewState.showdown) ? viewState.showdown : null;
    var shouldShow = !!showdown;
    if (!shouldShow){
      panel.hidden = true;
      if (winnersEl) winnersEl.textContent = '';
      if (potsEl) potsEl.textContent = '';
      if (totalEl) totalEl.textContent = '';
      if (totalRowEl) totalRowEl.hidden = true;
      if (metaEl) metaEl.hidden = true;
      if (metaEl) metaEl.textContent = '';
      return;
    }
    panel.hidden = false;

    if (winnersEl){
      winnersEl.textContent = '';
      var winners = showdown && Array.isArray(showdown.winners) ? showdown.winners : [];
      if (!winners.length){
        winnersEl.textContent = t('pokerShowdownNoWinners', 'No winners');
      } else {
        var winnersList = document.createElement('div');
        winnersList.className = 'poker-showdown-list';
        winners.forEach(function(winner){
          var row = document.createElement('div');
          row.className = 'poker-showdown-row';
          row.textContent = resolveUserLabel(winner, playersById);
          winnersList.appendChild(row);
        });
        winnersEl.appendChild(winnersList);
      }
    }

    if (potsEl){
      potsEl.textContent = '';
      var pots = showdown && Array.isArray(showdown.potsAwarded) ? showdown.potsAwarded : [];
      if (!pots.length){
        potsEl.textContent = t('pokerShowdownNoPots', 'No pot award data');
      } else {
        var potList = document.createElement('div');
        potList.className = 'poker-showdown-list';
        pots.forEach(function(pot, idx){
          var row = document.createElement('div');
          row.className = 'poker-showdown-row';
          var amount = formatChips(pot && pot.amount != null ? pot.amount : null);
          var winnersLabel = formatWinnerList(pot && pot.winners ? pot.winners : [], playersById);
          row.textContent = t('pokerShowdownPotPrefix', 'Pot #') + (idx + 1) + ': ' + amount + ' \u2192 ' + winnersLabel;
          potList.appendChild(row);
        });
        potsEl.appendChild(potList);
      }
    }

    var totalAmount = showdown && showdown.potAwardedTotal != null ? showdown.potAwardedTotal : (showdown && showdown.potAwarded != null ? showdown.potAwarded : null);
    if (totalRowEl){
      if (totalAmount == null){
        totalRowEl.hidden = true;
      } else {
        totalRowEl.hidden = false;
      }
    }
    if (totalEl){
      totalEl.textContent = totalAmount == null ? '—' : formatChips(totalAmount);
    }

    if (metaEl){
      metaEl.textContent = '';
      var metaLines = [];
      if (showdown && showdown.handId) metaLines.push(t('pokerShowdownHandId', 'Hand ID') + ': ' + showdown.handId);
      if (showdown && showdown.awardedAt) metaLines.push(t('pokerShowdownAwardedAt', 'Awarded') + ': ' + showdown.awardedAt);
      if (showdown && showdown.reason) metaLines.push(t('pokerShowdownReason', 'Reason') + ': ' + showdown.reason);
      if (metaLines.length){
        metaLines.forEach(function(line){
          var row = document.createElement('div');
          row.textContent = line;
          metaEl.appendChild(row);
        });
        metaEl.hidden = false;
      } else {
        metaEl.hidden = true;
      }
    }
  }

  function isPendingResponse(data){
    return !!(data && data.pending);
  }

  function isAbortError(err){
    return !!(err && (err.name === 'AbortError' || err.code === 'abort' || err.code === 'aborted'));
  }

  function isPageActive(){
    return document.visibilityState !== 'hidden';
  }

  function scheduleRetry(fn, delayMs){
    if (typeof fn !== 'function') return;
    var delay = typeof delayMs === 'number' ? delayMs : 600;
    return setTimeout(function(){
      fn();
    }, delay);
  }

  function getPendingDelay(retries){
    var idx = Math.max(0, retries - 1);
    if (idx >= PENDING_RETRY_DELAYS.length) return PENDING_RETRY_DELAYS[PENDING_RETRY_DELAYS.length - 1];
    return PENDING_RETRY_DELAYS[idx];
  }

  function shouldRetryPending(startedAt, delayMs){
    if (!startedAt) return true;
    var elapsed = Date.now() - startedAt;
    return elapsed + delayMs <= PENDING_RETRY_BUDGET_MS;
  }

  function persistLastError(payload){
    if (!payload) return;
    try {
      localStorage.setItem('poker:lastError', JSON.stringify(payload));
    } catch (_err){}
  }

  // ========== LOBBY PAGE ==========
  function initLobby(){
    var errorEl = document.getElementById('pokerError');
    var authMsg = document.getElementById('pokerAuthMsg');
    var lobbyContent = document.getElementById('pokerLobbyContent');
    var tableList = document.getElementById('pokerTableList');
    var refreshBtn = document.getElementById('pokerRefresh');
    var quickSeatBtn = document.getElementById('pokerQuickSeat');
    var createBtn = document.getElementById('pokerCreate');
    var sbInput = document.getElementById('pokerSb');
    var bbInput = document.getElementById('pokerBb');
    var maxPlayersInput = document.getElementById('pokerMaxPlayers');
    var signInBtn = document.getElementById('pokerSignIn');

    var authTimer = null;

    function stopAuthWatch(){
      if (authTimer){
        clearInterval(authTimer);
        authTimer = null;
      }
    }

    function startAuthWatch(){
      if (authTimer) return;
      authTimer = setInterval(function(){
        checkAuth().then(function(authed){
          if (authed){
            stopAuthWatch();
            loadTables();
          }
        });
      }, 3000);
    }

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        if (authMsg) authMsg.hidden = false;
        if (lobbyContent) lobbyContent.hidden = true;
        startAuthWatch();
        return false;
      }
      if (authMsg) authMsg.hidden = true;
      if (lobbyContent) lobbyContent.hidden = false;
      stopAuthWatch();
      return true;
    }

    async function loadTables(){
      setError(errorEl, null);
      if (tableList) tableList.innerHTML = '<div class="poker-loading">' + t('loading', 'Loading...') + '</div>';
      try {
        var data = await apiGet(LIST_URL + '?status=OPEN&limit=20');
        renderTables(data.tables || []);
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            onAuthExpired: startAuthWatch
          });
          if (tableList) tableList.innerHTML = '';
          return;
        }
        klog('poker_lobby_load_error', { error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrLoadTables', 'Failed to load tables'));
        if (tableList) tableList.innerHTML = '';
      }
    }

    function renderTables(tables){
      if (!tableList) return;
      if (!tables || tables.length === 0){
        tableList.innerHTML = '<div class="poker-loading">' + t('noOpenTables', 'No open tables') + '</div>';
        return;
      }
      tableList.innerHTML = '';
      tables.forEach(function(tbl){
        var row = document.createElement('div');
        row.className = 'poker-table-row';
        var stakes = tbl.stakes;
        var maxPlayers = tbl.maxPlayers != null ? tbl.maxPlayers : 6;
        var seatCount = tbl.seatCount != null ? tbl.seatCount : 0;
        var tid = document.createElement('span');
        tid.className = 'tid';
        tid.textContent = shortId(tbl.id);
        var stakesEl = document.createElement('span');
        stakesEl.className = 'stakes';
        stakesEl.textContent = formatStakesUi(stakes);
        var seatsEl = document.createElement('span');
        seatsEl.className = 'seats';
        seatsEl.textContent = seatCount + '/' + maxPlayers;
        var statusEl = document.createElement('span');
        statusEl.className = 'status';
        statusEl.textContent = tbl.status || 'OPEN';
        var openBtn = document.createElement('button');
        openBtn.className = 'poker-btn';
        openBtn.dataset.open = tbl.id;
        openBtn.textContent = t('open', 'Open');
        row.appendChild(tid);
        row.appendChild(stakesEl);
        row.appendChild(seatsEl);
        row.appendChild(statusEl);
        row.appendChild(openBtn);
        tableList.appendChild(row);
      });
    }


    async function quickSeat(){
      setError(errorEl, null);
      var sb = parseInt(sbInput ? sbInput.value : 1, 10);
      var bb = parseInt(bbInput ? bbInput.value : 2, 10);
      var maxPlayers = parseInt(maxPlayersInput ? maxPlayersInput.value : 6, 10) || 6;
      var payload = { maxPlayers: maxPlayers };
      if (isFinite(sb) && isFinite(bb) && Math.floor(sb) === sb && Math.floor(bb) === bb && sb >= 0 && bb > 0 && sb < bb){
        payload.stakes = { sb: sb, bb: bb };
      }
      setLoading(quickSeatBtn, true);
      try {
        var data = await apiPost(QUICK_SEAT_URL, payload);
        if (data && data.ok === true && data.tableId){
          var nextUrl = '/poker/table.html?tableId=' + encodeURIComponent(data.tableId);
          if (data.seatNo != null){
            nextUrl += '&seatNo=' + encodeURIComponent(data.seatNo);
          }
          nextUrl += '&autoJoin=1';
          window.location.href = nextUrl;
          return;
        }
        setError(errorEl, t('pokerErrNoTableId', 'Table created but no ID returned'));
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        klog('poker_quick_seat_error', { error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrJoin', 'Failed to join table'));
      } finally {
        setLoading(quickSeatBtn, false);
      }
    }
    async function createTable(){
      setError(errorEl, null);
      var sbRaw = sbInput ? sbInput.value : 1;
      var bbRaw = bbInput ? bbInput.value : 2;
      var sb = parseInt(sbRaw, 10);
      var bb = parseInt(bbRaw, 10);
      if (!isFinite(sb) || !isFinite(bb) || Math.floor(sb) !== sb || Math.floor(bb) !== bb || sb < 0 || bb <= 0 || sb >= bb){
        setError(errorEl, t('pokerErrInvalidStakes', 'Invalid stakes'));
        return;
      }
      var maxPlayers = parseInt(maxPlayersInput ? maxPlayersInput.value : 6, 10) || 6;
      setLoading(createBtn, true);
      try {
        var data = await apiPost(CREATE_URL, { stakes: { sb: sb, bb: bb }, maxPlayers: maxPlayers });
        if (data.tableId){
          window.location.href = '/poker/table.html?tableId=' + encodeURIComponent(data.tableId);
        } else {
          setError(errorEl, t('pokerErrNoTableId', 'Table created but no ID returned'));
        }
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        klog('poker_create_error', { error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrCreateTable', 'Failed to create table'));
      } finally {
        setLoading(createBtn, false);
      }
    }

    function handleClick(e){
      var target = e.target;
      if (target.dataset && target.dataset.open){
        window.location.href = '/poker/table.html?tableId=' + encodeURIComponent(target.dataset.open);
      }
    }

    if (refreshBtn){
      refreshBtn.addEventListener('click', function(){
        checkAuth().then(function(authed){
          if (authed){
            loadTables();
          }
        });
      });
    }
    if (quickSeatBtn){
      quickSeatBtn.addEventListener('click', quickSeat);
    }
    if (createBtn){
      createBtn.addEventListener('click', createTable);
    }
    if (tableList){
      tableList.addEventListener('click', handleClick);
    }
    if (signInBtn){
      signInBtn.addEventListener('click', openSignIn);
    }

    window.addEventListener('beforeunload', stopAuthWatch); // xp-lifecycle-allow:poker-lobby(2026-01-01)

    checkAuth().then(function(authed){
      if (authed) loadTables();
    });
  }

  // ========== TABLE PAGE ==========
  function initTable(){
    var params = new URLSearchParams(window.location.search);
    var tableId = params.get('tableId');
    if (!tableId){
      document.body.innerHTML = '<div class="poker-page"><p class="poker-error">' + t('pokerErrMissingTableId', 'No tableId provided') + '</p><a href="/poker/" class="poker-back">&larr; ' + t('backToLobby', 'Back to lobby') + '</a></div>';
      return;
    }

    var errorEl = document.getElementById('pokerError');
    var authMsg = document.getElementById('pokerAuthMsg');
    var tableContent = document.getElementById('pokerTableContent');
    var tableIdEl = document.getElementById('pokerTableId');
    var stakesEl = document.getElementById('pokerStakes');
    var statusEl = document.getElementById('pokerStatus');
    var seatsGrid = document.getElementById('pokerSeatsGrid');
    var turnTimerEl = document.getElementById('pokerTurnTimer');
    var joinBtn = document.getElementById('pokerJoin');
    var leaveBtn = document.getElementById('pokerLeave');
    var joinStatusEl = document.getElementById('pokerJoinStatus');
    var leaveStatusEl = document.getElementById('pokerLeaveStatus');
    var seatNoInput = document.getElementById('pokerSeatNo');
    var buyInInput = document.getElementById('pokerBuyIn');
    var yourStackEl = document.getElementById('pokerYourStack');
    var potEl = document.getElementById('pokerPot');
    var phaseEl = document.getElementById('pokerPhase');
    var versionEl = document.getElementById('pokerVersion');
    var myCardsEl = document.getElementById('pokerMyCards');
    var myCardsStatusEl = document.getElementById('pokerMyCardsStatus');
    var jsonToggle = document.getElementById('pokerJsonToggle');
    var jsonBox = document.getElementById('pokerJsonBox');
    var signInBtn = document.getElementById('pokerSignIn');
    var startHandBtn = document.getElementById('pokerStartHandBtn');
    var startHandStatusEl = document.getElementById('pokerStartHandStatus');
    var actRow = document.getElementById('pokerActionsRow');
    var actAmountWrap = document.getElementById('pokerActAmountWrap');
    var actAmountInput = document.getElementById('pokerActAmount');
    var actAmountHintEl = null;
    var actCheckBtn = document.getElementById('pokerActCheckBtn');
    var actCallBtn = document.getElementById('pokerActCallBtn');
    var actFoldBtn = document.getElementById('pokerActFoldBtn');
    var actBetBtn = document.getElementById('pokerActBetBtn');
    var actRaiseBtn = document.getElementById('pokerActRaiseBtn');
    var actStatusEl = document.getElementById('pokerActStatus');
    var copyLogBtn = document.getElementById('pokerCopyLogBtn');
    var copyLogStatusEl = document.getElementById('pokerCopyLogStatus');
    var leaveSelector = '#pokerLeave';
    var joinSelector = '#pokerJoin';

    if (actAmountWrap && actAmountWrap.parentNode){
      actAmountHintEl = document.getElementById('pokerActAmountHint');
      if (!actAmountHintEl){
        actAmountHintEl = document.createElement('div');
        actAmountHintEl.id = 'pokerActAmountHint';
        actAmountHintEl.className = 'poker-act-hint';
        actAmountHintEl.hidden = true;
        actAmountWrap.parentNode.insertBefore(actAmountHintEl, actAmountWrap.nextSibling);
      }
    }

    var currentUserId = null;
    var tableData = null;
    var tableMaxPlayers = 6;
    var stakesValid = true;
    var devActionsEnabled = false;
    var authTimer = null;
    var heartbeatTimer = null;
    var heartbeatRequestId = null;
    var pendingJoinRequestId = null;
    var pendingJoinAutoSeat = false;
    var pendingLeaveRequestId = null;
    var pendingStartHandRequestId = null;
    var pendingActRequestId = null;
    var pendingActType = null;
    var pendingJoinRetries = 0;
    var pendingLeaveRetries = 0;
    var pendingStartHandRetries = 0;
    var pendingActRetries = 0;
    var pendingJoinStartedAt = null;
    var pendingLeaveStartedAt = null;
    var pendingStartHandStartedAt = null;
    var pendingActStartedAt = null;
    var pendingJoinTimer = null;
    var pendingLeaveTimer = null;
    var pendingStartHandTimer = null;
    var pendingActTimer = null;
    var joinPending = false;
    var leavePending = false;
    var startHandPending = false;
    var actPending = false;
    var copyLogPending = false;
    var pendingHiddenAt = null;
    var heartbeatPendingRetries = 0;
    var heartbeatInFlight = false;
    var isSeated = false;
    var suggestedSeatNoParam = parseInt(params.get('seatNo'), 10);
    var shouldAutoJoin = params.get('autoJoin') === '1';
    var shouldAutoStart = params.get('autoStart') === '1';
    var autoJoinAttempted = false;
    var autoStartLastAttemptAt = 0;
    var autoStartCooldownMs = 4000;
    var autoStartStopForHand = false;
    var lastAutoStartSeatCount = null;
    var turnTimerInterval = null;
    var HEARTBEAT_PENDING_MAX_RETRIES = 8;
    var realtimeSub = null;
    var realtimeDisabled = false;
    var realtimeUnavailableLogged = false;

    if (joinBtn){
      klog('poker_join_bind', { found: true, selector: joinSelector, page: 'table' });
    } else {
      klog('poker_join_bind', { found: false, selector: joinSelector, page: 'table' });
      klog('poker_join_bind_missing', { path: window.location.pathname });
    }

    if (leaveBtn){
      klog('poker_leave_bind', { found: true, selector: leaveSelector, page: 'table' });
    } else {
      klog('poker_leave_bind', { found: false, selector: leaveSelector, page: 'table' });
      klog('poker_leave_bind_missing', { path: window.location.pathname });
    }

    function stopAuthWatch(){
      if (authTimer){
        clearInterval(authTimer);
        authTimer = null;
      }
    }

    function startAuthWatch(){
      if (authTimer) return;
      authTimer = setInterval(function(){
        checkAuth().then(function(authed){
          if (authed){
            stopAuthWatch();
            loadTable(false);
            startPolling();
            try {
              startRealtime();
            } catch (_err){
              startPolling();
              loadTable(false);
            }
          }
        });
      }, 3000);
    }

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        currentUserId = null;
        isSeated = false;
        stopHeartbeat();
        stopRealtime();
        if (authMsg) authMsg.hidden = false;
        if (tableContent) tableContent.hidden = true;
        renderHoleCards(null);
        setDevActionsEnabled(false);
        setDevActionsAuthStatus(false);
        startAuthWatch();
        return false;
      }
      currentUserId = getUserIdFromToken(token);
      if (authMsg) authMsg.hidden = true;
      if (tableContent) tableContent.hidden = false;
      setDevActionsEnabled(true);
      setDevActionsAuthStatus(true);
      stopAuthWatch();
      startRealtime();
      return true;
    }

    function handleTableAuthExpired(opts){
      currentUserId = null;
      isSeated = false;
      stopHeartbeat();
      setDevActionsEnabled(false);
      setDevActionsAuthStatus(false);
      renderHoleCards(null);
      stopRealtime();
      handleAuthExpired(opts);
    }

    function updatePendingUi(){
      var busy = joinPending || leavePending;
      setLoading(joinBtn, busy);
      setLoading(leaveBtn, busy);
      if (seatNoInput) setDisabled(seatNoInput, busy);
      if (buyInInput) setDisabled(buyInInput, busy);
      if (joinStatusEl){
        joinStatusEl.textContent = joinPending ? t('pokerJoinPending', 'Joining...') : '';
        joinStatusEl.hidden = !joinPending;
      }
      if (leaveStatusEl){
        leaveStatusEl.textContent = leavePending ? t('pokerLeavePending', 'Leaving...') : '';
        leaveStatusEl.hidden = !leavePending;
      }
      updateDevActionsUi();
    }

    function shouldEnableDevActions(){
      return devActionsEnabled && !!tableId && !joinPending && !leavePending && !startHandPending && !actPending && !copyLogPending;
    }

    function toggleHidden(el, hidden){
      if (!el) return;
      el.hidden = !!hidden;
    }

    function normalizeActionType(value){
      if (typeof value !== 'string') return '';
      return value.trim().toUpperCase();
    }

    function isActionablePhase(phase){
      return phase === 'PREFLOP' || phase === 'FLOP' || phase === 'TURN' || phase === 'RIVER';
    }

    function resolvePhase(data, stateObj, state){
      var sources = [
        state && state.phase,
        stateObj && stateObj.phase,
        data && data.phase
      ];
      for (var i = 0; i < sources.length; i++){
        if (typeof sources[i] === 'string' && sources[i].trim()){
          return normalizeActionType(sources[i]);
        }
      }
      return null;
    }

    function addAllowedFromSource(source, allowed){
      if (!source) return false;
      var list = null;
      if (Array.isArray(source)){
        list = source;
      } else if (Array.isArray(source.actions)){
        list = source.actions;
      } else if (Array.isArray(source.allowedActions)){
        list = source.allowedActions;
      } else if (Array.isArray(source.availableActions)){
        list = source.availableActions;
      } else if (Array.isArray(source.legalActions)){
        list = source.legalActions;
      }
      if (!list) return false;
      for (var i = 0; i < list.length; i++){
        var entry = list[i];
        var type = '';
        if (typeof entry === 'string'){
          type = entry;
        } else if (entry && typeof entry.type === 'string'){
          type = entry.type;
        } else if (entry && typeof entry.actionType === 'string'){
          type = entry.actionType;
        } else if (entry && entry.action && typeof entry.action.type === 'string'){
          type = entry.action.type;
        }
        type = normalizeActionType(type);
        if (type) allowed.add(type);
      }
      return allowed.size > 0;
    }

    function resolveTurnUserId(data, state){
      if (!state) return null;
      var candidate = typeof state.turnUserId === 'string' && state.turnUserId.trim() ? state.turnUserId.trim() : null;
      if (!candidate && typeof state.toActUserId === 'string' && state.toActUserId.trim()){
        candidate = state.toActUserId.trim();
      }
      if (candidate) return candidate;
      var seatFields = ['turnSeatNo', 'toActSeatNo', 'currentSeatNo', 'actingSeatNo'];
      var seatNo = null;
      for (var i = 0; i < seatFields.length; i++){
        var value = state[seatFields[i]];
        if (typeof value === 'number' && isFinite(value)){
          seatNo = value;
          break;
        }
      }
      if (seatNo == null) return null;
      var seats = data && Array.isArray(data.seats) ? data.seats : [];
      for (var s = 0; s < seats.length; s++){
        var seat = seats[s];
        if (seat && seat.seatNo === seatNo && typeof seat.userId === 'string' && seat.userId.trim()){
          return seat.userId.trim();
        }
      }
      return null;
    }

    function getAllowedActionsForUser(data, userId){
      var info = { allowed: new Set(), needsAmount: false, phase: null, turnUserId: null, isUsersTurn: false, legalActions: [] };
      if (!data || !userId) return info;
      var stateObj = data && data.state ? data.state : null;
      var gameState = stateObj && stateObj.state ? stateObj.state : {};
      info.phase = resolvePhase(data, stateObj, gameState);
      info.turnUserId = resolveTurnUserId(data, gameState);
      info.isUsersTurn = !!(info.turnUserId && info.turnUserId === userId && isActionablePhase(info.phase));
      var allowed = info.allowed;
      var list = getLegalActionsFromResponse(data);
      info.legalActions = list;
      for (var i = 0; i < list.length; i++){
        var type = normalizeActionType(list[i]);
        if (type) allowed.add(type);
      }
      info.needsAmount = allowed.has('BET') || allowed.has('RAISE');
      return info;
    }

    function renderAllowedActionButtons(){
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      var allowed = allowedInfo.allowed;
      var enabled = shouldEnableDevActions();
      var hasActions = shouldShowTurnActions({
        phase: allowedInfo.phase,
        turnUserId: allowedInfo.turnUserId,
        currentUserId: currentUserId,
        legalActions: allowedInfo.legalActions
      });
      toggleHidden(actRow, !hasActions);
      toggleHidden(actAmountWrap, !hasActions || !allowedInfo.needsAmount);
      var actions = [
        { type: 'CHECK', el: actCheckBtn },
        { type: 'CALL', el: actCallBtn },
        { type: 'FOLD', el: actFoldBtn },
        { type: 'BET', el: actBetBtn },
        { type: 'RAISE', el: actRaiseBtn }
      ];
      for (var i = 0; i < actions.length; i++){
        var item = actions[i];
        var isAllowed = allowed.has(item.type);
        toggleHidden(item.el, !hasActions || !isAllowed);
        setDisabled(item.el, !enabled || actPending || !isAllowed);
      }
      if (actCallBtn){
        if (!actCallBtn.dataset.baseLabel){
          actCallBtn.dataset.baseLabel = actCallBtn.textContent || t('pokerActCall', 'CALL');
        }
        var baseLabel = actCallBtn.dataset.baseLabel || t('pokerActCall', 'CALL');
        var constraints = tableData && tableData._actionConstraints ? tableData._actionConstraints : null;
        var toCall = constraints ? toFiniteOrNull(constraints.toCall) : null;
        var callAllowed = allowed.has('CALL');
        if (callAllowed && toCall != null && toCall > 0){
          var callTemplate = t('pokerCallWithAmount', 'CALL ({amount})');
          actCallBtn.textContent = callTemplate.replace('{amount}', String(toCall));
        } else {
          actCallBtn.textContent = baseLabel;
        }
      }
      if (actAmountInput){
        setDisabled(actAmountInput, !enabled || actPending || !allowedInfo.needsAmount);
        updateActAmountConstraints(allowedInfo, pendingActType);
      }
      updateActAmountHint(allowedInfo, pendingActType);
      if (actStatusEl){
        if (allowedInfo.isUsersTurn && allowed.size === 0){
          setInlineStatus(actStatusEl, t('pokerContractMismatch', 'No legal actions computed. Client/server contract mismatch.'), 'error');
        } else if (!allowedInfo.isUsersTurn && isActionablePhase(allowedInfo.phase) && !!allowedInfo.turnUserId){
          setInlineStatus(actStatusEl, t('pokerWaitingForOpponent', 'Waiting for opponent'), null);
        } else if (actStatusEl.dataset.authRequired !== '1') {
          setInlineStatus(actStatusEl, null, null);
        }
      }
    }

    function updateActAmountConstraints(allowedInfo, selectedType){
      if (!actAmountInput) return;
      actAmountInput.removeAttribute('min');
      actAmountInput.removeAttribute('max');
      var constraints = tableData && tableData._actionConstraints ? tableData._actionConstraints : null;
      if (!constraints || !selectedType || !allowedInfo || !allowedInfo.allowed) return;
      var normalized = normalizeActionType(selectedType);
      if (!normalized) return;
      if (!allowedInfo.allowed.has(normalized)) return;
      if (normalized === 'RAISE'){
        if (constraints.minRaiseTo != null){
          actAmountInput.setAttribute('min', String(constraints.minRaiseTo));
        }
        if (constraints.maxRaiseTo != null){
          actAmountInput.setAttribute('max', String(constraints.maxRaiseTo));
        }
        return;
      }
      if (normalized === 'BET' && constraints.maxBetAmount != null){
        actAmountInput.setAttribute('max', String(constraints.maxBetAmount));
      }
    }

    function updateActAmountHint(allowedInfo, selectedType){
      if (!actAmountHintEl) return;
      if (!allowedInfo || !allowedInfo.needsAmount || !shouldEnableDevActions() || !selectedType){
        actAmountHintEl.textContent = '';
        actAmountHintEl.hidden = true;
        return;
      }
      var constraints = tableData && tableData._actionConstraints ? tableData._actionConstraints : null;
      var normalized = normalizeActionType(selectedType);
      if (!constraints || !normalized || !allowedInfo.allowed){
        actAmountHintEl.textContent = '';
        actAmountHintEl.hidden = true;
        return;
      }
      if (!allowedInfo.allowed.has(normalized)){
        actAmountHintEl.textContent = '';
        actAmountHintEl.hidden = true;
        return;
      }
      var hint = '';
      if (normalized === 'RAISE'){
        var minRaiseTo = toFiniteOrNull(constraints.minRaiseTo);
        var maxRaiseTo = toFiniteOrNull(constraints.maxRaiseTo);
        if (minRaiseTo != null && maxRaiseTo != null){
          var rangeTemplate = t('pokerRaiseRange', 'Raise-to range: {min}–{max}');
          hint = rangeTemplate.replace('{min}', String(minRaiseTo)).replace('{max}', String(maxRaiseTo));
        } else if (minRaiseTo != null){
          var minTemplate = t('pokerRaiseMin', 'Raise-to min: {min}');
          hint = minTemplate.replace('{min}', String(minRaiseTo));
        } else if (maxRaiseTo != null){
          var maxTemplate = t('pokerRaiseMax', 'Raise-to max: {max}');
          hint = maxTemplate.replace('{max}', String(maxRaiseTo));
        }
      } else if (normalized === 'BET'){
        var maxBetAmount = toFiniteOrNull(constraints.maxBetAmount);
        if (maxBetAmount != null){
          var betTemplate = t('pokerBetMax', 'Bet max: {max}');
          hint = betTemplate.replace('{max}', String(maxBetAmount));
        }
      }
      if (hint){
        actAmountHintEl.textContent = hint;
        actAmountHintEl.hidden = false;
      } else {
        actAmountHintEl.textContent = '';
        actAmountHintEl.hidden = true;
      }
    }

    function updateDevActionsUi(){
      var enabled = shouldEnableDevActions();
      setLoading(startHandBtn, startHandPending);
      setDisabled(startHandBtn, !enabled || startHandPending);
      setLoading(copyLogBtn, copyLogPending);
      setDisabled(copyLogBtn, !enabled || copyLogPending);
      toggleHidden(copyLogBtn, !devActionsEnabled);
      toggleHidden(copyLogStatusEl, !devActionsEnabled);
      renderAllowedActionButtons();
    }

    function setDevActionsEnabled(enabled){
      devActionsEnabled = !!enabled;
      if (!devActionsEnabled){
        clearStartHandPending();
        clearActPending();
        setInlineStatus(startHandStatusEl, null, null);
        setInlineStatus(actStatusEl, null, null);
        setInlineStatus(copyLogStatusEl, null, null);
        copyLogPending = false;
      }
      updateDevActionsUi();
    }

    function setDevActionsAuthStatus(authed){
      var message = authed ? null : t('pokerDevActionsSignIn', 'Sign in to use Dev Actions');
      if (actStatusEl){
        actStatusEl.dataset.authRequired = authed ? '' : '1';
      }
      setInlineStatus(startHandStatusEl, message, null);
      setInlineStatus(actStatusEl, message, null);
      setInlineStatus(copyLogStatusEl, message, null);
      renderAllowedActionButtons();
    }

    function setPendingState(action, isPending){
      if (action === 'join'){
        joinPending = isPending;
      } else if (action === 'leave'){
        leavePending = isPending;
      }
      updatePendingUi();
    }

    function setDevPendingState(action, isPending){
      if (action === 'startHand'){
        startHandPending = isPending;
        if (startHandStatusEl){
          setInlineStatus(startHandStatusEl, isPending ? t('pokerStartHandPending', 'Starting...') : null, null);
        }
      } else if (action === 'act'){
        actPending = isPending;
        if (actStatusEl){
          setInlineStatus(actStatusEl, isPending ? t('pokerActPending', 'Sending...') : null, null);
        }
      } else if (action === 'copyLog'){
        copyLogPending = isPending;
        if (copyLogStatusEl){
          setInlineStatus(copyLogStatusEl, isPending ? t('pokerCopyLogPending', 'Copying...') : null, null);
        }
      }
      updateDevActionsUi();
    }

    function clearJoinPending(){
      pendingJoinRequestId = null;
      pendingJoinRetries = 0;
      pendingJoinStartedAt = null;
      if (pendingJoinTimer){
        clearTimeout(pendingJoinTimer);
        pendingJoinTimer = null;
      }
      setPendingState('join', false);
    }

    function clearLeavePending(){
      pendingLeaveRequestId = null;
      pendingLeaveRetries = 0;
      pendingLeaveStartedAt = null;
      if (pendingLeaveTimer){
        clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = null;
      }
      setPendingState('leave', false);
    }

    function clearStartHandPending(){
      pendingStartHandRequestId = null;
      pendingStartHandRetries = 0;
      pendingStartHandStartedAt = null;
      if (pendingStartHandTimer){
        clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = null;
      }
      setDevPendingState('startHand', false);
    }

    function clearActPending(){
      pendingActRequestId = null;
      pendingActType = null;
      pendingActRetries = 0;
      pendingActStartedAt = null;
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
      setDevPendingState('act', false);
    }

    function clearCopyLogPending(){
      setDevPendingState('copyLog', false);
    }

    function handlePendingTimeout(action){
      var message = action === 'join' ? t('pokerErrJoinPending', 'Join still pending. Please try again.') : t('pokerErrLeavePending', 'Leave still pending. Please try again.');
      var endpoint = action === 'join' ? JOIN_URL : LEAVE_URL;
      var retries = action === 'join' ? pendingJoinRetries : pendingLeaveRetries;
      klog('poker_pending_timeout', { action: action, tableId: tableId, retries: retries, budgetMs: PENDING_RETRY_BUDGET_MS });
      if (action === 'join'){
        clearJoinPending();
      } else {
        clearLeavePending();
      }
      setActionError(action, endpoint, 'pending_timeout', message);
    }

    function schedulePendingRetry(action, retryFn){
      if (!isPageActive()) return;
      setPendingState(action, true);
      var startedAt = action === 'join' ? pendingJoinStartedAt : pendingLeaveStartedAt;
      var retries = action === 'join' ? pendingJoinRetries : pendingLeaveRetries;
      if (!startedAt) startedAt = Date.now();
      retries += 1;
      var delay = getPendingDelay(retries);
      if (!shouldRetryPending(startedAt, delay)){
        handlePendingTimeout(action);
        return;
      }
      if (action === 'join'){
        pendingJoinStartedAt = startedAt;
        pendingJoinRetries = retries;
        if (pendingJoinTimer) clearTimeout(pendingJoinTimer);
        pendingJoinTimer = scheduleRetry(retryFn, delay);
      } else {
        pendingLeaveStartedAt = startedAt;
        pendingLeaveRetries = retries;
        if (pendingLeaveTimer) clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = scheduleRetry(retryFn, delay);
      }
    }

    function handleDevPendingTimeout(action){
      var message = action === 'startHand' ? t('pokerErrStartHandPending', 'Start hand still pending. Please try again.') : t('pokerErrActPending', 'Action still pending. Please try again.');
      var statusEl = action === 'startHand' ? startHandStatusEl : actStatusEl;
      if (action === 'startHand'){
        clearStartHandPending();
      } else {
        clearActPending();
      }
      setInlineStatus(statusEl, message, 'error');
    }

    function scheduleDevPendingRetry(action, retryFn){
      if (!isPageActive()) return;
      setDevPendingState(action, true);
      var startedAt = action === 'startHand' ? pendingStartHandStartedAt : pendingActStartedAt;
      var retries = action === 'startHand' ? pendingStartHandRetries : pendingActRetries;
      if (!startedAt) startedAt = Date.now();
      retries += 1;
      var delay = getPendingDelay(retries);
      if (!shouldRetryPending(startedAt, delay)){
        handleDevPendingTimeout(action);
        return;
      }
      if (action === 'startHand'){
        pendingStartHandStartedAt = startedAt;
        pendingStartHandRetries = retries;
        if (pendingStartHandTimer) clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = scheduleRetry(retryFn, delay);
      } else {
        pendingActStartedAt = startedAt;
        pendingActRetries = retries;
        if (pendingActTimer) clearTimeout(pendingActTimer);
        pendingActTimer = scheduleRetry(retryFn, delay);
      }
    }

    function stopPendingRetries(){
      if (pendingJoinTimer){
        clearTimeout(pendingJoinTimer);
        pendingJoinTimer = null;
      }
      if (pendingLeaveTimer){
        clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = null;
      }
      if (pendingStartHandTimer){
        clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = null;
      }
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
    }

    // stopPendingAll cancels pending operations (clears request ids) — used for unload and auth expiry.
    function stopPendingAll(){
      clearJoinPending();
      clearLeavePending();
      clearStartHandPending();
      clearActPending();
      clearCopyLogPending();
    }

    function pauseJoinPending(){
      if (pendingJoinTimer){
        clearTimeout(pendingJoinTimer);
        pendingJoinTimer = null;
      }
      setPendingState('join', false);
    }

    function pauseLeavePending(){
      if (pendingLeaveTimer){
        clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = null;
      }
      setPendingState('leave', false);
    }

    function pauseStartHandPending(){
      if (pendingStartHandTimer){
        clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = null;
      }
      setDevPendingState('startHand', false);
    }

    function pauseActPending(){
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
      setDevPendingState('act', false);
    }

    function setActionError(action, endpoint, code, message){
      if (!message) return;
      setError(errorEl, message);
      persistLastError({
        ts: Date.now(),
        action: action,
        endpoint: endpoint,
        code: code || 'unknown_error',
        message: message
      });
    }

    function isSeatTakenError(err){
      var code = err && (err.code || err.error || err.message);
      return code === 'seat_taken' || code === 'duplicate_seat' || code === 'conflict' || code === '23505';
    }

    function isNeutralAutoStartCode(code){
      return code === 'not_enough_players' || code === 'already_in_hand' || code === 'state_conflict';
    }

    function getPreferredSeatNo(preferredSeatNoOverride){
      var maxUi = Number.isInteger(tableMaxPlayers) && tableMaxPlayers >= 2 ? tableMaxPlayers - 1 : 0;
      var preferredSeatNo = 0;
      if (Number.isInteger(preferredSeatNoOverride)){
        preferredSeatNo = preferredSeatNoOverride;
      } else if (Number.isInteger(suggestedSeatNoParam)){
        preferredSeatNo = suggestedSeatNoParam;
      } else {
        var inputSeatNo = parseInt(seatNoInput ? seatNoInput.value : 0, 10);
        preferredSeatNo = isNaN(inputSeatNo) ? 0 : inputSeatNo;
      }
      if (preferredSeatNo < 0) preferredSeatNo = 0;
      if (preferredSeatNo > maxUi) preferredSeatNo = maxUi;
      return preferredSeatNo;
    }

    function getSeatedCount(data){
      var seats = data && Array.isArray(data.seats) ? data.seats : [];
      var activeCount = 0;
      for (var i = 0; i < seats.length; i++){
        var seat = seats[i];
        if (!seat || !seat.userId) continue;
        var status = typeof seat.status === 'string' ? seat.status.toUpperCase() : '';
        if (!status || status === 'ACTIVE' || status === 'SEATED') activeCount++;
      }
      return activeCount;
    }

    async function maybeAutoStartHand(){
      if (!shouldAutoStart) return;
      if (!currentUserId || !isSeated || !tableData) return;
      if (startHandPending || joinPending || leavePending || actPending) return;
      if (pendingStartHandRequestId) return;
      var table = tableData.table || {};
      var stateObj = tableData.state || {};
      var gameState = stateObj.state || {};
      var status = typeof table.status === 'string' ? table.status : '';
      var phase = typeof gameState.phase === 'string' ? gameState.phase : '';
      var seatedCount = getSeatedCount(tableData);
      var minPlayers = Number.isInteger(table.minPlayers) && table.minPlayers >= 2 ? table.minPlayers : 2;
      if (status !== 'OPEN' || phase !== 'INIT') {
        autoStartStopForHand = false;
        return;
      }
      if (seatedCount < minPlayers) return;
      if (autoStartStopForHand) return;
      var now = Date.now();
      if (now - autoStartLastAttemptAt < autoStartCooldownMs) return;
      autoStartLastAttemptAt = now;
      klog('poker_auto_start_attempt', { tableId: tableId, seatedCount: seatedCount, phase: phase, status: status });
      var requestId = normalizeRequestId(generateRequestId());
      pendingStartHandRequestId = requestId;
      var startResult = await startHand(requestId, { suppressNeutralErrors: true });
      var code = startResult && startResult.code ? startResult.code : (startResult && startResult.ok ? 'ok' : 'unknown_error');
      klog('poker_auto_start_result', { tableId: tableId, code: code });
      if (code === 'already_in_hand') autoStartStopForHand = true;
      if (isNeutralAutoStartCode(code)) return;
    }

    function applySeatInputBounds(){
      if (!seatNoInput) return;
      var maxUi = Number.isInteger(tableMaxPlayers) && tableMaxPlayers >= 2 ? tableMaxPlayers - 1 : 0;
      seatNoInput.min = '0';
      seatNoInput.max = String(maxUi);
      seatNoInput.step = '1';
      var seatNo = parseInt(seatNoInput.value, 10);
      if (isNaN(seatNo)) seatNo = 0;
      if (seatNo < 0) seatNo = 0;
      if (seatNo > maxUi) seatNo = maxUi;
      seatNoInput.value = String(seatNo);
    }

    async function autoJoinWithRetries(){
      var maxUi = Number.isInteger(tableMaxPlayers) && tableMaxPlayers >= 2 ? tableMaxPlayers - 1 : 0;
      var startSeat = getPreferredSeatNo();
      if (startSeat < 0) startSeat = 0;
      if (startSeat > maxUi) startSeat = maxUi;
      var attempts = Math.min(3, tableMaxPlayers);
      for (var i = 0; i < attempts; i++){
        var candidateSeat = startSeat + i;
        if (candidateSeat > maxUi) candidateSeat = candidateSeat - (maxUi + 1);
        seatNoInput.value = candidateSeat;
        try {
          await joinTable(null, { propagateError: true, autoSeat: true, preferredSeatNoOverride: candidateSeat });
          return;
        } catch (err){
          if (isAbortError(err)){
            pauseJoinPending();
            return;
          }
          if (!isSeatTakenError(err)) throw err;
        }
      }
      var seatErr = new Error(t('pokerErrSeatTaken', 'Seat was taken. Please try again.'));
      seatErr.code = 'seat_taken';
      throw seatErr;
    }

    function maybeAutoJoin(){
      if (!shouldAutoJoin || autoJoinAttempted) return;
      if (joinPending || leavePending || startHandPending || actPending) return;
      if (!seatNoInput) return;
      if (!Number.isInteger(tableMaxPlayers) || tableMaxPlayers < 2) return;
      if (isSeated) return;
      autoJoinAttempted = true;
      var preferredSeatNo = getPreferredSeatNo();
      klog('poker_auto_join_attempt', { tableId: tableId, preferredSeatNo: preferredSeatNo, autoSeat: true });
      autoJoinWithRetries().catch(function(err){
        if (isAbortError(err)){
          pauseJoinPending();
          return;
        }
        clearJoinPending();
        var code = err && err.code ? err.code : (err && err.message ? err.message : 'unknown_error');
        klog('poker_auto_join_error', { tableId: tableId, code: code, message: err && err.message ? err.message : code });
        setActionError('join', JOIN_URL, err && err.code ? err.code : 'request_failed', err && (err.message || err.code) ? err.message || err.code : t('pokerErrJoin', 'Failed to join'));
      });
    }

    async function loadTable(isPolling){
      setError(errorEl, null);
      try {
        var data = await apiGet(GET_URL + '?tableId=' + encodeURIComponent(tableId));
        tableData = data || {};
        tableData._actionConstraints = getSafeConstraints(tableData);
        isSeated = isCurrentUserSeated(tableData);
        renderTable(tableData);
        if (isSeated){
          startHeartbeat();
        } else {
          stopHeartbeat();
        }
        var seatedCount = getSeatedCount(tableData);
        if (isSeated && seatedCount !== lastAutoStartSeatCount){
          lastAutoStartSeatCount = seatedCount;
          maybeAutoStartHand();
        }
        maybeAutoJoin();
        if (isPolling){ resetPollBackoff(); }
        return true;
      } catch (err){
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return false;
        }
        if (err && err.code === 'state_invalid'){
          setError(errorEl, t('pokerErrStateChanged', 'State changed. Refreshing...'));
          scheduleRetry(function(){ loadTable(false); }, 300);
          return false;
        }
        klog('poker_table_load_error', { tableId: tableId, error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrLoadTable', 'Failed to load table'));
        if (isPolling){ increasePollBackoff(); }
        return false;
      }
    }

    function resetPollBackoff(){
      state.pollErrors = 0;
      state.pollInterval = POLL_INTERVAL_BASE;
    }

    function increasePollBackoff(){
      state.pollErrors++;
      if (state.pollErrors >= 2){
        state.pollInterval = Math.min(state.pollInterval * 2, POLL_INTERVAL_MAX);
      }
    }

    function scheduleNextPoll(){
      if (!state.polling || document.visibilityState === 'hidden') return;
      if (state.pollTimer){ clearTimeout(state.pollTimer); }
      state.pollTimer = setTimeout(pollOnce, state.pollInterval);
    }

    async function pollOnce(){
      if (!state.polling || document.visibilityState === 'hidden') return;
      await loadTable(true);
      scheduleNextPoll();
    }

    function startPolling(){
      if (state.polling) return;
      state.polling = true;
      scheduleNextPoll();
    }

    function stopPolling(){
      state.polling = false;
      if (state.pollTimer){
        clearTimeout(state.pollTimer);
        state.pollTimer = null;
      }
      if (turnTimerInterval){
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
      }
    }

    function stopHeartbeat(){
      if (heartbeatTimer){
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function isCurrentUserSeated(data){
      if (!currentUserId || !data || !Array.isArray(data.seats)) return false;
      for (var i = 0; i < data.seats.length; i++){
        var seat = data.seats[i];
        if (!seat || typeof seat.userId !== 'string') continue;
        if (seat.userId.trim() === currentUserId) return true;
      }
      return false;
    }

    function handleRealtimeEvent(_payload){
      if (!isPageActive()) return;
      if (!tableId) return;
      if (joinPending || leavePending || startHandPending || actPending) return;
      loadTable(false);
    }

    function startRealtime(){
      if (realtimeSub || realtimeDisabled) return;
      if (!tableId) return;
      if (!window.PokerRealtime || typeof window.PokerRealtime.subscribeToTableActions !== 'function') return;
      try {
        realtimeSub = window.PokerRealtime.subscribeToTableActions({
          tableId: tableId,
          onEvent: handleRealtimeEvent,
          klog: klog
        });
      } catch (err){
        realtimeSub = null;
        realtimeDisabled = true;
        if (!realtimeUnavailableLogged){
          realtimeUnavailableLogged = true;
          var errMessage = err && (err.message || err.code) ? err.message || err.code : 'unknown_error';
          klog('poker_realtime_unavailable', {
            message: errMessage,
            code: err && err.code ? err.code : null,
            userAgent: window.navigator && window.navigator.userAgent ? window.navigator.userAgent : null,
            hasWebSocket: typeof window.WebSocket === 'function',
            visibility: document.visibilityState,
            tableId: tableId
          });
        }
        startPolling();
        loadTable(false);
      }
    }

    function stopRealtime(){
      stopHeartbeat();
      if (realtimeSub && typeof realtimeSub.stop === 'function'){
        realtimeSub.stop();
      }
      realtimeSub = null;
    }

    function startHeartbeat(){
      if (heartbeatTimer) return;
      if (!isSeated) return;
      if (!isPageActive()) return;
      if (document.visibilityState === 'hidden') return;
      if (!heartbeatRequestId){
        heartbeatRequestId = normalizeRequestId(generateRequestId());
      }
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
      sendHeartbeat();
    }

    function getHeartbeatPendingDelay(retries){
      var delay = 600 * Math.pow(2, retries - 1);
      return Math.min(delay, 5000);
    }

    async function sendHeartbeat(){
      if (!isSeated) return;
      if (document.visibilityState === 'hidden') return;
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      var shouldReturn = false;
      try {
        if (!getValidRequestId(heartbeatRequestId)){
          heartbeatRequestId = normalizeRequestId(generateRequestId());
        }
        var requestId = heartbeatRequestId;
        var data = await apiPost(HEARTBEAT_URL, { tableId: tableId, requestId: requestId });
        if (isPendingResponse(data)){
          heartbeatPendingRetries++;
          if (heartbeatPendingRetries <= HEARTBEAT_PENDING_MAX_RETRIES){
            scheduleRetry(sendHeartbeat, getHeartbeatPendingDelay(heartbeatPendingRetries));
          }
          shouldReturn = true;
        }
        if (!shouldReturn){
          heartbeatPendingRetries = 0;
          if (data && data.closed){
            stopPolling();
            stopHeartbeat();
            loadTable(false);
            shouldReturn = true;
          }
        }
      } catch (err){
        if (isAuthError(err)){
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          stopHeartbeat();
          shouldReturn = true;
        } else {
          klog('poker_heartbeat_error', { tableId: tableId, error: err.message || err.code });
        }
      } finally {
        heartbeatInFlight = false;
      }
      if (shouldReturn) return;
    }

    function renderTable(data){
      var table = data.table || {};
      var seats = data.seats || [];
      var stateObj = data.state || {};
      var gameState = stateObj.state || {};

      if (tableIdEl) tableIdEl.textContent = shortId(table.id || tableId);
      var stakes = table.stakes;
      var parsedStakes = parseStakesUi(stakes);
      stakesValid = !!parsedStakes;
      if (stakesEl) stakesEl.textContent = formatStakesUi(stakes);
      if (startHandBtn) startHandBtn.disabled = !stakesValid;
      if (startHandStatusEl){
        if (!stakesValid){
          startHandStatusEl.dataset.stakesInvalid = '1';
          setInlineStatus(startHandStatusEl, t('pokerErrInvalidStakes', 'Invalid stakes'), 'error');
        } else if (startHandStatusEl.dataset.stakesInvalid === '1') {
          startHandStatusEl.dataset.stakesInvalid = '';
          setInlineStatus(startHandStatusEl, null, null);
        }
      }
      if (statusEl) statusEl.textContent = table.status || '-';

      var maxPlayers = table.maxPlayers != null ? table.maxPlayers : 6;
      tableMaxPlayers = maxPlayers;
      applySeatInputBounds();
      var stacks = gameState.stacks || {};
      if (seatsGrid){
        seatsGrid.innerHTML = '';
        for (var i = 0; i < maxPlayers; i++){
          var seat = seats.find(function(s){ return s.seatNo === i; });
          var div = document.createElement('div');
          var seatClass = 'poker-seat';
          if (!seat){
            seatClass += ' poker-seat--empty';
          } else if (seat.status && seat.status.toUpperCase() === 'INACTIVE'){
            seatClass += ' poker-seat--inactive';
          }
          div.className = seatClass;
          var seatNoEl = document.createElement('div');
          seatNoEl.className = 'poker-seat-no';
          seatNoEl.textContent = t('pokerSeatPrefix', 'Seat') + ' ' + i;
          var seatUserEl = document.createElement('div');
          seatUserEl.className = 'poker-seat-user';
          seatUserEl.textContent = seat ? shortId(seat.userId) : t('pokerSeatEmpty', 'Empty');
          var seatStatusEl = document.createElement('div');
          seatStatusEl.className = 'poker-seat-status';
          var seatStackEl = document.createElement('div');
          seatStackEl.className = 'poker-seat-stack';
          if (!seat){
            seatStatusEl.className += ' poker-seat-status--empty';
            seatStatusEl.textContent = t('pokerSeatOpen', 'Open');
            seatStackEl.textContent = t('pokerSeatStack', 'Stack') + ': -';
          } else if (seat.status && seat.status.toUpperCase() === 'INACTIVE'){
            seatStatusEl.className += ' poker-seat-status--inactive';
            seatStatusEl.textContent = t('pokerSeatInactive', 'Inactive');
            var inactiveStack = seat.userId && stacks[seat.userId] != null ? formatChips(stacks[seat.userId]) : '-';
            seatStackEl.textContent = t('pokerSeatStack', 'Stack') + ': ' + inactiveStack;
          } else {
            seatStatusEl.className += ' poker-seat-status--active';
            seatStatusEl.textContent = t('pokerSeatActive', 'Active');
            var activeStack = seat.userId && stacks[seat.userId] != null ? formatChips(stacks[seat.userId]) : '0';
            seatStackEl.textContent = t('pokerSeatStack', 'Stack') + ': ' + activeStack;
          }
          div.appendChild(seatNoEl);
          div.appendChild(seatUserEl);
          div.appendChild(seatStatusEl);
          div.appendChild(seatStackEl);
          seatsGrid.appendChild(div);
        }
      }

      var hasCurrentUserStack = !!(currentUserId && stacks[currentUserId] != null);
      var yourStack = hasCurrentUserStack ? formatChips(stacks[currentUserId]) : '-';
      if (isSeated && currentUserId && !hasCurrentUserStack){
        yourStack = '0';
        klog('poker_stack_missing_for_seated_user', {
          tableId: tableId,
          userId: currentUserId,
          stacksKeys: Object.keys(stacks || {})
        });
      }
      if (yourStackEl) yourStackEl.textContent = yourStack;
      if (potEl) potEl.textContent = gameState.pot != null ? gameState.pot : 0;
      if (phaseEl) phaseEl.textContent = gameState.phase || '-';
      renderPhaseLabel(gameState);
      renderCommunityBoard(gameState);
      renderHoleCards(data.myHoleCards);
      renderShowdownPanel({ state: gameState, playersById: buildPlayersById(seats) });
      renderTurnTimer(gameState);
      if (versionEl) versionEl.textContent = stateObj.version != null ? stateObj.version : '-';
      if (jsonBox) jsonBox.textContent = JSON.stringify(gameState, null, 2);
      renderAllowedActionButtons();
    }

    function renderHoleCards(cards){
      if (!myCardsEl) return;
      myCardsEl.innerHTML = '';
      var isValid = Array.isArray(cards) && cards.length === 2;
      if (!isValid){
        setInlineStatus(myCardsStatusEl, t('pokerMyCardsHidden', 'Sign in to see your cards.'), null);
        return;
      }
      for (var i = 0; i < cards.length; i++){
        myCardsEl.appendChild(buildCardElement(cards[i] || {}));
      }
      setInlineStatus(myCardsStatusEl, null, null);
    }

    function renderTurnTimer(gameState){
      if (!turnTimerEl) return;
      var phase = gameState ? gameState.phase : null;
      if (!isActionablePhase(phase)){
        turnTimerEl.hidden = true;
        turnTimerEl.textContent = '';
        if (turnTimerInterval){
          clearInterval(turnTimerInterval);
          turnTimerInterval = null;
        }
        return;
      }
      var deadlineMs = normalizeDeadlineMs(gameState.turnDeadlineAt);
      if (!deadlineMs){
        turnTimerEl.hidden = true;
        turnTimerEl.textContent = '';
        if (turnTimerInterval){
          clearInterval(turnTimerInterval);
          turnTimerInterval = null;
        }
        return;
      }
      function update(){
        var seconds = computeRemainingTurnSeconds(deadlineMs, Date.now());
        turnTimerEl.textContent = t('pokerTurnTimer', 'Time left') + ': ' + seconds + 's';
        turnTimerEl.hidden = false;
      }
      update();
      if (turnTimerInterval){
        clearInterval(turnTimerInterval);
      }
      turnTimerInterval = setInterval(update, 1000);
    }

    async function retryJoin(){
      if (!isPageActive()) return;
      if (!pendingJoinRequestId) return;
      await joinTable(pendingJoinRequestId);
    }

    async function retryLeave(){
      if (!isPageActive()) return;
      if (!pendingLeaveRequestId) return;
      await leaveTable(pendingLeaveRequestId);
    }

    async function retryStartHand(){
      if (!isPageActive()) return;
      if (!pendingStartHandRequestId) return;
      await startHand(pendingStartHandRequestId);
    }

    async function retryAct(){
      if (!isPageActive()) return;
      if (!pendingActRequestId || !pendingActType) return;
      await sendAct(pendingActType, pendingActRequestId);
    }

    async function joinTable(requestIdOverride, options){
      var seatNo = parseInt(seatNoInput ? seatNoInput.value : 0, 10);
      var buyIn = parseInt(buyInInput ? buyInInput.value : 100, 10) || 100;
      if (isNaN(seatNo)) seatNo = 0;
      var maxSeatNo = Math.max(0, tableMaxPlayers - 1);
      if (seatNo < 0) seatNo = 0;
      if (seatNo > maxSeatNo) seatNo = maxSeatNo;
      if (seatNoInput) seatNoInput.value = seatNo;
      var preferredSeatNo = getPreferredSeatNo(options && options.preferredSeatNoOverride);
      var hasAutoSeatOption = !!(options && Object.prototype.hasOwnProperty.call(options, 'autoSeat'));
      var wantAutoSeat = hasAutoSeatOption ? !!options.autoSeat : false;
      setPendingState('join', true);
      var propagateError = !!(options && options.propagateError);
      try {
        var resolved = resolveRequestId(pendingJoinRequestId, requestIdOverride);
        var didSetPending = false;
        if (resolved.nextPending){
          pendingJoinRequestId = normalizeRequestId(resolved.nextPending);
          pendingJoinRetries = 0;
          pendingJoinStartedAt = null;
          didSetPending = true;
        } else if (!pendingJoinRequestId) {
          pendingJoinRequestId = normalizeRequestId(resolved.requestId);
          didSetPending = true;
        }
        if (!hasAutoSeatOption && requestIdOverride && pendingJoinRequestId && requestIdOverride === pendingJoinRequestId){
          wantAutoSeat = !!pendingJoinAutoSeat;
        }
        if (didSetPending){
          pendingJoinAutoSeat = !!wantAutoSeat;
        }
        var joinRequestId = normalizeRequestId(resolved.requestId);
        var joinPayload = {
          tableId: tableId,
          buyIn: buyIn,
          requestId: joinRequestId
        };
        if (wantAutoSeat){
          joinPayload.autoSeat = true;
          joinPayload.preferredSeatNo = preferredSeatNo;
        } else {
          joinPayload.seatNo = seatNo;
        }
        var joinResult = await apiPost(JOIN_URL, joinPayload);
        if (isPendingResponse(joinResult)){
          schedulePendingRetry('join', retryJoin);
          return;
        }
        if (joinResult && joinResult.ok === false){
          clearJoinPending();
          var joinErr = new Error(joinResult.error || 'request_failed');
          joinErr.code = joinResult.error || 'request_failed';
          setActionError('join', JOIN_URL, joinErr.code, t('pokerErrJoin', 'Failed to join'));
          if (propagateError) throw joinErr;
          return;
        }
        clearJoinPending();
        setError(errorEl, null);
        if (joinResult && joinResult.ok && joinResult.seatNo != null && seatNoInput){
          seatNoInput.value = String(joinResult.seatNo);
        }
        if (joinResult && joinResult.ok){
          klog('poker_auto_join_success', { tableId: tableId, seatNo: joinResult.seatNo });
        }
        if (!isPageActive()) return;
        var loaded = await loadTable(false);
        if (!loaded) return;
        maybeAutoStartHand();
      } catch (err){
        if (isAbortError(err)){
          pauseJoinPending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        clearJoinPending();
        klog('poker_join_error', { tableId: tableId, error: err.message || err.code });
        setActionError('join', JOIN_URL, err.code || 'request_failed', err.message || t('pokerErrJoin', 'Failed to join'));
        if (propagateError) throw err;
      }
    }

    async function startHand(requestIdOverride, options){
      if (!shouldEnableDevActions()) return { ok: false, code: 'dev_actions_disabled' };
      if (!stakesValid){
        setInlineStatus(startHandStatusEl, t('pokerErrInvalidStakes', 'Invalid stakes'), 'error');
        return { ok: false, code: 'invalid_stakes' };
      }
      var opts = options || {};
      var suppressNeutralErrors = !!opts.suppressNeutralErrors;
      setInlineStatus(startHandStatusEl, null, null);
      setDevPendingState('startHand', true);
      try {
        var resolved = resolveRequestId(pendingStartHandRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingStartHandRequestId = normalizeRequestId(resolved.nextPending);
          pendingStartHandRetries = 0;
          pendingStartHandStartedAt = null;
        } else if (!pendingStartHandRequestId){
          pendingStartHandRequestId = normalizeRequestId(resolved.requestId);
        }
        var startRequestId = normalizeRequestId(resolved.requestId);
        var result = await apiPost(START_HAND_URL, { tableId: tableId, requestId: startRequestId });
        if (isPendingResponse(result)){
          scheduleDevPendingRetry('startHand', retryStartHand);
          return { ok: false, code: 'request_pending', pending: true };
        }
        if (result && result.ok === false){
          var resultCode = result.error || 'request_failed';
          clearStartHandPending();
          if (resultCode === 'state_invalid') {
            setInlineStatus(startHandStatusEl, t('pokerErrStateChanged', 'State changed. Refreshing...'), 'error');
            if (isPageActive()) loadTable(false);
            return { ok: false, code: resultCode };
          }
          if (suppressNeutralErrors && isNeutralAutoStartCode(resultCode)) {
            return { ok: false, code: resultCode };
          }
          setInlineStatus(startHandStatusEl, t('pokerErrStartHand', 'Failed to start hand'), 'error');
          return { ok: false, code: resultCode };
        }
        clearStartHandPending();
        setInlineStatus(startHandStatusEl, t('pokerStartHandOk', 'Hand started'), 'success');
        if (!isPageActive()) return { ok: true, code: 'ok' };
        loadTable(false);
        return { ok: true, code: 'ok' };
      } catch (err){
        if (isAbortError(err)){
          pauseStartHandPending();
          return { ok: false, code: 'aborted' };
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return { ok: false, code: 'unauthorized' };
        }
        var errCode = err && (err.code || err.error || err.message) ? err.code || err.error || err.message : 'request_failed';
        clearStartHandPending();
        klog('poker_start_hand_error', { tableId: tableId, error: err.message || err.code });
        if (!(suppressNeutralErrors && isNeutralAutoStartCode(errCode))){
          setInlineStatus(startHandStatusEl, err.message || t('pokerErrStartHand', 'Failed to start hand'), 'error');
        }
        return { ok: false, code: errCode };
      }
    }

    function getActPayload(actionType){
      var payload = { type: actionType };
      if (actionType === 'BET' || actionType === 'RAISE'){
        var amount = parseInt(actAmountInput ? actAmountInput.value : '', 10);
        if (!isFinite(amount) || amount <= 0){
          return { error: t('pokerActAmountRequired', 'Enter an amount for bet/raise') };
        }
        var constraints = tableData && tableData._actionConstraints ? tableData._actionConstraints : null;
        if (constraints){
          if (actionType === 'BET' && constraints.maxBetAmount != null && amount > constraints.maxBetAmount){
            return { error: t('pokerErrActAmount', 'Invalid amount') };
          }
          if (actionType === 'RAISE'){
            if (constraints.minRaiseTo != null && amount < constraints.minRaiseTo){
              return { error: t('pokerErrActAmount', 'Invalid amount') };
            }
            if (constraints.maxRaiseTo != null && amount > constraints.maxRaiseTo){
              return { error: t('pokerErrActAmount', 'Invalid amount') };
            }
          }
        }
        payload.amount = Math.trunc(amount);
      }
      return { action: payload };
    }

    function resolveCurrentHandId(){
      var stateObj = tableData && tableData.state ? tableData.state : null;
      var state = stateObj && stateObj.state ? stateObj.state : null;
      var handId = state && typeof state.handId === 'string' ? state.handId.trim() : '';
      return handId || '';
    }

    function buildExportLogUrl(){
      var url = EXPORT_LOG_URL + '?tableId=' + encodeURIComponent(tableId);
      var handId = resolveCurrentHandId();
      if (handId){
        url += '&handId=' + encodeURIComponent(handId);
      }
      return url;
    }

    async function sendAct(actionType, requestIdOverride){
      if (!shouldEnableDevActions()) return;
      var normalized = normalizeActionType(actionType);
      if (!normalized) return;
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      if (!allowedInfo.allowed.has(normalized)){
        setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
        return;
      }
      var actionResult = getActPayload(normalized);
      if (actionResult.error){
        setInlineStatus(actStatusEl, actionResult.error, 'error');
        return;
      }
      setInlineStatus(actStatusEl, null, null);
      setDevPendingState('act', true);
      try {
        var resolved = resolveRequestId(pendingActRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingActRequestId = normalizeRequestId(resolved.nextPending);
          pendingActType = normalized;
          pendingActRetries = 0;
          pendingActStartedAt = null;
        } else if (!pendingActRequestId){
          pendingActRequestId = normalizeRequestId(resolved.requestId);
          pendingActType = normalized;
        } else if (!pendingActType){
          pendingActType = normalized;
        }
        var actRequestId = normalizeRequestId(resolved.requestId);
        var result = await apiPost(ACT_URL, {
          tableId: tableId,
          requestId: actRequestId,
          action: actionResult.action
        });
        if (isPendingResponse(result)){
          scheduleDevPendingRetry('act', retryAct);
          return;
        }
        if (result && result.ok === false){
          clearActPending();
          if (result.error === 'not_your_turn'){
            setInlineStatus(actStatusEl, t('pokerErrNotYourTurn', 'Not your turn'), 'error');
          } else if (result.error === 'action_not_allowed'){
            setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
          } else if (result.error === 'invalid_amount'){
            setInlineStatus(actStatusEl, t('pokerErrActAmount', 'Invalid amount'), 'error');
          } else if (result.error === 'state_invalid'){
            setInlineStatus(actStatusEl, t('pokerErrStateChanged', 'State changed. Refreshing...'), 'error');
            if (isPageActive()) loadTable(false);
          } else {
            setInlineStatus(actStatusEl, t('pokerErrAct', 'Failed to send action'), 'error');
          }
          return;
        }
        clearActPending();
        setInlineStatus(actStatusEl, t('pokerActOk', 'Action sent'), 'success');
        if (!isPageActive()) return;
        loadTable(false);
      } catch (err){
        if (isAbortError(err)){
          pauseActPending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        clearActPending();
        var errMessage = err && (err.message || err.code) ? String(err.message || err.code) : '';
        var loweredMessage = errMessage.toLowerCase();
        if (err && (err.status === 403 || err.code === 'not_your_turn' || loweredMessage.indexOf('not your turn') !== -1)){
          setInlineStatus(actStatusEl, t('pokerErrNotYourTurn', 'Not your turn'), 'error');
          return;
        }
        if (err && err.code === 'action_not_allowed'){
          setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
          return;
        }
        if (err && err.code === 'invalid_amount'){
          setInlineStatus(actStatusEl, t('pokerErrActAmount', 'Invalid amount'), 'error');
          return;
        }
        if (err && err.code === 'state_invalid'){
          setInlineStatus(actStatusEl, t('pokerErrStateChanged', 'State changed. Refreshing...'), 'error');
          if (isPageActive()) loadTable(false);
          return;
        }
        klog('poker_act_error', { tableId: tableId, error: err.message || err.code });
        setInlineStatus(actStatusEl, err.message || t('pokerErrAct', 'Failed to send action'), 'error');
      }
    }

    async function copyHandLog(){
      if (!shouldEnableDevActions()) return;
      setInlineStatus(copyLogStatusEl, null, null);
      setDevPendingState('copyLog', true);
      try {
        var url = buildExportLogUrl();
        var result = await apiGet(url);
        if (!result || !result.schema){
          clearCopyLogPending();
          setInlineStatus(copyLogStatusEl, t('pokerCopyLogFail', 'Failed to export log'), 'error');
          return;
        }
        var text = JSON.stringify(result, null, 2);
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
          await navigator.clipboard.writeText(text);
        } else {
          throw new Error('clipboard_unavailable');
        }
        clearCopyLogPending();
        setInlineStatus(copyLogStatusEl, t('pokerCopyLogOk', 'Log copied'), 'success');
      } catch (err){
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        clearCopyLogPending();
        klog('poker_copy_log_error', { tableId: tableId, error: err.message || err.code });
        var errCode = err && (err.message || err.code) ? String(err.message || err.code) : '';
        var errMsg = errCode === 'clipboard_unavailable' ? '' : errCode;
        setInlineStatus(copyLogStatusEl, errMsg || t('pokerCopyLogFail', 'Failed to export log'), 'error');
      }
    }

    async function leaveTable(requestIdOverride){
      setPendingState('leave', true);
      try {
        var resolved = resolveRequestId(pendingLeaveRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingLeaveRequestId = normalizeRequestId(resolved.nextPending);
          pendingLeaveRetries = 0;
          pendingLeaveStartedAt = null;
        } else if (!pendingLeaveRequestId) {
          pendingLeaveRequestId = normalizeRequestId(resolved.requestId);
        }
        var leaveRequestId = normalizeRequestId(resolved.requestId);
        klog('poker_leave_request', { tableId: tableId, requestId: leaveRequestId, url: LEAVE_URL });
        var leaveResult = await apiPost(LEAVE_URL, { tableId: tableId, requestId: leaveRequestId });
        var pendingResponse = isPendingResponse(leaveResult);
        klog('poker_leave_response', {
          ok: !!(leaveResult && leaveResult.ok),
          pending: pendingResponse,
          code: leaveResult && leaveResult.error ? leaveResult.error : null
        });
        if (pendingResponse){
          schedulePendingRetry('leave', retryLeave);
          return;
        }
        if (leaveResult && leaveResult.ok === false){
          clearLeavePending();
          setActionError('leave', LEAVE_URL, leaveResult.error || 'request_failed', t('pokerErrLeave', 'Failed to leave'));
          return;
        }
        clearLeavePending();
        setError(errorEl, null);
        if (!isPageActive()) return;
        isSeated = false;
        stopHeartbeat();
        stopRealtime();
        loadTable(false);
      } catch (err){
        if (isAbortError(err)){
          pauseLeavePending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        clearLeavePending();
        klog('poker_leave_error', { tableId: tableId, error: err.message || err.code });
        setActionError('leave', LEAVE_URL, err.code || 'request_failed', err.message || t('pokerErrLeave', 'Failed to leave'));
      }
    }

    function handleVisibility(){
      if (document.visibilityState === 'hidden'){
        stopPolling();
        stopRealtime();
        stopPendingRetries();
        if (!pendingHiddenAt) pendingHiddenAt = Date.now();
      } else {
        if (pendingHiddenAt){
          var hiddenDuration = Date.now() - pendingHiddenAt;
          if (pendingJoinStartedAt) pendingJoinStartedAt += hiddenDuration;
          if (pendingLeaveStartedAt) pendingLeaveStartedAt += hiddenDuration;
          if (pendingStartHandStartedAt) pendingStartHandStartedAt += hiddenDuration;
          if (pendingActStartedAt) pendingActStartedAt += hiddenDuration;
          pendingHiddenAt = null;
        }
        state.pollInterval = POLL_INTERVAL_BASE;
        state.pollErrors = 0;
        startPolling();
        if (isSeated) startHeartbeat();
        if (currentUserId){
          try {
            startRealtime();
          } catch (_err){
            startPolling();
            loadTable(false);
          }
        }
        if (pendingJoinRequestId) schedulePendingRetry('join', retryJoin);
        if (pendingLeaveRequestId) schedulePendingRetry('leave', retryLeave);
        if (pendingStartHandRequestId) scheduleDevPendingRetry('startHand', retryStartHand);
        if (pendingActRequestId) scheduleDevPendingRetry('act', retryAct);
        if (!pendingJoinRequestId && !pendingLeaveRequestId) loadTable(false);
      }
    }

    function handleJoinClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (joinPending || leavePending) return;
      klog('poker_join_click', { tableId: tableId, hasToken: !!state.token });
      setError(errorEl, null);
      joinTable().catch(function(err){
        if (isAbortError(err)){
          pauseJoinPending();
          return;
        }
        clearJoinPending();
        klog('poker_join_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setActionError('join', JOIN_URL, err && err.code ? err.code : 'request_failed', err && (err.message || err.code) ? err.message || err.code : t('pokerErrJoin', 'Failed to join'));
      });
    }

    function handleLeaveClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (joinPending || leavePending) return;
      klog('poker_leave_click', { tableId: tableId, hasToken: !!state.token });
      setError(errorEl, null);
      leaveTable().catch(function(err){
        if (isAbortError(err)){
          pauseLeavePending();
          return;
        }
        clearLeavePending();
        klog('poker_leave_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setActionError('leave', LEAVE_URL, err && err.code ? err.code : 'request_failed', err && (err.message || err.code) ? err.message || err.code : t('pokerErrLeave', 'Failed to leave'));
      });
    }

    function handleStartHandClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (startHandPending || !shouldEnableDevActions()) return;
      klog('poker_start_hand_click', { tableId: tableId, hasToken: !!state.token });
      setInlineStatus(startHandStatusEl, null, null);
      startHand().catch(function(err){
        if (isAbortError(err)){
          pauseStartHandPending();
          return;
        }
        clearStartHandPending();
        klog('poker_start_hand_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(startHandStatusEl, err && (err.message || err.code) ? err.message || err.code : t('pokerErrStartHand', 'Failed to start hand'), 'error');
      });
    }

    function handleCopyLogClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (copyLogPending || !shouldEnableDevActions()) return;
      klog('poker_copy_log_click', { tableId: tableId, hasToken: !!state.token });
      setInlineStatus(copyLogStatusEl, null, null);
      copyHandLog().catch(function(err){
        clearCopyLogPending();
        klog('poker_copy_log_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(copyLogStatusEl, err && (err.message || err.code) ? err.message || err.code : t('pokerCopyLogFail', 'Failed to export log'), 'error');
      });
    }

    function handleActionClick(actionType, event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (actPending || !shouldEnableDevActions()) return;
      var normalized = normalizeActionType(actionType);
      if (!normalized) return;
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      if (!allowedInfo.allowed.has(normalized)){
        setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
        return;
      }
      pendingActType = normalized;
      updateActAmountConstraints(allowedInfo, pendingActType);
      updateActAmountHint(allowedInfo, pendingActType);
      klog('poker_act_click', { tableId: tableId, hasToken: !!state.token, type: normalized });
      setInlineStatus(actStatusEl, null, null);
      sendAct(normalized).catch(function(err){
        if (isAbortError(err)){
          pauseActPending();
          return;
        }
        clearActPending();
        klog('poker_act_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(actStatusEl, err && (err.message || err.code) ? err.message || err.code : t('pokerErrAct', 'Failed to send action'), 'error');
      });
    }

    function handleActCheckClick(event){
      handleActionClick('CHECK', event);
    }

    function handleActCallClick(event){
      handleActionClick('CALL', event);
    }

    function handleActFoldClick(event){
      handleActionClick('FOLD', event);
    }

    function handleActBetClick(event){
      handleActionClick('BET', event);
    }

    function handleActRaiseClick(event){
      handleActionClick('RAISE', event);
    }

    if (joinBtn) joinBtn.addEventListener('click', handleJoinClick);
    if (leaveBtn) leaveBtn.addEventListener('click', handleLeaveClick);
    if (startHandBtn) startHandBtn.addEventListener('click', handleStartHandClick);
    if (copyLogBtn) copyLogBtn.addEventListener('click', handleCopyLogClick);
    if (actCheckBtn) actCheckBtn.addEventListener('click', handleActCheckClick);
    if (actCallBtn) actCallBtn.addEventListener('click', handleActCallClick);
    if (actFoldBtn) actFoldBtn.addEventListener('click', handleActFoldClick);
    if (actBetBtn) actBetBtn.addEventListener('click', handleActBetClick);
    if (actRaiseBtn) actRaiseBtn.addEventListener('click', handleActRaiseClick);
    if (jsonToggle){
      jsonToggle.addEventListener('click', function(){
        if (jsonBox) jsonBox.hidden = !jsonBox.hidden;
      });
    }
    if (signInBtn){
      signInBtn.addEventListener('click', openSignIn);
    }

    document.addEventListener('visibilitychange', handleVisibility); // xp-lifecycle-allow:poker-table(2026-01-01)
    window.addEventListener('pagehide', stopRealtime); // xp-lifecycle-allow:poker-table-pagehide(2026-01-01)
    window.addEventListener('beforeunload', stopPolling); // xp-lifecycle-allow:poker-table(2026-01-01)
    window.addEventListener('beforeunload', stopHeartbeat); // xp-lifecycle-allow:poker-table-heartbeat(2026-01-01)
    window.addEventListener('beforeunload', stopRealtime); // xp-lifecycle-allow:poker-table-realtime(2026-01-01)
    window.addEventListener('beforeunload', stopPendingAll); // xp-lifecycle-allow:poker-table-pending(2026-01-01)
    window.addEventListener('beforeunload', stopAuthWatch); // xp-lifecycle-allow:poker-table-auth(2026-01-01)

    setDevActionsEnabled(false);
    setDevActionsAuthStatus(false);

    checkAuth().then(function(authed){
      if (authed){
        loadTable(false);
        startPolling();
        try {
          startRealtime();
        } catch (_err){
          startPolling();
          loadTable(false);
        }
      }
    });
  }

  // ========== INIT ==========
  function init(){
    var isTable = window.location.pathname.indexOf('/poker/table') !== -1;
    klog('poker_ui_loaded', { version: UI_VERSION, page: isTable ? 'table' : 'lobby' });
    if (isTable){
      initTable();
    } else {
      initLobby();
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
