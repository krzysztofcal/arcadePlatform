(function(){
  if (typeof window === 'undefined') return;

  var LIST_URL = '/.netlify/functions/poker-list-tables';
  var CREATE_URL = '/.netlify/functions/poker-create-table';
  var GET_URL = '/.netlify/functions/poker-get-table';
  var JOIN_URL = '/.netlify/functions/poker-join';
  var LEAVE_URL = '/.netlify/functions/poker-leave';
  var ACT_URL = '/.netlify/functions/poker-act';
  var HEARTBEAT_URL = '/.netlify/functions/poker-heartbeat';
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

  function setLoading(el, loading){
    if (!el) return;
    el.disabled = loading;
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
        var stakes = tbl.stakes || {};
        var maxPlayers = tbl.maxPlayers != null ? tbl.maxPlayers : 6;
        var seatCount = tbl.seatCount != null ? tbl.seatCount : 0;
        var tid = document.createElement('span');
        tid.className = 'tid';
        tid.textContent = shortId(tbl.id);
        var stakesEl = document.createElement('span');
        stakesEl.className = 'stakes';
        stakesEl.textContent = (stakes.sb != null ? stakes.sb : 0) + '/' + (stakes.bb != null ? stakes.bb : 0);
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

    async function createTable(){
      setError(errorEl, null);
      var sb = parseInt(sbInput ? sbInput.value : 1, 10) || 1;
      var bb = parseInt(bbInput ? bbInput.value : 2, 10) || 2;
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
    var joinBtn = document.getElementById('pokerJoin');
    var leaveBtn = document.getElementById('pokerLeave');
    var joinStatusEl = document.getElementById('pokerJoinStatus');
    var leaveStatusEl = document.getElementById('pokerLeaveStatus');
    var actionStatusEl = document.getElementById('pokerActionStatus');
    var seatNoInput = document.getElementById('pokerSeatNo');
    var buyInInput = document.getElementById('pokerBuyIn');
    var actionAmountInput = document.getElementById('pokerActionAmount');
    var actionFoldBtn = document.getElementById('pokerActionFold');
    var actionCheckBtn = document.getElementById('pokerActionCheck');
    var actionCallBtn = document.getElementById('pokerActionCall');
    var actionBetBtn = document.getElementById('pokerActionBet');
    var actionRaiseBtn = document.getElementById('pokerActionRaise');
    var yourStackEl = document.getElementById('pokerYourStack');
    var potEl = document.getElementById('pokerPot');
    var phaseEl = document.getElementById('pokerPhase');
    var versionEl = document.getElementById('pokerVersion');
    var boardEl = document.getElementById('pokerBoard');
    var actorEl = document.getElementById('pokerActor');
    var toCallEl = document.getElementById('pokerToCall');
    var streetBetEl = document.getElementById('pokerStreetBet');
    var yourBetEl = document.getElementById('pokerYourBet');
    var minRaiseEl = document.getElementById('pokerMinRaiseTo');
    var jsonToggle = document.getElementById('pokerJsonToggle');
    var jsonBox = document.getElementById('pokerJsonBox');
    var signInBtn = document.getElementById('pokerSignIn');
    var leaveSelector = '#pokerLeave';
    var joinSelector = '#pokerJoin';

    var currentUserId = null;
    var tableData = null;
    var tableMaxPlayers = 6;
    var authTimer = null;
    var heartbeatTimer = null;
    var heartbeatRequestId = null;
    var pendingJoinRequestId = null;
    var pendingLeaveRequestId = null;
    var pendingActRequestId = null;
    var pendingActType = null;
    var pendingActAmount = null;
    var pendingJoinRetries = 0;
    var pendingLeaveRetries = 0;
    var pendingActRetries = 0;
    var pendingJoinStartedAt = null;
    var pendingLeaveStartedAt = null;
    var pendingActStartedAt = null;
    var pendingJoinTimer = null;
    var pendingLeaveTimer = null;
    var pendingActTimer = null;
    var joinPending = false;
    var leavePending = false;
    var actPending = false;
    var pendingHiddenAt = null;
    var heartbeatPendingRetries = 0;
    var heartbeatInFlight = false;
    var HEARTBEAT_PENDING_MAX_RETRIES = 8;

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
            startHeartbeat();
          }
        });
      }, 3000);
    }

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        if (authMsg) authMsg.hidden = false;
        if (tableContent) tableContent.hidden = true;
        startAuthWatch();
        return false;
      }
      currentUserId = getUserIdFromToken(token);
      if (authMsg) authMsg.hidden = true;
      if (tableContent) tableContent.hidden = false;
      stopAuthWatch();
      return true;
    }

    function updatePendingUi(){
      var busy = joinPending || leavePending || actPending;
      setLoading(joinBtn, busy);
      setLoading(leaveBtn, busy);
      setLoading(actionFoldBtn, busy);
      setLoading(actionCheckBtn, busy);
      setLoading(actionCallBtn, busy);
      setLoading(actionBetBtn, busy);
      setLoading(actionRaiseBtn, busy);
      if (seatNoInput) seatNoInput.disabled = busy;
      if (buyInInput) buyInInput.disabled = busy;
      if (actionAmountInput) actionAmountInput.disabled = busy;
      if (joinStatusEl){
        joinStatusEl.textContent = joinPending ? t('pokerJoinPending', 'Joining...') : '';
        joinStatusEl.hidden = !joinPending;
      }
      if (leaveStatusEl){
        leaveStatusEl.textContent = leavePending ? t('pokerLeavePending', 'Leaving...') : '';
        leaveStatusEl.hidden = !leavePending;
      }
      if (actionStatusEl){
        actionStatusEl.textContent = actPending ? t('pokerActPending', 'Sending action...') : '';
        actionStatusEl.hidden = !actPending;
      }
    }

    function setPendingState(action, isPending){
      if (action === 'join'){
        joinPending = isPending;
      } else if (action === 'leave'){
        leavePending = isPending;
      } else if (action === 'act'){
        actPending = isPending;
      }
      updatePendingUi();
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

    function clearActPending(){
      pendingActRequestId = null;
      pendingActType = null;
      pendingActAmount = null;
      pendingActRetries = 0;
      pendingActStartedAt = null;
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
      setPendingState('act', false);
    }

    function handlePendingTimeout(action){
      var message = action === 'join'
        ? t('pokerErrJoinPending', 'Join still pending. Please try again.')
        : action === 'leave'
          ? t('pokerErrLeavePending', 'Leave still pending. Please try again.')
          : t('pokerErrActPending', 'Action still pending. Please try again.');
      var endpoint = action === 'join' ? JOIN_URL : action === 'leave' ? LEAVE_URL : ACT_URL;
      var retries = action === 'join' ? pendingJoinRetries : action === 'leave' ? pendingLeaveRetries : pendingActRetries;
      klog('poker_pending_timeout', { action: action, tableId: tableId, retries: retries, budgetMs: PENDING_RETRY_BUDGET_MS });
      if (action === 'join'){
        clearJoinPending();
      } else {
        if (action === 'leave'){
          clearLeavePending();
        } else {
          clearActPending();
        }
      }
      setActionError(action, endpoint, 'pending_timeout', message);
    }

    function schedulePendingRetry(action, retryFn){
      if (!isPageActive()) return;
      setPendingState(action, true);
      var startedAt = action === 'join' ? pendingJoinStartedAt : action === 'leave' ? pendingLeaveStartedAt : pendingActStartedAt;
      var retries = action === 'join' ? pendingJoinRetries : action === 'leave' ? pendingLeaveRetries : pendingActRetries;
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
        if (action === 'leave'){
          pendingLeaveStartedAt = startedAt;
          pendingLeaveRetries = retries;
          if (pendingLeaveTimer) clearTimeout(pendingLeaveTimer);
          pendingLeaveTimer = scheduleRetry(retryFn, delay);
        } else {
          pendingActStartedAt = startedAt;
          pendingActRetries = retries;
          if (pendingActTimer) clearTimeout(pendingActTimer);
          pendingActTimer = scheduleRetry(retryFn, delay);
        }
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
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
    }

    // stopPendingAll cancels pending operations (clears request ids) — used for unload and auth expiry.
    function stopPendingAll(){
      clearJoinPending();
      clearLeavePending();
      clearActPending();
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

    function pauseActPending(){
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
      setPendingState('act', false);
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

    async function loadTable(isPolling){
      setError(errorEl, null);
      try {
        var data = await apiGet(GET_URL + '?tableId=' + encodeURIComponent(tableId));
        tableData = data;
        renderTable(data);
        if (isPolling){ resetPollBackoff(); }
      } catch (err){
        if (isAuthError(err)){
          stopPendingAll();
          handleAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        klog('poker_table_load_error', { tableId: tableId, error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrLoadTable', 'Failed to load table'));
        if (isPolling){ increasePollBackoff(); }
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
    }

    function stopHeartbeat(){
      if (heartbeatTimer){
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function startHeartbeat(){
      if (heartbeatTimer) return;
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
          handleAuthExpired({
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
      var publicSeats = (gameState.public && gameState.public.seats) ? gameState.public.seats : [];
      var actorSeatNo = gameState.actorSeat;
      var publicSeatMap = {};
      publicSeats.forEach(function(seat){
        if (seat && Number.isFinite(seat.seatNo)){
          publicSeatMap[seat.seatNo] = seat;
        }
      });

      if (tableIdEl) tableIdEl.textContent = shortId(table.id || tableId);
      var stakes = table.stakes || {};
      if (stakesEl) stakesEl.textContent = (stakes.sb || 0) + '/' + (stakes.bb || 0);
      if (statusEl) statusEl.textContent = table.status || '-';

      var maxPlayers = table.maxPlayers != null ? table.maxPlayers : 6;
      tableMaxPlayers = maxPlayers;
      if (seatNoInput){
        seatNoInput.min = 0;
        seatNoInput.max = Math.max(0, maxPlayers - 1);
      }
      if (seatsGrid){
        seatsGrid.innerHTML = '';
        for (var i = 0; i < maxPlayers; i++){
          var seat = seats.find(function(s){ return s.seatNo === i; });
          var publicSeat = publicSeatMap[i] || null;
          var seatUserId = (publicSeat && publicSeat.userId) ? publicSeat.userId : (seat ? seat.userId : null);
          var seatStack = publicSeat && Number.isFinite(publicSeat.stack)
            ? publicSeat.stack
            : (seat && Number.isFinite(seat.stack) ? seat.stack : null);
          var seatFolded = !!(publicSeat && publicSeat.hasFolded);
          var seatAllIn = !!(publicSeat && publicSeat.isAllIn);
          var div = document.createElement('div');
          var seatClass = 'poker-seat';
          if (!seat){
            seatClass += ' poker-seat--empty';
          } else if (seat.status && seat.status.toUpperCase() === 'INACTIVE'){
            seatClass += ' poker-seat--inactive';
          }
          if (actorSeatNo != null && i === actorSeatNo){
            seatClass += ' poker-seat--actor';
          }
          div.className = seatClass;
          var seatNoEl = document.createElement('div');
          seatNoEl.className = 'poker-seat-no';
          seatNoEl.textContent = t('pokerSeatPrefix', 'Seat') + ' ' + i;
          var seatUserEl = document.createElement('div');
          seatUserEl.className = 'poker-seat-user';
          seatUserEl.textContent = seat ? shortId(seatUserId) : t('pokerSeatEmpty', 'Empty');
          var seatStatusEl = document.createElement('div');
          seatStatusEl.className = 'poker-seat-status';
          if (!seat){
            seatStatusEl.className += ' poker-seat-status--empty';
            seatStatusEl.textContent = t('pokerSeatOpen', 'Open');
          } else if (seat.status && seat.status.toUpperCase() === 'INACTIVE'){
            seatStatusEl.className += ' poker-seat-status--inactive';
            seatStatusEl.textContent = t('pokerSeatInactive', 'Inactive');
          } else if (seatFolded){
            seatStatusEl.className += ' poker-seat-status--inactive';
            seatStatusEl.textContent = t('pokerSeatFolded', 'Folded');
          } else if (seatAllIn){
            seatStatusEl.className += ' poker-seat-status--active';
            seatStatusEl.textContent = t('pokerSeatAllIn', 'All-in');
          } else {
            seatStatusEl.className += ' poker-seat-status--active';
            seatStatusEl.textContent = t('pokerSeatActive', 'Active');
          }
          if (seatStack != null){
            seatStatusEl.textContent += ' · ' + t('pokerSeatStack', 'Stack') + ' ' + seatStack;
          }
          div.appendChild(seatNoEl);
          div.appendChild(seatUserEl);
          div.appendChild(seatStatusEl);
          seatsGrid.appendChild(div);
        }
      }

      var stacks = gameState.stacks || {};
      var actorSeat = publicSeats.find(function(seat){ return seat.seatNo === actorSeatNo; });
      var yourStack = currentUserId && stacks[currentUserId] != null ? stacks[currentUserId] : '-';
      if (yourStackEl) yourStackEl.textContent = yourStack;
      if (potEl) potEl.textContent = gameState.potTotal != null ? gameState.potTotal : (gameState.pot != null ? gameState.pot : 0);
      if (phaseEl) phaseEl.textContent = gameState.phase || '-';
      if (versionEl) versionEl.textContent = stateObj.version != null ? stateObj.version : '-';
      if (boardEl){
        var board = Array.isArray(gameState.board) ? gameState.board : [];
        boardEl.textContent = board.length ? board.join(' ') : '-';
      }
      if (actorEl) actorEl.textContent = actorSeat ? shortId(actorSeat.userId) : '-';
      var streetBet = Number.isFinite(gameState.streetBet) ? gameState.streetBet : 0;
      var minRaiseTo = Number.isFinite(gameState.minRaiseTo) ? gameState.minRaiseTo : 0;
      var bbAmount = Number.isFinite(gameState.bbAmount) ? gameState.bbAmount : 0;
      var yourPublic = publicSeats.find(function(seat){ return seat.userId === currentUserId; });
      var yourBet = yourPublic && Number.isFinite(yourPublic.betThisStreet) ? yourPublic.betThisStreet : 0;
      var toCall = Math.max(0, streetBet - yourBet);
      if (yourBetEl) yourBetEl.textContent = yourBet;
      if (minRaiseEl) minRaiseEl.textContent = minRaiseTo;
      if (toCallEl) toCallEl.textContent = toCall;
      if (streetBetEl) streetBetEl.textContent = streetBet;
      var allowed = Array.isArray(gameState.allowedActions) ? gameState.allowedActions : [];
      if (actionAmountInput){
        var actionMin = 0;
        if (allowed.indexOf('RAISE') >= 0 && minRaiseTo > 0){
          actionMin = minRaiseTo;
        } else if (allowed.indexOf('BET') >= 0 && bbAmount > 0){
          actionMin = bbAmount;
        }
        actionAmountInput.min = actionMin;
      }
      if (actionFoldBtn) actionFoldBtn.disabled = allowed.indexOf('FOLD') < 0 || actPending;
      if (actionCheckBtn) actionCheckBtn.disabled = allowed.indexOf('CHECK') < 0 || actPending;
      if (actionCallBtn) actionCallBtn.disabled = allowed.indexOf('CALL') < 0 || actPending;
      if (actionBetBtn) actionBetBtn.disabled = allowed.indexOf('BET') < 0 || actPending;
      if (actionRaiseBtn) actionRaiseBtn.disabled = allowed.indexOf('RAISE') < 0 || actPending;
      if (jsonBox) jsonBox.textContent = JSON.stringify(gameState, null, 2);
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

    async function retryAct(){
      if (!isPageActive()) return;
      if (!pendingActRequestId) return;
      await act(pendingActRequestId, pendingActType, pendingActAmount);
    }

    async function joinTable(requestIdOverride){
      var seatNo = parseInt(seatNoInput ? seatNoInput.value : 0, 10);
      var buyIn = parseInt(buyInInput ? buyInInput.value : 100, 10) || 100;
      if (isNaN(seatNo)) seatNo = 0;
      var maxSeat = Math.max(0, tableMaxPlayers - 1);
      if (seatNo < 0) seatNo = 0;
      if (seatNo > maxSeat) seatNo = maxSeat;
      if (seatNoInput) seatNoInput.value = seatNo;
      setPendingState('join', true);
      try {
        var resolved = resolveRequestId(pendingJoinRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingJoinRequestId = normalizeRequestId(resolved.nextPending);
          pendingJoinRetries = 0;
          pendingJoinStartedAt = null;
        } else if (!pendingJoinRequestId) {
          pendingJoinRequestId = normalizeRequestId(resolved.requestId);
        }
        var joinRequestId = normalizeRequestId(resolved.requestId);
        var joinResult = await apiPost(JOIN_URL, {
          tableId: tableId,
          seatNo: seatNo,
          buyIn: buyIn,
          requestId: joinRequestId
        });
        if (joinResult && joinResult.ok === false){
          clearJoinPending();
          setActionError('join', JOIN_URL, joinResult.error || 'request_failed', t('pokerErrJoin', 'Failed to join'));
          return;
        }
        if (isPendingResponse(joinResult)){
          schedulePendingRetry('join', retryJoin);
          return;
        }
        clearJoinPending();
        setError(errorEl, null);
        if (!isPageActive()) return;
        loadTable(false);
      } catch (err){
        if (isAbortError(err)){
          pauseJoinPending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleAuthExpired({
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
        loadTable(false);
      } catch (err){
        if (isAbortError(err)){
          pauseLeavePending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleAuthExpired({
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

    async function act(requestIdOverride, actionTypeOverride, amountOverride){
      if (actPending) return;
      setPendingState('act', true);
      try {
        var resolved = resolveRequestId(pendingActRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingActRequestId = normalizeRequestId(resolved.nextPending);
          pendingActRetries = 0;
          pendingActStartedAt = null;
        } else if (!pendingActRequestId) {
          pendingActRequestId = normalizeRequestId(resolved.requestId);
        }
        var requestId = normalizeRequestId(resolved.requestId);
        var actionType = actionTypeOverride;
        var amountValue = typeof amountOverride === 'number' ? amountOverride : null;
        pendingActType = actionType;
        pendingActAmount = amountValue;
        var payload = { tableId: tableId, requestId: requestId, actionType: actionType };
        if (amountValue != null) payload.amount = amountValue;
        var actResult = await apiPost(ACT_URL, payload);
        if (isPendingResponse(actResult)){
          schedulePendingRetry('act', retryAct);
          return;
        }
        if (actResult && actResult.ok === false){
          clearActPending();
          setActionError('act', ACT_URL, actResult.error || 'request_failed', t('pokerErrAct', 'Failed to act'));
          return;
        }
        clearActPending();
        setError(errorEl, null);
        if (!isPageActive()) return;
        if (actResult && actResult.state && tableData){
          tableData.state = { version: actResult.version, state: actResult.state };
          renderTable(tableData);
        } else {
          loadTable(false);
        }
      } catch (err){
        if (isAbortError(err)){
          pauseActPending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleAuthExpired({
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
        klog('poker_act_error', { tableId: tableId, error: err.message || err.code });
        setActionError('act', ACT_URL, err.code || 'request_failed', err.message || t('pokerErrAct', 'Failed to act'));
      }
    }

    function handleVisibility(){
      if (document.visibilityState === 'hidden'){
        stopPolling();
        stopHeartbeat();
        stopPendingRetries();
        if (!pendingHiddenAt) pendingHiddenAt = Date.now();
      } else {
        if (pendingHiddenAt){
          var hiddenDuration = Date.now() - pendingHiddenAt;
          if (pendingJoinStartedAt) pendingJoinStartedAt += hiddenDuration;
          if (pendingLeaveStartedAt) pendingLeaveStartedAt += hiddenDuration;
          if (pendingActStartedAt) pendingActStartedAt += hiddenDuration;
          pendingHiddenAt = null;
        }
        state.pollInterval = POLL_INTERVAL_BASE;
        state.pollErrors = 0;
        startPolling();
        startHeartbeat();
        if (pendingJoinRequestId) schedulePendingRetry('join', retryJoin);
        if (pendingLeaveRequestId) schedulePendingRetry('leave', retryLeave);
        if (pendingActRequestId) schedulePendingRetry('act', retryAct);
        if (!pendingJoinRequestId && !pendingLeaveRequestId && !pendingActRequestId) loadTable(false);
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

    function parseActionAmount(){
      if (!actionAmountInput) return 0;
      var value = parseInt(actionAmountInput.value, 10);
      if (isNaN(value) || value < 0) value = 0;
      actionAmountInput.value = value;
      return value;
    }

    function handleActionClick(actionType){
      if (joinPending || leavePending || actPending) return;
      setError(errorEl, null);
      var amount = null;
      if (actionType === 'BET' || actionType === 'RAISE'){
        amount = parseActionAmount();
        if (!amount){
          setActionError('act', ACT_URL, 'invalid_amount', t('pokerErrActAmount', 'Enter the total bet amount (raise to).'));
          return;
        }
      }
      act(null, actionType, amount).catch(function(err){
        if (isAbortError(err)){
          pauseActPending();
          return;
        }
        clearActPending();
        klog('poker_act_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setActionError('act', ACT_URL, err && err.code ? err.code : 'request_failed', err && (err.message || err.code) ? err.message || err.code : t('pokerErrAct', 'Failed to act'));
      });
    }

    if (joinBtn) joinBtn.addEventListener('click', handleJoinClick);
    if (leaveBtn) leaveBtn.addEventListener('click', handleLeaveClick);
    if (actionFoldBtn) actionFoldBtn.addEventListener('click', function(event){
      if (event){ event.preventDefault(); event.stopPropagation(); }
      handleActionClick('FOLD');
    });
    if (actionCheckBtn) actionCheckBtn.addEventListener('click', function(event){
      if (event){ event.preventDefault(); event.stopPropagation(); }
      handleActionClick('CHECK');
    });
    if (actionCallBtn) actionCallBtn.addEventListener('click', function(event){
      if (event){ event.preventDefault(); event.stopPropagation(); }
      handleActionClick('CALL');
    });
    if (actionBetBtn) actionBetBtn.addEventListener('click', function(event){
      if (event){ event.preventDefault(); event.stopPropagation(); }
      handleActionClick('BET');
    });
    if (actionRaiseBtn) actionRaiseBtn.addEventListener('click', function(event){
      if (event){ event.preventDefault(); event.stopPropagation(); }
      handleActionClick('RAISE');
    });
    if (jsonToggle){
      jsonToggle.addEventListener('click', function(){
        if (jsonBox) jsonBox.hidden = !jsonBox.hidden;
      });
    }
    if (signInBtn){
      signInBtn.addEventListener('click', openSignIn);
    }

    document.addEventListener('visibilitychange', handleVisibility); // xp-lifecycle-allow:poker-table(2026-01-01)
    window.addEventListener('beforeunload', stopPolling); // xp-lifecycle-allow:poker-table(2026-01-01)
    window.addEventListener('beforeunload', stopHeartbeat); // xp-lifecycle-allow:poker-table-heartbeat(2026-01-01)
    window.addEventListener('beforeunload', stopPendingAll); // xp-lifecycle-allow:poker-table-pending(2026-01-01)
    window.addEventListener('beforeunload', stopAuthWatch); // xp-lifecycle-allow:poker-table-auth(2026-01-01)

    checkAuth().then(function(authed){
      if (authed){
        loadTable(false);
        startPolling();
        startHeartbeat();
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
