(function(){
  if (typeof window === 'undefined') return;

  var warnedMissingClient = false;

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function logOnceMissing(){
    if (warnedMissingClient) return;
    warnedMissingClient = true;
    klog('poker_rt_missing_client', { message: 'supabaseClient missing' });
  }

  function subscribeToTableActions(opts){
    var options = opts || {};
    var tableId = typeof options.tableId === 'string' ? options.tableId.trim() : '';
    var onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    var log = typeof options.klog === 'function' ? options.klog : klog;
    var throttleMs = typeof options.throttleMs === 'number' && options.throttleMs >= 100 ? options.throttleMs : 600;
    var eventSampleRate = typeof options.eventSampleRate === 'number' ? options.eventSampleRate : 0.2;
    var channel = null;
    var stopped = false;
    var lastEventAt = 0;
    var pendingTimer = null;
    var pendingPayload = null;

    function logEvent(kind, data){
      try {
        log(kind, data || {});
      } catch (_err){}
    }

    function emitEvent(payload){
      if (stopped) return;
      if (typeof onEvent !== 'function') return;
      try {
        onEvent(payload);
      } catch (_err){}
    }

    function trigger(payload){
      var now = Date.now();
      if (!lastEventAt || now - lastEventAt >= throttleMs){
        lastEventAt = now;
        emitEvent(payload);
        return;
      }
      pendingPayload = payload;
      if (pendingTimer) return;
      var delay = Math.max(0, throttleMs - (now - lastEventAt));
      pendingTimer = setTimeout(function(){
        pendingTimer = null;
        lastEventAt = Date.now();
        var nextPayload = pendingPayload;
        pendingPayload = null;
        emitEvent(nextPayload);
      }, delay);
    }

    function handlePayload(payload){
      if (Math.random() < eventSampleRate){
        logEvent('poker_rt_event', {
          tableId: tableId,
          type: payload && payload.eventType ? payload.eventType : null,
          commit_timestamp: payload && payload.commit_timestamp ? payload.commit_timestamp : null
        });
      }
      trigger(payload);
    }

    function start(){
      if (stopped) return;
      if (!tableId){
        logEvent('poker_rt_subscribe_error', { tableId: tableId, message: 'missing_table_id' });
        return;
      }
      if (!window.supabaseClient){
        logOnceMissing();
        return;
      }
      if (channel) return;
      var filter = 'table_id=eq.' + tableId;
      channel = window.supabaseClient.channel('poker_actions:' + tableId);
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poker_actions', filter: filter }, handlePayload);
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'poker_actions', filter: filter }, handlePayload);
      channel.subscribe(function(status, err){
        if (status === 'SUBSCRIBED'){
          logEvent('poker_rt_subscribe_ok', { tableId: tableId });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
          var message = err && (err.message || err.code) ? err.message || err.code : status;
          logEvent('poker_rt_subscribe_error', { tableId: tableId, message: message });
        }
      });
    }

    function stop(){
      stopped = true;
      if (pendingTimer){
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingPayload = null;
      if (channel && window.supabaseClient){
        try {
          window.supabaseClient.removeChannel(channel);
        } catch (_err){}
      }
      channel = null;
      logEvent('poker_rt_unsubscribe', { tableId: tableId });
    }

    start();
    return { start: start, stop: stop };
  }

  window.PokerRealtime = window.PokerRealtime || {};
  window.PokerRealtime.subscribeToTableActions = subscribeToTableActions;
})();
