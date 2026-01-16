(function(){
  if (typeof window === 'undefined') return;

  var LIST_URL = '/.netlify/functions/poker-list-tables';
  var CREATE_URL = '/.netlify/functions/poker-create-table';
  var GET_URL = '/.netlify/functions/poker-get-table';
  var JOIN_URL = '/.netlify/functions/poker-join';
  var LEAVE_URL = '/.netlify/functions/poker-leave';
  var POLL_INTERVAL_BASE = 2000;
  var POLL_INTERVAL_MAX = 10000;

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

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        if (authMsg) authMsg.hidden = false;
        if (lobbyContent) lobbyContent.hidden = true;
        return false;
      }
      if (authMsg) authMsg.hidden = true;
      if (lobbyContent) lobbyContent.hidden = false;
      return true;
    }

    async function loadTables(){
      setError(errorEl, null);
      if (tableList) tableList.innerHTML = '<div class="poker-loading">Loading...</div>';
      try {
        var data = await apiGet(LIST_URL + '?status=OPEN&limit=20');
        renderTables(data.tables || []);
      } catch (err){
        klog('poker_lobby_load_error', { error: err.message || err.code });
        setError(errorEl, err.message || 'Failed to load tables');
        if (tableList) tableList.innerHTML = '';
      }
    }

    function renderTables(tables){
      if (!tableList) return;
      if (!tables || tables.length === 0){
        tableList.innerHTML = '<div class="poker-loading">No open tables</div>';
        return;
      }
      tableList.innerHTML = '';
      tables.forEach(function(t){
        var row = document.createElement('div');
        row.className = 'poker-table-row';
        var stakes = t.stakes || {};
        row.innerHTML = '<span class="tid">' + shortId(t.id) + '</span>' +
          '<span class="stakes">' + (stakes.sb || 0) + '/' + (stakes.bb || 0) + '</span>' +
          '<span class="seats">' + (t.seatCount || 0) + '/' + (t.maxPlayers || 6) + '</span>' +
          '<span class="status">' + (t.status || 'OPEN') + '</span>' +
          '<button class="poker-btn" data-open="' + t.id + '">Open</button>';
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
          setError(errorEl, 'Table created but no ID returned');
        }
      } catch (err){
        klog('poker_create_error', { error: err.message || err.code });
        setError(errorEl, err.message || 'Failed to create table');
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
        loadTables();
      });
    }
    if (createBtn){
      createBtn.addEventListener('click', createTable);
    }
    if (tableList){
      tableList.addEventListener('click', handleClick);
    }

    checkAuth().then(function(authed){
      if (authed) loadTables();
    });
  }

  // ========== TABLE PAGE ==========
  function initTable(){
    var params = new URLSearchParams(window.location.search);
    var tableId = params.get('tableId');
    if (!tableId){
      document.body.innerHTML = '<div class="poker-page"><p class="poker-error">No tableId provided</p><a href="/poker/" class="poker-back">&larr; Back to lobby</a></div>';
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

    var currentUserId = null;
    var tableData = null;

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        if (authMsg) authMsg.hidden = false;
        if (tableContent) tableContent.hidden = true;
        return false;
      }
      currentUserId = getUserIdFromToken(token);
      if (authMsg) authMsg.hidden = true;
      if (tableContent) tableContent.hidden = false;
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
        klog('poker_table_load_error', { tableId: tableId, error: err.message || err.code });
        setError(errorEl, err.message || 'Failed to load table');
        if (isPolling){ increasePollBackoff(); }
      }
    }

    function resetPollBackoff(){
      state.pollErrors = 0;
      if (state.pollInterval !== POLL_INTERVAL_BASE){
        state.pollInterval = POLL_INTERVAL_BASE;
        restartPolling();
      }
    }

    function increasePollBackoff(){
      state.pollErrors++;
      if (state.pollErrors >= 2){
        var newInterval = Math.min(state.pollInterval * 2, POLL_INTERVAL_MAX);
        if (newInterval !== state.pollInterval){
          state.pollInterval = newInterval;
          restartPolling();
        }
      }
    }

    function restartPolling(){
      if (!state.polling) return;
      stopPolling();
      startPolling();
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

      var maxPlayers = table.max_players || 6;
      if (seatsGrid){
        seatsGrid.innerHTML = '';
        for (var i = 0; i < maxPlayers; i++){
          var seat = seats.find(function(s){ return s.seatNo === i; });
          var div = document.createElement('div');
          div.className = 'poker-seat' + (seat ? '' : ' poker-seat--empty');
          div.innerHTML = '<div class="poker-seat-no">Seat ' + i + '</div>' +
            '<div class="poker-seat-user">' + (seat ? shortId(seat.userId) : 'Empty') + '</div>';
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

    async function joinTable(){
      setError(errorEl, null);
      var seatNo = parseInt(seatNoInput ? seatNoInput.value : 0, 10);
      var buyIn = parseInt(buyInInput ? buyInInput.value : 100, 10) || 100;
      if (seatNo < 0 || isNaN(seatNo)) seatNo = 0;
      setLoading(joinBtn, true);
      setLoading(leaveBtn, true);
      try {
        await apiPost(JOIN_URL, { tableId: tableId, seatNo: seatNo, buyIn: buyIn, requestId: generateRequestId() });
        loadTable();
      } catch (err){
        klog('poker_join_error', { tableId: tableId, error: err.message || err.code });
        setError(errorEl, err.message || 'Failed to join');
      } finally {
        setLoading(joinBtn, false);
        setLoading(leaveBtn, false);
      }
    }

    async function leaveTable(){
      setError(errorEl, null);
      setLoading(joinBtn, true);
      setLoading(leaveBtn, true);
      try {
        await apiPost(LEAVE_URL, { tableId: tableId, requestId: generateRequestId() });
        loadTable();
      } catch (err){
        klog('poker_leave_error', { tableId: tableId, error: err.message || err.code });
        setError(errorEl, err.message || 'Failed to leave');
      } finally {
        setLoading(joinBtn, false);
        setLoading(leaveBtn, false);
      }
    }

    function startPolling(){
      if (state.polling) return;
      state.polling = true;
      state.pollTimer = setInterval(function(){
        if (document.visibilityState === 'hidden') return;
        loadTable(true);
      }, state.pollInterval);
    }

    function stopPolling(){
      state.polling = false;
      if (state.pollTimer){
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    }

    function handleVisibility(){
      if (document.visibilityState === 'hidden'){
        stopPolling();
      } else {
        state.pollInterval = POLL_INTERVAL_BASE;
        state.pollErrors = 0;
        startPolling();
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

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', stopPolling);

    checkAuth().then(function(authed){
      if (authed){
        loadTable(false);
        startPolling();
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
