(function(){
  if (typeof window === 'undefined') return;

  var DEFAULT_MINT_URL = '/.netlify/functions/ws-mint-token';

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function buildRequestId(){
    var rand = Math.random().toString(16).slice(2, 10);
    return 'ws_' + Date.now().toString(16) + '_' + rand;
  }

  function resolveWsUrl(){
    if (typeof window.__POKER_WS_URL === 'string' && window.__POKER_WS_URL.trim()) return window.__POKER_WS_URL.trim();
    if (typeof window.__POKER_WS_ENDPOINT === 'string' && window.__POKER_WS_ENDPOINT.trim()) return window.__POKER_WS_ENDPOINT.trim();
    return 'wss://ws.kcswh.pl/ws';
  }

  function safeErrorCode(err){
    if (!err) return 'unknown_error';
    return err.code || err.message || 'unknown_error';
  }

  function createClient(opts){
    var options = opts || {};
    var tableId = typeof options.tableId === 'string' ? options.tableId.trim() : '';
    var getAccessToken = typeof options.getAccessToken === 'function' ? options.getAccessToken : null;
    var onStatus = typeof options.onStatus === 'function' ? options.onStatus : function(){};
    var onSnapshot = typeof options.onSnapshot === 'function' ? options.onSnapshot : function(){};
    var onProtocolError = typeof options.onProtocolError === 'function' ? options.onProtocolError : function(){};
    var log = typeof options.klog === 'function' ? options.klog : klog;
    var mintUrl = typeof options.mintUrl === 'string' && options.mintUrl ? options.mintUrl : DEFAULT_MINT_URL;
    var ws = null;
    var destroyed = false;
    var started = false;
    var authOk = false;
    var initialSnapshotDelivered = false;
    var pendingCommandsByRequestId = new Map();

    function emitStatus(status, data){
      try { onStatus(status, data || {}); } catch (_err){}
    }

    function emitProtocolError(code, detail){
      try { onProtocolError({ code: code, detail: detail || null }); } catch (_err){}
    }

    function send(type, payload, requestIdOverride){
      if (!ws || ws.readyState !== 1) return false;
      var roomId = tableId ? tableId : null;
      var requestId = typeof requestIdOverride === 'string' && requestIdOverride.trim() ? requestIdOverride.trim() : buildRequestId();
      var envelope = {
        version: '1.0',
        type: type,
        requestId: requestId,
        ts: new Date().toISOString(),
        payload: payload || {}
      };
      if (roomId) envelope.roomId = roomId;
      ws.send(JSON.stringify(envelope));
      return requestId;
    }

    function rejectPendingCommands(reasonCode){
      var code = reasonCode || 'connection_closed';
      pendingCommandsByRequestId.forEach(function(entry){
        if (!entry || typeof entry.reject !== 'function') return;
        var err = new Error(code);
        err.code = code;
        entry.reject(err);
      });
      pendingCommandsByRequestId.clear();
    }

    function sendAct(command){
      var payload = command && typeof command === 'object' ? command : {};
      var handId = typeof payload.handId === 'string' ? payload.handId.trim() : '';
      var action = typeof payload.action === 'string' ? payload.action.trim().toUpperCase() : '';
      var requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
      if (!authOk || !ws || ws.readyState !== 1){
        var notReadyErr = new Error('ws_unavailable');
        notReadyErr.code = 'ws_unavailable';
        return Promise.reject(notReadyErr);
      }
      if (!requestId || !handId || !action){
        var invalidErr = new Error('invalid_command');
        invalidErr.code = 'invalid_command';
        return Promise.reject(invalidErr);
      }

      return new Promise(function(resolve, reject){
        var sentRequestId = send('act', {
          tableId: tableId,
          handId: handId,
          action: action,
          amount: payload.amount
        }, requestId);

        if (!sentRequestId){
          var sendErr = new Error('ws_unavailable');
          sendErr.code = 'ws_unavailable';
          reject(sendErr);
          return;
        }

        pendingCommandsByRequestId.set(sentRequestId, {
          resolve: resolve,
          reject: reject
        });
      });
    }

    function normalizeSnapshot(frame, initial){
      if (!frame || typeof frame !== 'object') return null;
      if (frame.type === 'table_state'){
        return { kind: 'table_state', payload: frame.payload || {}, rawType: frame.type, initial: initial === true };
      }
      return null;
    }

    async function mintAndAuth(){
      if (!getAccessToken){
        throw new Error('missing_access_token_provider');
      }
      var accessToken = await getAccessToken();
      if (!accessToken){
        throw new Error('missing_access_token');
      }
      emitStatus('minting_token', {});
      var mintRes = await fetch(mintUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
      var mintBody = {};
      try { mintBody = await mintRes.json(); } catch (_err){}
      if (!mintRes.ok || !mintBody || mintBody.ok !== true || typeof mintBody.token !== 'string' || !mintBody.token){
        var mintErr = new Error(mintBody && mintBody.error ? mintBody.error : 'mint_failed');
        mintErr.code = mintBody && mintBody.error ? mintBody.error : 'mint_failed';
        throw mintErr;
      }
      emitStatus('authenticating', { mode: mintBody.mode || null });
      send('auth', { token: mintBody.token });
    }

    function requestSnapshot(){
      if (!authOk) return;
      emitStatus('requesting_snapshot', { tableId: tableId });
      send('table_state_sub', { tableId: tableId });
    }

    function handleMessage(frame){
      if (!frame || typeof frame !== 'object' || !frame.type) return;
      if (frame.type === 'helloAck'){
        emitStatus('hello_ack', {});
        mintAndAuth().catch(function(err){
          var code = safeErrorCode(err);
          log('poker_ws_auth_error', { tableId: tableId, code: code });
          emitStatus('failed', { stage: 'auth', code: code });
          emitProtocolError(code, 'auth_failed');
          destroy();
        });
        return;
      }
      if (frame.type === 'authOk'){
        authOk = true;
        emitStatus('auth_ok', { roomId: frame.payload && frame.payload.roomId ? frame.payload.roomId : null });
        requestSnapshot();
        return;
      }
      if (frame.type === 'table_state'){
        var isInitialSnapshot = !initialSnapshotDelivered;
        initialSnapshotDelivered = true;
        emitStatus('snapshot', { type: frame.type });
        var normalized = normalizeSnapshot(frame, isInitialSnapshot);
        if (normalized) onSnapshot(normalized);
        return;
      }
      if (frame.type === 'commandResult'){
        var commandRequestId = typeof frame.requestId === 'string' && frame.requestId.trim() ? frame.requestId.trim() : (frame.payload && typeof frame.payload.requestId === 'string' ? frame.payload.requestId.trim() : '');
        if (commandRequestId && pendingCommandsByRequestId.has(commandRequestId)){
          var pending = pendingCommandsByRequestId.get(commandRequestId);
          pendingCommandsByRequestId.delete(commandRequestId);
          if (frame.payload && frame.payload.status === 'accepted'){
            pending.resolve({ ok: true, status: 'accepted', reason: null, requestId: commandRequestId });
          } else {
            var rejectedCode = frame.payload && frame.payload.reason ? frame.payload.reason : 'command_rejected';
            var rejectedErr = new Error(rejectedCode);
            rejectedErr.code = rejectedCode;
            pending.reject(rejectedErr);
          }
        }
        emitStatus('command_result', {
          status: frame.payload && frame.payload.status ? frame.payload.status : null,
          reason: frame.payload && frame.payload.reason ? frame.payload.reason : null
        });
        return;
      }
      if (frame.type === 'resync'){
        emitStatus('resync', { reason: frame.payload && frame.payload.reason ? frame.payload.reason : null });
        emitProtocolError('resync_required', frame.payload && frame.payload.reason ? frame.payload.reason : null);
        return;
      }
      if (frame.type === 'pong'){
        emitStatus('pong', {});
        return;
      }
      if (frame.type === 'error'){
        var code = frame.payload && frame.payload.code ? frame.payload.code : 'ws_error';
        var errorRequestId = typeof frame.requestId === 'string' && frame.requestId.trim() ? frame.requestId.trim() : '';
        if (errorRequestId && pendingCommandsByRequestId.has(errorRequestId)){
          var pendingError = pendingCommandsByRequestId.get(errorRequestId);
          pendingCommandsByRequestId.delete(errorRequestId);
          var commandErr = new Error(code);
          commandErr.code = code;
          pendingError.reject(commandErr);
        }
        emitStatus('error', { code: code });
        emitProtocolError(code, frame.payload && frame.payload.message ? frame.payload.message : null);
      }
    }

    function start(){
      if (destroyed || started) return;
      if (!tableId){
        emitProtocolError('missing_table_id');
        return;
      }
      if (typeof window.WebSocket !== 'function'){
        emitProtocolError('ws_unavailable');
        return;
      }
      started = true;
      var wsUrl = resolveWsUrl();
      emitStatus('connecting', { host: wsUrl });
      ws = new window.WebSocket(wsUrl);
      ws.onopen = function(){
        emitStatus('open', {});
        send('hello', {
          supportedVersions: ['1.0'],
          client: { name: 'poker-ui', build: 'pr1-ws-bootstrap' }
        });
      };
      ws.onmessage = function(evt){
        var frame = null;
        try {
          frame = JSON.parse(evt && evt.data ? evt.data : '{}');
        } catch (_err){
          emitProtocolError('invalid_json');
          return;
        }
        handleMessage(frame);
      };
      ws.onerror = function(){
        emitStatus('failed', { stage: 'socket', code: 'socket_error' });
      };
      ws.onclose = function(evt){
        rejectPendingCommands('connection_closed');
        emitStatus('closed', { code: evt && evt.code ? evt.code : null });
      };
    }

    function destroy(){
      destroyed = true;
      started = false;
      authOk = false;
      rejectPendingCommands('client_shutdown');
      if (ws && ws.readyState <= 1){
        try { ws.close(1000, 'client_shutdown'); } catch (_err){}
      }
      ws = null;
    }

    return {
      start: start,
      destroy: destroy,
      sendAct: sendAct
    };
  }

  window.PokerWsClient = window.PokerWsClient || {};
  window.PokerWsClient.create = createClient;
})();
