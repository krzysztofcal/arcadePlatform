(function(){
  if (typeof window === 'undefined') return;

  var LIST_URL = '/.netlify/functions/poker-list-tables';
  var CREATE_URL = '/.netlify/functions/poker-create-table';
  var GET_URL = '/.netlify/functions/poker-get-table';
  var JOIN_URL = '/.netlify/functions/poker-join';
  var LEAVE_URL = '/.netlify/functions/poker-leave';
  var HEARTBEAT_URL = '/.netlify/functions/poker-heartbeat';
  var POLL_INTERVAL_BASE = 2000;
  var POLL_INTERVAL_MAX = 10000;
  var HEARTBEAT_INTERVAL_MS = 20000;

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

  function scheduleRetry(fn, delayMs){
    if (typeof fn !== 'function') return;
    var delay = typeof delayMs === 'number' ? delayMs : 600;
    setTimeout(function(){
      fn();
    }, delay);
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
    var seatNoInput = document.getElementById('pokerSeatNo');
    var buyInInput = document.getElementById('pokerBuyIn');
    var yourStackEl = document.getElementById('pokerYourStack');
    var potEl = document.getElementById('pokerPot');
    var phaseEl = document.getElementById('pokerPhase');
    var versionEl = document.getElementById('pokerVersion');
    var jsonToggle = document.getElementById('pokerJsonToggle');
    var jsonBox = document.getElementById('pokerJsonBox');
    var signInBtn = document.getElementById('pokerSignIn');

    var currentUserId = null;
    var tableData = null;
    var tableMaxPlayers = 6;
    var authTimer = null;
    var heartbeatTimer = null;
    var heartbeatRequestId = null;
    var pendingJoinRequestId = null;
    var pendingLeaveRequestId = null;
    var pendingJoinRetries = 0;
    var pendingLeaveRetries = 0;
    var pendingMaxRetries = 8;
    var heartbeatPendingRetries = 0;
    var heartbeatInFlight = false;
    var HEARTBEAT_PENDING_MAX_RETRIES = 8;

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

    async function loadTable(isPolling){
      setError(errorEl, null);
      try {
        var data = await apiGet(GET_URL + '?tableId=' + encodeURIComponent(tableId));
        tableData = data;
        renderTable(data);
        if (isPolling){ resetPollBackoff(); }
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
        heartbeatRequestId = generateRequestId();
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
        var data = await apiPost(HEARTBEAT_URL, { tableId: tableId, requestId: heartbeatRequestId });
        if (isPendingResponse(data)){
          heartbeatPendingRetries++;
          heartbeatRequestId = generateRequestId();
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
        }
        klog('poker_heartbeat_error', { tableId: tableId, error: err.message || err.code });
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
          if (!seat){
            seatStatusEl.className += ' poker-seat-status--empty';
            seatStatusEl.textContent = t('pokerSeatOpen', 'Open');
          } else if (seat.status && seat.status.toUpperCase() === 'INACTIVE'){
            seatStatusEl.className += ' poker-seat-status--inactive';
            seatStatusEl.textContent = t('pokerSeatInactive', 'Inactive');
          } else {
            seatStatusEl.className += ' poker-seat-status--active';
            seatStatusEl.textContent = t('pokerSeatActive', 'Active');
          }
          div.appendChild(seatNoEl);
          div.appendChild(seatUserEl);
          div.appendChild(seatStatusEl);
          seatsGrid.appendChild(div);
        }
      }

      var stacks = gameState.stacks || {};
      var yourStack = currentUserId && stacks[currentUserId] != null ? stacks[currentUserId] : '-';
      if (yourStackEl) yourStackEl.textContent = yourStack;
      if (potEl) potEl.textContent = gameState.pot != null ? gameState.pot : 0;
      if (phaseEl) phaseEl.textContent = gameState.phase || '-';
      if (versionEl) versionEl.textContent = stateObj.version != null ? stateObj.version : '-';
      if (jsonBox) jsonBox.textContent = JSON.stringify(gameState, null, 2);
    }

    async function retryJoin(){
      if (!pendingJoinRequestId) return;
      if (pendingJoinRetries >= pendingMaxRetries){
        pendingJoinRequestId = null;
        pendingJoinRetries = 0;
        setLoading(joinBtn, false);
        setLoading(leaveBtn, false);
        setError(errorEl, t('pokerErrJoinPending', 'Join still pending. Please try again.'));
        return;
      }
      pendingJoinRetries++;
      await joinTable(pendingJoinRequestId);
    }

    async function retryLeave(){
      if (!pendingLeaveRequestId) return;
      if (pendingLeaveRetries >= pendingMaxRetries){
        pendingLeaveRequestId = null;
        pendingLeaveRetries = 0;
        setLoading(joinBtn, false);
        setLoading(leaveBtn, false);
        setError(errorEl, t('pokerErrLeavePending', 'Leave still pending. Please try again.'));
        return;
      }
      pendingLeaveRetries++;
      await leaveTable(pendingLeaveRequestId);
    }

    async function joinTable(requestIdOverride){
      setError(errorEl, null);
      var seatNo = parseInt(seatNoInput ? seatNoInput.value : 0, 10);
      var buyIn = parseInt(buyInInput ? buyInInput.value : 100, 10) || 100;
      if (isNaN(seatNo)) seatNo = 0;
      var maxSeat = Math.max(0, tableMaxPlayers - 1);
      if (seatNo < 0) seatNo = 0;
      if (seatNo > maxSeat) seatNo = maxSeat;
      if (seatNoInput) seatNoInput.value = seatNo;
      setLoading(joinBtn, true);
      setLoading(leaveBtn, true);
      try {
        if (!requestIdOverride && !pendingJoinRequestId){
          pendingJoinRequestId = generateRequestId();
          pendingJoinRetries = 0;
        }
        var joinRequestId = requestIdOverride || pendingJoinRequestId || generateRequestId();
        var joinResult = await apiPost(JOIN_URL, { tableId: tableId, seatNo: seatNo, buyIn: buyIn, requestId: joinRequestId });
        if (isPendingResponse(joinResult)){
          scheduleRetry(retryJoin);
          return;
        }
        pendingJoinRequestId = null;
        pendingJoinRetries = 0;
        loadTable();
      } catch (err){
        pendingJoinRequestId = null;
        pendingJoinRetries = 0;
        if (isAuthError(err)){
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
        klog('poker_join_error', { tableId: tableId, error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrJoin', 'Failed to join'));
      } finally {
        if (!pendingJoinRequestId){
          setLoading(joinBtn, false);
          setLoading(leaveBtn, false);
        }
      }
    }

    async function leaveTable(requestIdOverride){
      setError(errorEl, null);
      setLoading(joinBtn, true);
      setLoading(leaveBtn, true);
      try {
        if (!requestIdOverride && !pendingLeaveRequestId){
          pendingLeaveRequestId = generateRequestId();
          pendingLeaveRetries = 0;
        }
        var leaveRequestId = requestIdOverride || pendingLeaveRequestId || generateRequestId();
        var leaveResult = await apiPost(LEAVE_URL, { tableId: tableId, requestId: leaveRequestId });
        if (isPendingResponse(leaveResult)){
          scheduleRetry(retryLeave);
          return;
        }
        pendingLeaveRequestId = null;
        pendingLeaveRetries = 0;
        loadTable();
      } catch (err){
        pendingLeaveRequestId = null;
        pendingLeaveRetries = 0;
        if (isAuthError(err)){
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
        klog('poker_leave_error', { tableId: tableId, error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrLeave', 'Failed to leave'));
      } finally {
        if (!pendingLeaveRequestId){
          setLoading(joinBtn, false);
          setLoading(leaveBtn, false);
        }
      }
    }

    function handleVisibility(){
      if (document.visibilityState === 'hidden'){
        stopPolling();
        stopHeartbeat();
      } else {
        state.pollInterval = POLL_INTERVAL_BASE;
        state.pollErrors = 0;
        startPolling();
        startHeartbeat();
        loadTable(false);
      }
    }

    if (joinBtn) joinBtn.addEventListener('click', joinTable);
    if (leaveBtn) leaveBtn.addEventListener('click', leaveTable);
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
