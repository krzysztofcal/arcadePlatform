(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var nodes = {};
  var state = {
    adminUserId: null,
    selectedUser: null,
    draftIdempotencyKey: '',
    searchRequestId: 0,
    detailRequestId: 0,
  };

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function t(key, fallback){
    try {
      if (window.I18N && typeof window.I18N.t === 'function'){
        var value = window.I18N.t(key);
        if (value) return value;
      }
    } catch (_err){}
    return fallback || key;
  }

  function selectNodes(){
    nodes.status = doc.getElementById('adminStatus');
    nodes.unauthorized = doc.getElementById('adminUnauthorized');
    nodes.unauthorizedText = doc.getElementById('adminUnauthorizedText');
    nodes.app = doc.getElementById('adminApp');
    nodes.searchForm = doc.getElementById('adminSearchForm');
    nodes.searchInput = doc.getElementById('adminSearchInput');
    nodes.searchButton = doc.getElementById('adminSearchButton');
    nodes.searchResults = doc.getElementById('adminSearchResults');
    nodes.searchEmpty = doc.getElementById('adminSearchEmpty');
    nodes.selectedEmpty = doc.getElementById('adminSelectedEmpty');
    nodes.selectedPanel = doc.getElementById('adminSelectedPanel');
    nodes.userName = doc.getElementById('adminUserName');
    nodes.userEmail = doc.getElementById('adminUserEmail');
    nodes.userId = doc.getElementById('adminUserId');
    nodes.copyUserId = doc.getElementById('adminCopyUserId');
    nodes.balanceValue = doc.getElementById('adminBalanceValue');
    nodes.adjustForm = doc.getElementById('adminAdjustForm');
    nodes.amountInput = doc.getElementById('adminAmountInput');
    nodes.reasonInput = doc.getElementById('adminReasonInput');
    nodes.adjustSubmit = doc.getElementById('adminAdjustSubmit');
    nodes.quickButtons = Array.prototype.slice.call(doc.querySelectorAll('[data-amount]'));
    nodes.ledgerEmpty = doc.getElementById('adminLedgerEmpty');
    nodes.ledgerTable = doc.getElementById('adminLedgerTable');
    nodes.ledgerBody = doc.getElementById('adminLedgerBody');
  }

  function setVisible(node, value){
    if (!node) return;
    node.hidden = !value;
    node.style.display = value ? '' : 'none';
  }

  function setStatus(message, tone){
    if (!nodes.status) return;
    nodes.status.textContent = message || '';
    nodes.status.dataset.tone = tone || '';
    nodes.status.hidden = !message;
  }

  function resetDraftIdempotencyKey(){
    state.draftIdempotencyKey = '';
  }

  function createDraftIdempotencyKey(){
    return 'adm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getDraftIdempotencyKey(){
    if (!state.draftIdempotencyKey){
      state.draftIdempotencyKey = createDraftIdempotencyKey();
    }
    return state.draftIdempotencyKey;
  }

  function getAuthBridge(){
    if (window.SupabaseAuthBridge && typeof window.SupabaseAuthBridge.getAccessToken === 'function'){
      return window.SupabaseAuthBridge;
    }
    return null;
  }

  async function getAccessToken(){
    try {
      var bridge = getAuthBridge();
      if (bridge){
        return await bridge.getAccessToken();
      }
      if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.getSession === 'function'){
        var res = await window.supabaseClient.auth.getSession();
        var session = res && res.data ? res.data.session : null;
        return session && session.access_token ? session.access_token : null;
      }
    } catch (_err){}
    return null;
  }

  async function apiFetch(path, options){
    var token = await getAccessToken();
    if (!token){
      var authErr = new Error('unauthorized');
      authErr.status = 401;
      authErr.code = 'unauthorized';
      throw authErr;
    }
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
    if (opts.body && !headers['Content-Type'] && !headers['content-type']){
      headers['Content-Type'] = 'application/json';
    }
    var res = await fetch(path, Object.assign({}, opts, { headers: headers }));
    var data = {};
    try {
      data = await res.json();
    } catch (_err2){}
    if (!res.ok){
      var err = new Error(data && data.error ? String(data.error) : 'request_failed');
      err.status = res.status;
      err.code = data && data.error ? data.error : 'request_failed';
      err.payload = data || {};
      throw err;
    }
    return data || {};
  }

  function showUnauthorized(message){
    setVisible(nodes.app, false);
    setVisible(nodes.unauthorized, true);
    if (nodes.unauthorizedText){
      nodes.unauthorizedText.textContent = message || t('adminUnauthorized', 'This page is available only for allowlisted admin accounts.');
    }
    state.selectedUser = null;
    renderSelectedUser();
    renderSearchResults([]);
    renderLedger([]);
  }

  function showApp(){
    setVisible(nodes.unauthorized, false);
    setVisible(nodes.app, true);
  }

  function renderSelectedUser(){
    var user = state.selectedUser;
    setVisible(nodes.selectedPanel, !!user);
    setVisible(nodes.selectedEmpty, !user);
    if (!user) {
      if (nodes.balanceValue){ nodes.balanceValue.textContent = '—'; }
      return;
    }
    if (nodes.userName){ nodes.userName.textContent = user.displayName || user.email || user.userId || '—'; }
    if (nodes.userEmail){ nodes.userEmail.textContent = user.email || '—'; }
    if (nodes.userId){ nodes.userId.textContent = user.userId || '—'; }
  }

  function formatAmount(value){
    var amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return amount.toLocaleString();
  }

  function setSelectedBalance(value){
    if (nodes.balanceValue){
      nodes.balanceValue.textContent = formatAmount(value);
    }
  }

  function formatTimestamp(value){
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    var year = String(date.getFullYear());
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    var hour = String(date.getHours()).padStart(2, '0');
    var minute = String(date.getMinutes()).padStart(2, '0');
    return year + '-' + month + '-' + day + ' ' + hour + ':' + minute;
  }

  function describeEntry(entry){
    if (!entry) return '';
    var metadata = entry.metadata || {};
    var base = entry.description || metadata.reason || entry.reference || '';
    var parts = [];
    if (base){ parts.push(base); }
    if (metadata.admin_user_id){ parts.push('admin ' + metadata.admin_user_id); }
    return parts.join(' · ');
  }

  function renderLedger(items){
    var list = Array.isArray(items) ? items : [];
    if (!nodes.ledgerBody || !nodes.ledgerTable || !nodes.ledgerEmpty) return;
    nodes.ledgerBody.innerHTML = '';
    setVisible(nodes.ledgerTable, list.length > 0);
    setVisible(nodes.ledgerEmpty, list.length === 0);
    if (!list.length) return;
    list.forEach(function(entry){
      var row = doc.createElement('tr');

      var whenCell = doc.createElement('td');
      whenCell.textContent = formatTimestamp(entry.display_created_at || entry.created_at || entry.tx_created_at);

      var actionCell = doc.createElement('td');
      actionCell.textContent = entry.tx_type || 'ENTRY';

      var detailCell = doc.createElement('td');
      detailCell.textContent = describeEntry(entry);
      var metaText = [];
      if (entry.idempotency_key){ metaText.push(entry.idempotency_key); }
      if (entry.metadata && entry.metadata.source){ metaText.push(entry.metadata.source); }
      if (metaText.length){
        var meta = doc.createElement('span');
        meta.className = 'admin-ledger__meta';
        meta.textContent = metaText.join(' · ');
        detailCell.appendChild(doc.createElement('br'));
        detailCell.appendChild(meta);
      }

      var amountCell = doc.createElement('td');
      var amount = Number(entry.amount);
      amountCell.textContent = Number.isFinite(amount) ? ((amount > 0 ? '+' : '') + amount.toLocaleString()) : '—';
      if (amount > 0){
        amountCell.className = 'admin-ledger__amount--positive';
      } else if (amount < 0){
        amountCell.className = 'admin-ledger__amount--negative';
      }

      row.appendChild(whenCell);
      row.appendChild(actionCell);
      row.appendChild(detailCell);
      row.appendChild(amountCell);
      nodes.ledgerBody.appendChild(row);
    });
  }

  function renderSearchResults(items){
    if (!nodes.searchResults || !nodes.searchEmpty) return;
    nodes.searchResults.innerHTML = '';
    setVisible(nodes.searchEmpty, Array.isArray(items) && items.length === 0);
    (items || []).forEach(function(item){
      var li = doc.createElement('li');
      li.className = 'admin-results__item';
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'admin-results__button';
      if (state.selectedUser && state.selectedUser.userId === item.userId){
        button.className += ' is-active';
      }

      var title = doc.createElement('span');
      title.className = 'admin-results__title';
      title.textContent = item.displayName || item.email || item.userId || '—';

      var meta = doc.createElement('span');
      meta.className = 'admin-results__meta';
      meta.textContent = (item.email || '—') + ' · ' + (item.userId || '—');

      button.appendChild(title);
      button.appendChild(meta);
      button.addEventListener('click', function(){
        state.selectedUser = item;
        resetDraftIdempotencyKey();
        renderSearchResults(items);
        renderSelectedUser();
        loadSelectedUserData();
      });

      li.appendChild(button);
      nodes.searchResults.appendChild(li);
    });
  }

  function parseAmountInput(){
    var value = nodes.amountInput && typeof nodes.amountInput.value === 'string' ? nodes.amountInput.value.trim() : '';
    var amount = Number(value);
    if (!Number.isFinite(amount) || Math.trunc(amount) !== amount || amount === 0){
      return null;
    }
    return amount;
  }

  function readReasonInput(){
    return nodes.reasonInput && typeof nodes.reasonInput.value === 'string' ? nodes.reasonInput.value.trim() : '';
  }

  function getUnauthorizedMessage(err){
    if (err && err.status === 401){
      return t('adminUnauthorizedSignin', 'Sign in with an allowlisted admin account to continue.');
    }
    return t('adminUnauthorized', 'This page is available only for allowlisted admin accounts.');
  }

  async function loadSelectedUserData(options){
    if (!state.selectedUser || !state.selectedUser.userId) return;
    var requestId = ++state.detailRequestId;
    var silentStatus = !!(options && options.silentStatus);
    setSelectedBalance('—');
    renderLedger([]);
    if (!silentStatus){
      setStatus(t('loading', 'Loading...'), 'info');
    }
    try {
      var userId = state.selectedUser.userId;
      var balanceUrl = '/.netlify/functions/admin-user-balance?userId=' + encodeURIComponent(userId);
      var ledgerUrl = '/.netlify/functions/admin-user-ledger?userId=' + encodeURIComponent(userId) + '&limit=25';
      var results = await Promise.all([
        apiFetch(balanceUrl, { method: 'GET' }),
        apiFetch(ledgerUrl, { method: 'GET' }),
      ]);
      if (requestId !== state.detailRequestId) return;
      setSelectedBalance(results[0] && results[0].balance);
      renderLedger(results[1] && results[1].items ? results[1].items : []);
      if (!silentStatus){
        setStatus('', '');
      }
    } catch (err){
      if (requestId !== state.detailRequestId) return;
      if (err && (err.status === 401 || err.status === 403)){
        showUnauthorized(getUnauthorizedMessage(err));
        setStatus('', '');
        return;
      }
      klog('admin_page_load_user_error', { message: err && err.message ? String(err.message) : 'error' });
      setStatus(t('adminSearchError', 'Could not search users right now.'), 'error');
    }
  }

  async function checkAccess(){
    setStatus(t('adminChecking', 'Checking admin access...'), 'info');
    try {
      var me = await apiFetch('/.netlify/functions/admin-me', { method: 'GET' });
      state.adminUserId = me.userId || null;
      showApp();
      setStatus('', '');
    } catch (err){
      state.adminUserId = null;
      showUnauthorized(getUnauthorizedMessage(err));
      setStatus('', '');
    }
  }

  async function handleSearch(event){
    event.preventDefault();
    var query = nodes.searchInput && typeof nodes.searchInput.value === 'string' ? nodes.searchInput.value.trim() : '';
    if (!query){
      renderSearchResults([]);
      return;
    }
    var requestId = ++state.searchRequestId;
    setStatus(t('loading', 'Loading...'), 'info');
    try {
      var payload = await apiFetch('/.netlify/functions/admin-user-search?q=' + encodeURIComponent(query), { method: 'GET' });
      if (requestId !== state.searchRequestId) return;
      var items = payload && payload.items ? payload.items : [];
      renderSearchResults(items);
      setStatus('', '');
    } catch (err){
      if (requestId !== state.searchRequestId) return;
      if (err && (err.status === 401 || err.status === 403)){
        showUnauthorized(getUnauthorizedMessage(err));
        setStatus('', '');
        return;
      }
      klog('admin_page_search_error', { message: err && err.message ? String(err.message) : 'error' });
      setStatus(t('adminSearchError', 'Could not search users right now.'), 'error');
    }
  }

  async function handleAdjust(event){
    event.preventDefault();
    if (!state.selectedUser || !state.selectedUser.userId){
      setStatus(t('adminSelectedEmpty', 'Select a user to view balance, ledger, and adjustments.'), 'error');
      return;
    }
    var amount = parseAmountInput();
    if (amount == null){
      setStatus(t('adminInvalidAmount', 'Enter a non-zero whole amount.'), 'error');
      return;
    }
    var reason = readReasonInput();
    if (!reason){
      setStatus(t('adminReasonRequired', 'Reason is required.'), 'error');
      return;
    }
    if (amount < 0 && window.confirm && !window.confirm(t('adminConfirmRemove', 'Remove chips from this user?'))){
      return;
    }
    if (nodes.adjustSubmit){ nodes.adjustSubmit.disabled = true; }
    setStatus(t('loading', 'Loading...'), 'info');
    try {
      await apiFetch('/.netlify/functions/admin-ledger-adjust', {
        method: 'POST',
        body: JSON.stringify({
          userId: state.selectedUser.userId,
          amount: amount,
          reason: reason,
          idempotencyKey: getDraftIdempotencyKey(),
        }),
      });
      if (nodes.amountInput){ nodes.amountInput.value = ''; }
      if (nodes.reasonInput){ nodes.reasonInput.value = ''; }
      resetDraftIdempotencyKey();
      await loadSelectedUserData({ silentStatus: true });
      setStatus(t('adminAdjustSuccess', 'Adjustment saved.'), 'success');
    } catch (err){
      if (err && (err.status === 401 || err.status === 403)){
        showUnauthorized(getUnauthorizedMessage(err));
        setStatus('', '');
      } else {
        klog('admin_page_adjust_error', { message: err && err.message ? String(err.message) : 'error', code: err && err.code ? err.code : null });
        setStatus((err && err.code ? err.code + ': ' : '') + t('adminAdjustError', 'Could not save the adjustment.'), 'error');
      }
    } finally {
      if (nodes.adjustSubmit){ nodes.adjustSubmit.disabled = false; }
    }
  }

  async function handleCopyUserId(){
    if (!state.selectedUser || !state.selectedUser.userId || !navigator || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function'){
      setStatus(t('adminCopyFail', 'Could not copy userId.'), 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(state.selectedUser.userId);
      setStatus(t('adminCopyOk', 'userId copied.'), 'success');
    } catch (_err){
      setStatus(t('adminCopyFail', 'Could not copy userId.'), 'error');
    }
  }

  function wireQuickButtons(){
    (nodes.quickButtons || []).forEach(function(button){
      button.addEventListener('click', function(){
        if (!nodes.amountInput) return;
        nodes.amountInput.value = String(button.getAttribute('data-amount') || '');
        nodes.amountInput.focus();
        resetDraftIdempotencyKey();
      });
    });
  }

  function wireAuthChanges(){
    if (!window.SupabaseAuth || typeof window.SupabaseAuth.onAuthChange !== 'function') return;
    window.SupabaseAuth.onAuthChange(function(){
      state.selectedUser = null;
      resetDraftIdempotencyKey();
      renderSelectedUser();
      renderSearchResults([]);
      checkAccess();
    });
  }

  function init(){
    selectNodes();
    renderSelectedUser();
    renderLedger([]);
    if (nodes.searchForm){ nodes.searchForm.addEventListener('submit', handleSearch); }
    if (nodes.adjustForm){ nodes.adjustForm.addEventListener('submit', handleAdjust); }
    if (nodes.copyUserId){ nodes.copyUserId.addEventListener('click', handleCopyUserId); }
    if (nodes.amountInput){ nodes.amountInput.addEventListener('input', resetDraftIdempotencyKey); }
    if (nodes.reasonInput){ nodes.reasonInput.addEventListener('input', resetDraftIdempotencyKey); }
    wireQuickButtons();
    wireAuthChanges();
    checkAccess();
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
