(function(){
  if (typeof window === 'undefined') return;

  var DEFAULT_MINT_URL = '/.netlify/functions/ws-mint-token';
  var COMMAND_TIMEOUT_MS = 12000;

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {});
    } catch (_err){}
  }

  function buildRequestId(){
    var rand = Math.random().toString(16).slice(2, 10);
    return 'ws_' + Date.now().toString(16) + '_' + rand;
  }

  function nonEmptyString(value){
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function resolveWsUrl(){
    var buildInfo = window.BUILD_INFO && typeof window.BUILD_INFO === 'object' ? window.BUILD_INFO : null;
    var defaultUrl = nonEmptyString(window.__POKER_WS_URL)
      || nonEmptyString(window.__POKER_WS_ENDPOINT)
      || nonEmptyString(buildInfo && buildInfo.pokerWsUrl)
      || 'wss://ws.kcswh.pl/ws';
    var previewUrl = nonEmptyString(buildInfo && buildInfo.pokerWsPreviewUrl);

    if (buildInfo && buildInfo.isPreview === true && previewUrl) {
      return previewUrl;
    }

    return defaultUrl;
  }

  function safeErrorCode(err){ return err && (err.code || err.message) ? (err.code || err.message) : 'unknown_error'; }
  function createError(code, message){ var e = new Error(message || code || 'ws_error'); e.code = code || 'ws_error'; return e; }
  function sanitizeText(value){
    if (value == null) return null;
    var text = String(value);
    if (!text) return null;
    return text.length > 240 ? text.slice(0, 240) : text;
  }
  function safeReadyState(socket){
    return socket && typeof socket.readyState === 'number' ? socket.readyState : null;
  }
  function summarizeFrame(type, payload, requestId, roomId, tableId){
    var summary = {
      type: typeof type === 'string' ? type : null,
      requestId: requestId || null,
      roomId: roomId || null,
      tableId: tableId || null
    };
    if (payload && typeof payload === 'object' && !Array.isArray(payload)){
      var keys = Object.keys(payload);
      summary.payloadKeys = keys.slice(0, 12);
      summary.payloadKeyCount = keys.length;
    }
    if (summary.type === 'auth') summary.payloadKeys = ['token_redacted'];
    return summary;
  }

  function createClient(opts){
    var options = opts || {};
    var mode = options.mode === 'lobby' ? 'lobby' : 'table';
    var tableId = typeof options.tableId === 'string' ? options.tableId.trim() : '';
    var getAccessToken = typeof options.getAccessToken === 'function' ? options.getAccessToken : null;
    var onStatus = typeof options.onStatus === 'function' ? options.onStatus : function(){};
    var onSnapshot = typeof options.onSnapshot === 'function' ? options.onSnapshot : function(){};
    var onLobbySnapshot = typeof options.onLobbySnapshot === 'function' ? options.onLobbySnapshot : function(){};
    var onProtocolError = typeof options.onProtocolError === 'function' ? options.onProtocolError : function(){};
    var log = typeof options.klog === 'function' ? options.klog : klog;
    var mintUrl = typeof options.mintUrl === 'string' && options.mintUrl ? options.mintUrl : DEFAULT_MINT_URL;
    var ws = null;
    var destroyed = false;
    var started = false;
    var authOk = false;
    var initialSnapshotDelivered = false;
    var initialLobbySnapshotDelivered = false;
    var pending = new Map();

    function emitStatus(status, data){ try { onStatus(status, data || {}); } catch (_err){} }
    function emitProtocolError(code, detail){ try { onProtocolError({ code: code, detail: detail || null }); } catch (_err){} }

    function send(type, payload, requestId){
      if (!ws || ws.readyState !== 1) return null;
      var rid = requestId || buildRequestId();
      var envelope = { version: '1.0', type: type, requestId: rid, ts: new Date().toISOString(), payload: payload || {} };
      if (tableId) envelope.roomId = tableId;
      log('poker_ws_send', summarizeFrame(envelope.type, envelope.payload, envelope.requestId, envelope.roomId || null, tableId || null));
      ws.send(JSON.stringify(envelope));
      return rid;
    }

    function rejectAllPending(code){
      pending.forEach(function(entry){
        clearTimeout(entry.timer);
        entry.reject(createError(code || 'ws_closed'));
      });
      pending.clear();
    }

    function sendCommand(type, payload, requestId){
      if (!authOk || !ws || ws.readyState !== 1) return Promise.reject(createError('ws_unavailable'));
      var rid = send(type, payload, requestId || null);
      if (!rid) return Promise.reject(createError('ws_unavailable'));
      return new Promise(function(resolve, reject){
        var timer = setTimeout(function(){
          pending.delete(rid);
          reject(createError('timeout'));
        }, COMMAND_TIMEOUT_MS);
        pending.set(rid, { resolve: resolve, reject: reject, timer: timer, type: type });
      });
    }

    function queueCommand(type, payload, requestId){
      if (!authOk || !ws || ws.readyState !== 1) throw createError('ws_unavailable');
      var rid = send(type, payload, requestId || null);
      if (!rid) throw createError('ws_unavailable');
      return rid;
    }

    function isSnapshotFrameType(type){
      return type === 'table_state' || type === 'stateSnapshot' || type === 'statePatch';
    }

    function normalizeSnapshot(frame, initial){
      if (!frame || typeof frame !== 'object') return null;
      if (isSnapshotFrameType(frame.type)) return { kind: frame.type, payload: frame.payload || {}, rawType: frame.type, initial: initial === true };
      return null;
    }

    async function mintAndAuth(){
      if (!getAccessToken) throw new Error('missing_access_token_provider');
      var accessToken = await getAccessToken();
      if (!accessToken) throw new Error('missing_access_token');
      emitStatus('minting_token', {});
      var mintRes = await fetch(mintUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: '{}' });
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

    function requestLiveState(){
      if (!authOk) return null;
      if (mode === 'lobby') return send('lobby_subscribe', {});
      return send('table_state_sub', { tableId: tableId });
    }
    function requestGameplaySnapshot(){
      if (mode === 'lobby') return null;
      if (!authOk || !ws || ws.readyState !== 1) return null;
      return send('table_state_sub', { tableId: tableId, view: 'snapshot' });
    }
    function requestLobbySnapshot(){
      if (mode !== 'lobby') return null;
      if (!authOk || !ws || ws.readyState !== 1) return null;
      return send('lobby_subscribe', {});
    }
    function requestResync(payload){
      if (mode === 'lobby') return null;
      if (!authOk || !ws || ws.readyState !== 1) return null;
      var body = payload && typeof payload === 'object' ? payload : {};
      return send('resync', {
        tableId: tableId,
        reason: typeof body.reason === 'string' && body.reason ? body.reason : null
      });
    }

    function handleCommandResult(frame){
      var payload = frame && frame.payload ? frame.payload : {};
      var rid = payload.requestId || frame.requestId || null;
      if (!rid || !pending.has(rid)) return;
      var entry = pending.get(rid);
      pending.delete(rid);
      clearTimeout(entry.timer);
      if (payload.status === 'accepted') {
        var resolved = { ok: true, requestId: rid, reason: payload.reason || null };
        Object.keys(payload).forEach(function(key){
          if (key === 'status') return;
          resolved[key] = payload[key];
        });
        entry.resolve(resolved);
        return;
      }
      entry.reject(createError(payload.reason || 'rejected'));
    }

    function handleMessage(frame){
      if (!frame || typeof frame !== 'object' || !frame.type) return;
      log('poker_ws_recv', summarizeFrame(frame.type, frame.payload || null, frame.requestId || null, frame.roomId || null, tableId || null));
      if (frame.type === 'helloAck') { emitStatus('hello_ack', {}); mintAndAuth().catch(function(err){ var code = safeErrorCode(err); log('poker_ws_auth_error', { tableId: tableId, code: code }); emitStatus('failed', { stage: 'auth', code: code }); emitProtocolError(code, 'auth_failed'); destroy(); }); return; }
      if (frame.type === 'authOk') { authOk = true; emitStatus('auth_ok', { roomId: frame.payload && frame.payload.roomId ? frame.payload.roomId : null }); requestLiveState(); return; }
      if (frame.type === 'lobby_snapshot') {
        var initialLobby = !initialLobbySnapshotDelivered;
        initialLobbySnapshotDelivered = true;
        try {
          onLobbySnapshot({
            kind: 'lobby_snapshot',
            payload: frame.payload || {},
            rawType: frame.type,
            initial: initialLobby
          });
        } catch (_err){}
        return;
      }
      if (isSnapshotFrameType(frame.type)) { var initial = !initialSnapshotDelivered; initialSnapshotDelivered = true; var normalized = normalizeSnapshot(frame, initial); if (normalized) onSnapshot(normalized); return; }
      if (frame.type === 'commandResult') { handleCommandResult(frame); emitStatus('command_result', { status: frame.payload && frame.payload.status ? frame.payload.status : null, reason: frame.payload && frame.payload.reason ? frame.payload.reason : null }); return; }
      if (frame.type === 'resync') {
        emitStatus('resync', {
          reason: frame.payload && frame.payload.reason ? frame.payload.reason : null,
          mode: frame.payload && frame.payload.mode ? frame.payload.mode : null
        });
        if (!requestResync({ reason: frame.payload && frame.payload.reason ? frame.payload.reason : null })) {
          emitProtocolError('resync_required', frame.payload && frame.payload.reason ? frame.payload.reason : null);
        }
        return;
      }
      if (frame.type === 'error') {
        var rid = frame.requestId || (frame.payload && frame.payload.requestId) || null;
        if (rid && pending.has(rid)) {
          var entry = pending.get(rid); pending.delete(rid); clearTimeout(entry.timer); entry.reject(createError(frame.payload && frame.payload.code ? frame.payload.code : 'ws_error'));
        }
        var code = frame.payload && frame.payload.code ? frame.payload.code : 'ws_error'; emitStatus('error', { code: code }); emitProtocolError(code, frame.payload && frame.payload.message ? frame.payload.message : null);
      }
    }

    function start(){
      if (destroyed || started) return;
      if (mode !== 'lobby' && !tableId){ emitProtocolError('missing_table_id'); return; }
      if (typeof window.WebSocket !== 'function'){ emitProtocolError('ws_unavailable'); return; }
      log('poker_ws_bootstrap_begin', { tableId: tableId });
      var wsUrl = resolveWsUrl();
      log('poker_ws_url_resolved', { tableId: tableId, url: wsUrl });
      started = true;
      log('poker_ws_ctor', { tableId: tableId, url: wsUrl });
      try {
        ws = new window.WebSocket(wsUrl);
      } catch (err) {
        started = false;
        log('poker_ws_exception', {
          tableId: tableId,
          phase: 'ws_ctor',
          message: sanitizeText(err && (err.message || err.code)),
          stack: sanitizeText(err && err.stack)
        });
        throw err;
      }
      ws.onopen = function(){ log('poker_ws_open', { tableId: tableId, readyState: safeReadyState(ws) }); send('hello', { supportedVersions: ['1.0'], client: { name: 'poker-ui', build: 'ws-authoritative' } }); };
      ws.onmessage = function(evt){ var frame = null; try { frame = JSON.parse(evt && evt.data ? evt.data : '{}'); } catch (_err){ emitProtocolError('invalid_json'); return; } handleMessage(frame); };
      ws.onerror = function(evt){ log('poker_ws_error', { tableId: tableId, readyState: safeReadyState(ws), message: sanitizeText(evt && evt.message) }); emitStatus('failed', { stage: 'socket', code: 'socket_error' }); };
      ws.onclose = function(evt){ authOk = false; rejectAllPending('ws_closed'); log('poker_ws_close', { tableId: tableId, readyState: safeReadyState(ws), code: evt && typeof evt.code === 'number' ? evt.code : null, reason: sanitizeText(evt && evt.reason), wasClean: !!(evt && evt.wasClean) }); emitStatus('closed', { code: evt && evt.code ? evt.code : null }); };
    }

    function destroy(){ log('poker_ws_destroy', { tableId: tableId, readyState: safeReadyState(ws) }); destroyed = true; started = false; authOk = false; rejectAllPending('ws_closed'); if (ws && ws.readyState <= 1){ try { ws.close(1000, 'client_shutdown'); } catch (_err){} } ws = null; }

    return {
      start: start,
      destroy: destroy,
      isReady: function(){ return !!authOk && !!ws && ws.readyState === 1; },
      requestLobbySnapshot: requestLobbySnapshot,
      requestGameplaySnapshot: requestGameplaySnapshot,
      requestResync: requestResync,
      sendAct: function(payload, requestId){ return sendCommand('act', payload || {}, requestId); },
      sendJoin: function(payload, requestId){ return sendCommand('join', payload || { tableId: tableId }, requestId); },
      sendLeave: function(payload, requestId){ return sendCommand('leave', payload || { tableId: tableId }, requestId); },
      sendLeaveQueued: function(payload, requestId){ return queueCommand('leave', payload || { tableId: tableId }, requestId); },
      sendStartHand: function(payload, requestId){ return sendCommand('start_hand', payload || { tableId: tableId }, requestId); }
    };
  }

  window.PokerWsClient = window.PokerWsClient || {};
  window.PokerWsClient.create = createClient;
})();
