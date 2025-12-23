(function(){
  if (typeof window === 'undefined') return;

  var BALANCE_URL = '/.netlify/functions/chips-balance';
  var LEDGER_URL = '/.netlify/functions/chips-ledger';
  var TX_URL = '/.netlify/functions/chips-tx';
  var AUTH_CACHE_MS = 60000;

  var state = { token: null, checkedAt: 0, tokenPromise: null };

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
        return;
      }
    } catch (_err){}

    if (window && window.XP_DIAG && typeof console !== 'undefined' && console && typeof console.debug === 'function'){
      try { console.debug('[chips]', kind, data || {}); } catch (_err2){}
    }
  }

  function getSupabaseClient(){
    if (!window) return null;
    var client = window.supabaseClient;
    if (client && client.auth) return client;
    return null;
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

  function emit(name, detail){
    if (typeof document === 'undefined' || !document || typeof document.dispatchEvent !== 'function') return;
    try {
      document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (_err){}
  }

  async function fetchAuthToken(force){
    var now = Date.now();
    if (!force && state.token && (now - state.checkedAt) < AUTH_CACHE_MS){
      return state.token;
    }

    if (!force && state.tokenPromise){
      return state.tokenPromise;
    }

    state.tokenPromise = (async function(){
      try {
        var token = null;
        var bridge = getAuthBridge();
        var getter = bridge && typeof bridge.getAccessToken === 'function' ? bridge.getAccessToken : null;
        if (getter){
          token = await getter();
          klog('chips:auth_bridge', { hasToken: !!token });
        }

        if (!token){
          var client = getSupabaseClient();
          if (client && client.auth && typeof client.auth.getSession === 'function'){
            var res = await client.auth.getSession();
            var session = res && res.data ? res.data.session : null;
            token = session && session.access_token ? session.access_token : null;
            klog('chips:auth_client', { hasToken: !!token });
          }
        }

        state.token = token || null;
        state.checkedAt = Date.now();
        return state.token;
      } catch (_err){
        state.token = null;
        state.checkedAt = Date.now();
        return null;
      } finally {
        state.tokenPromise = null;
      }
    })();

    return state.tokenPromise;
  }

  async function authedFetch(url, options){
    var token = await fetchAuthToken();
    if (!token){
      var err = new Error('not_authenticated');
      err.code = 'not_authenticated';
      throw err;
    }

    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    headers.Authorization = headers.Authorization || ('Bearer ' + token);
    if (opts.body && !headers['Content-Type'] && !headers['content-type']){
      headers['Content-Type'] = 'application/json';
    }

    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  async function parseResponse(res){
    var body = {};
    try {
      body = await res.json();
    } catch (_err){}
    var payload = { status: res.status, ok: res.ok, data: body || {} };
    if (res.status === 404){ payload.disabled = true; }
    if (res.ok){ return payload; }

    var err = new Error(payload.data && payload.data.error ? String(payload.data.error) : 'request_failed');
    err.status = res.status;
    err.code = payload.data && payload.data.error ? payload.data.error : 'request_failed';
    err.payload = payload.data;
    throw err;
  }

  async function fetchBalance(){
    var res = await authedFetch(BALANCE_URL, { method: 'GET' });
    var payload = await parseResponse(res);
    emit('chips:balance', payload.data);
    return payload.data;
  }

  async function fetchLedger(options){
    var params = [];
    if (options && Number.isInteger(options.after)){
      params.push('after=' + encodeURIComponent(options.after));
    }
    if (options && Number.isInteger(options.limit)){
      params.push('limit=' + encodeURIComponent(options.limit));
    }
    var url = params.length ? (LEDGER_URL + '?' + params.join('&')) : LEDGER_URL;
    var res = await authedFetch(url, { method: 'GET' });
    var payload = await parseResponse(res);
    emit('chips:ledger', payload.data);
    return payload.data;
  }

  async function postTransaction(input){
    var res = await authedFetch(TX_URL, { method: 'POST', body: JSON.stringify(input || {}) });
    var payload = await parseResponse(res);
    emit('chips:tx-complete', payload.data);
    return payload.data;
  }

  async function fetchState(options){
    var limit = options && Number.isInteger(options.limit) ? options.limit : 10;
    var balance = await fetchBalance();
    var ledger = await fetchLedger({ limit: limit });
    var state = { balance: balance, ledger: ledger };
    emit('chips:state', state);
    return state;
  }

  window.ChipsClient = {
    fetchBalance: fetchBalance,
    fetchLedger: fetchLedger,
    postTransaction: postTransaction,
    fetchState: fetchState,
    refreshAuth: function(){ return fetchAuthToken(true); }
  };
})();
