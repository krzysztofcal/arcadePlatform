(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var auth = null;
  var nodes = {};
  var currentUser = null;
  var chipsInFlight = null;
  var ledgerState = {
    entries: [],
    nextCursor: null,
    hasMore: true,
    loading: false,
    error: null,
    rowHeight: 80,
    overscan: 4,
    lastLoadAttemptAtMs: 0,
    lastScrollTop: 0,
    renderQueued: false,
  };

  function selectNodes(){
    nodes.status = doc.getElementById('accountStatus');
    nodes.forms = doc.getElementById('authForms');
    nodes.account = doc.getElementById('accountPanel');
    nodes.userEmail = doc.getElementById('accountEmail');
    nodes.userName = doc.getElementById('accountName');
    nodes.signOut = doc.getElementById('signOutButton');
    nodes.deleteBtn = doc.getElementById('deleteAccountButton');
    nodes.deleteNote = doc.getElementById('deleteAccountNote');
    nodes.signInForm = doc.getElementById('signinForm');
    nodes.signUpForm = doc.getElementById('signupForm');
    nodes.signInEmail = doc.getElementById('signinEmail');
    nodes.signInPass = doc.getElementById('signinPassword');
    nodes.signUpEmail = doc.getElementById('signupEmail');
    nodes.signUpPass = doc.getElementById('signupPassword');
    nodes.chipPanel = doc.getElementById('chipPanel');
    nodes.chipStatus = doc.getElementById('chipStatus');
    nodes.chipBalanceValue = doc.getElementById('chipBalanceValue');
    nodes.chipLedgerScroll = doc.getElementById('chipLedgerScroll');
    nodes.chipLedgerSpacer = doc.getElementById('chipLedgerSpacer');
    nodes.chipLedgerList = doc.getElementById('chipLedgerList');
    nodes.chipLedgerEmpty = doc.getElementById('chipLedgerEmpty');
  }

  function setBlockVisibility(node, isVisible){
    if (!node) return;
    node.hidden = !isVisible;
    node.style.display = isVisible ? '' : 'none';
  }

  function setStatus(message, tone){
    if (!nodes.status) return;
    nodes.status.textContent = message || '';
    nodes.status.dataset.tone = tone || '';
    nodes.status.hidden = !message;
  }

  function klog(kind, data){
    try {
      if (window && window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function parseSortId(value){
    if (value === null || value === undefined) return null;
    var text = String(value);
    if (!/^\d+$/.test(text)) return null;
    try {
      return BigInt(text);
    } catch (_err){
      return null;
    }
  }

  function renderUser(user){
    var hasUser = !!user;
    currentUser = user || null;

    // Toggle panels
    setBlockVisibility(nodes.forms, !hasUser);
    setBlockVisibility(nodes.account, hasUser);
    setBlockVisibility(nodes.chipPanel, hasUser);

    if (!hasUser){
      clearChips();
      return;
    }

    var meta = user.user_metadata || {};
    var displayName = meta.full_name || meta.name || user.email || 'Player';
    if (nodes.userEmail){ nodes.userEmail.textContent = user.email || 'Unknown email'; }
    if (nodes.userName){ nodes.userName.textContent = displayName; }
  }

  function clearChips(){
    if (nodes.chipBalanceValue){ nodes.chipBalanceValue.textContent = '—'; }
    if (nodes.chipLedgerList){ nodes.chipLedgerList.innerHTML = ''; }
    if (nodes.chipLedgerSpacer){ nodes.chipLedgerSpacer.style.height = '0px'; }
    if (nodes.chipLedgerScroll){ nodes.chipLedgerScroll.scrollTop = 0; }
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = false; }
    setChipStatus('', '');
    resetLedgerState();
  }

  function setChipStatus(message, tone){
    if (!nodes.chipStatus) return;
    nodes.chipStatus.textContent = message || '';
    nodes.chipStatus.dataset.tone = tone || '';
    nodes.chipStatus.hidden = !message;
  }

  function renderChipBalance(balance){
    if (!nodes.chipBalanceValue) return;
    var raw = balance && balance.balance != null ? Number(balance.balance) : null;
    var amount = Number.isFinite(raw) ? raw : null;
    nodes.chipBalanceValue.textContent = amount == null ? '—' : amount.toLocaleString();
  }

  function ledgerEntryKey(entry){
    if (!entry) return null;
    var sortIdText = entry && entry.sort_id != null ? String(entry.sort_id) : '';
    if (sortIdText && /^\d+$/.test(sortIdText)){
      return 'sid:' + sortIdText;
    }
    if (entry.idempotency_key){ return 'idem:' + entry.idempotency_key; }
    if (entry.tx_created_at && entry.tx_type && entry.amount != null){
      return 'tx:' + entry.tx_created_at + ':' + entry.tx_type + ':' + entry.amount + ':' + (entry.reference || '') + ':' + (entry.description || '');
    }
    if (entry.display_created_at && entry.tx_type && entry.amount != null){
      return 'entry:' + entry.display_created_at + ':' + entry.tx_type + ':' + entry.amount + ':' + (entry.reference || '');
    }
    if (entry.display_created_at || entry.tx_type || entry.amount != null || entry.reference || entry.description){
      try {
        return 'fallback:' + JSON.stringify({
          display_created_at: entry.display_created_at || null,
          tx_created_at: entry.tx_created_at || null,
          tx_type: entry.tx_type || null,
          amount: entry.amount,
          reference: entry.reference || null,
          description: entry.description || null,
        });
      } catch (_err){}
    }
    return null;
  }

  function formatDateTime(value){
    if (!value) return '';
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    var year = String(parsed.getFullYear());
    var month = String(parsed.getMonth() + 1).padStart(2, '0');
    var day = String(parsed.getDate()).padStart(2, '0');
    var hour = String(parsed.getHours()).padStart(2, '0');
    var minute = String(parsed.getMinutes()).padStart(2, '0');
    return year + '-' + month + '-' + day + ' ' + hour + ':' + minute;
  }

  function resolveLedgerTimestamp(entry){
    var source = entry && entry.display_created_at ? entry.display_created_at : null;
    var formatted = formatDateTime(source);
    if (!formatted){
      klog('chips:ledger_invalid_display_timestamp', {
        display_created_at: source,
        entry_seq: entry && entry.entry_seq,
        sort_id: entry && entry.sort_id,
      });
      return '—';
    }
    return formatted;
  }

  function buildLedgerRow(entry){
    var item = doc.createElement('li');
    item.className = 'chip-ledger__item';

    var meta = doc.createElement('div');
    meta.className = 'chip-ledger__meta';

    var type = doc.createElement('div');
    type.className = 'chip-ledger__type';
    type.textContent = entry && entry.tx_type ? entry.tx_type : 'ENTRY';

    var desc = doc.createElement('div');
    desc.className = 'chip-ledger__desc';
    desc.textContent = entry && entry.description ? entry.description : (entry && entry.reference ? entry.reference : '');

    var time = doc.createElement('div');
    time.className = 'chip-ledger__time';
    time.textContent = resolveLedgerTimestamp(entry);

    meta.appendChild(type);
    if (desc.textContent){ meta.appendChild(desc); }
    meta.appendChild(time);

    var amount = doc.createElement('div');
    amount.className = 'chip-ledger__amount';
    var rawAmount = entry && entry.amount != null ? Number(entry.amount) : null;
    var validAmount =
      Number.isFinite(rawAmount) &&
      Math.trunc(rawAmount) === rawAmount &&
      rawAmount !== 0;

    if (validAmount){
      amount.textContent = (rawAmount > 0 ? '+' : '') + rawAmount.toLocaleString();
      amount.className += rawAmount > 0 ? ' chip-ledger__amount--positive' : ' chip-ledger__amount--negative';
    } else {
      amount.textContent = '—';
      item.dataset.invalid = 'amount';
      if (window && window.XP_DIAG && typeof console !== 'undefined' && console && typeof console.debug === 'function'){
        try {
          console.debug('[chips] invalid ledger amount', {
            entry_seq: entry && entry.entry_seq,
            raw_amount: entry && entry.raw_amount != null ? entry.raw_amount : null,
            entry: entry,
          });
        } catch (_err){}
      }
    }

    item.appendChild(meta);
    item.appendChild(amount);
    return item;
  }

  function buildLedgerStatusRow(message){
    var item = doc.createElement('li');
    item.className = 'chip-ledger__item chip-ledger__item--status';
    item.textContent = message;
    return item;
  }

  function queueLedgerRender(){
    if (ledgerState.renderQueued) return;
    ledgerState.renderQueued = true;
    var raf = (window && window.requestAnimationFrame)
      ? window.requestAnimationFrame
      : function(cb){ return setTimeout(cb, 0); };
    raf(function(){
      ledgerState.renderQueued = false;
      renderLedger();
    });
  }

  function getLedgerTailState(){
    if (ledgerState.loading){ return 'loading'; }
    if (ledgerState.error){ return 'error'; }
    if (!ledgerState.hasMore && ledgerState.entries.length){ return 'end'; }
    return null;
  }

  function renderLedger(){
    if (!nodes.chipLedgerList || !nodes.chipLedgerScroll || !nodes.chipLedgerSpacer) return;
    var entries = ledgerState.entries || [];
    var isEmpty = entries.length === 0 && !ledgerState.loading;
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = !isEmpty; }

    var tailState = getLedgerTailState();
    var totalCount = entries.length + (tailState ? 1 : 0);
    var totalHeight = totalCount * ledgerState.rowHeight;
    nodes.chipLedgerSpacer.style.height = totalHeight + 'px';
    nodes.chipLedgerList.innerHTML = '';
    if (!totalCount) return;

    var scrollTop = nodes.chipLedgerScroll.scrollTop;
    var viewportHeight = nodes.chipLedgerScroll.clientHeight || 0;
    var startIndex = Math.max(0, Math.floor(scrollTop / ledgerState.rowHeight) - ledgerState.overscan);
    var endIndex = Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / ledgerState.rowHeight) + ledgerState.overscan);
    var fragment = doc.createDocumentFragment();
    for (var i = startIndex; i < endIndex; i++){
      var row = null;
      if (i < entries.length){
        row = buildLedgerRow(entries[i]);
      } else if (tailState === 'loading'){
        row = buildLedgerStatusRow('Loading more activity…');
      } else if (tailState === 'error'){
        row = buildLedgerStatusRow('Could not load more activity. Scroll to retry.');
        row.addEventListener('click', function(){
          loadLedgerPage(true);
        });
      } else if (tailState === 'end'){
        row = buildLedgerStatusRow('End of history');
      }
      if (row){
        row.style.top = (i * ledgerState.rowHeight) + 'px';
        row.style.height = ledgerState.rowHeight + 'px';
        fragment.appendChild(row);
      }
    }
    nodes.chipLedgerList.appendChild(fragment);
  }

  function resetLedgerState(){
    ledgerState.entries = [];
    ledgerState.nextCursor = null;
    ledgerState.hasMore = true;
    ledgerState.loading = false;
    ledgerState.error = null;
    ledgerState.lastLoadAttemptAtMs = 0;
    ledgerState.lastScrollTop = 0;
    ledgerState.renderQueued = false;
    if (nodes.chipLedgerScroll){ nodes.chipLedgerScroll.scrollTop = 0; }
  }

  function appendLedgerItems(items, nextCursor){
    if (!items || !items.length){
      ledgerState.nextCursor = nextCursor || null;
      ledgerState.hasMore = !!nextCursor;
      queueLedgerRender();
      return;
    }
    var existing = ledgerState.entries || [];
    var merged = [];
    var seen = new Set();
    function addEntry(entry){
      if (!entry) return;
      var key = ledgerEntryKey(entry);
      if (key){
        if (seen.has(key)) return;
        seen.add(key);
      }
      merged.push(entry);
    }
    for (var i = 0; i < existing.length; i++){
      addEntry(existing[i]);
    }
    for (var j = 0; j < items.length; j++){
      addEntry(items[j]);
    }
    merged.sort(function(a, b){
      var aCreated = a && a.display_created_at ? String(a.display_created_at) : '';
      var bCreated = b && b.display_created_at ? String(b.display_created_at) : '';
      if (aCreated !== bCreated){
        return aCreated < bCreated ? 1 : -1;
      }
      var aSort = parseSortId(a && a.sort_id != null ? a.sort_id : null);
      var bSort = parseSortId(b && b.sort_id != null ? b.sort_id : null);
      if (aSort === null && bSort === null) return 0;
      if (aSort === null) return 1;
      if (bSort === null) return -1;
      if (aSort === bSort) return 0;
      return aSort < bSort ? 1 : -1;
    });
    ledgerState.entries = merged;
    ledgerState.nextCursor = nextCursor || null;
    ledgerState.hasMore = !!nextCursor;
    queueLedgerRender();
  }

  function shouldLoadMore(){
    if (!nodes.chipLedgerScroll) return false;
    if (!ledgerState.hasMore || ledgerState.loading) return false;
    if (ledgerState.error){
      var now = Date.now();
      var scrolledEnough = nodes.chipLedgerScroll.scrollTop >= ledgerState.lastScrollTop + ledgerState.rowHeight;
      var waitedEnough = now - ledgerState.lastLoadAttemptAtMs >= 800;
      if (!scrolledEnough || !waitedEnough) return false;
    }
    var tailState = getLedgerTailState();
    var totalCount = ledgerState.entries.length + (tailState ? 1 : 0);
    var totalHeight = totalCount * ledgerState.rowHeight;
    return nodes.chipLedgerScroll.scrollTop + nodes.chipLedgerScroll.clientHeight >= totalHeight - (ledgerState.rowHeight * 3);
  }

  async function loadLedgerPage(force){
    if (!window || !window.ChipsClient || typeof window.ChipsClient.fetchLedger !== 'function') return;
    if (!ledgerState.hasMore || ledgerState.loading) return;
    ledgerState.loading = true;
    ledgerState.error = null;
    ledgerState.lastLoadAttemptAtMs = Date.now();
    ledgerState.lastScrollTop = nodes.chipLedgerScroll ? nodes.chipLedgerScroll.scrollTop : 0;
    queueLedgerRender();
    try {
      var payload = await window.ChipsClient.fetchLedger({
        limit: 50,
        cursor: ledgerState.nextCursor,
      });
      var items = payload && Array.isArray(payload.items) ? payload.items : (payload && Array.isArray(payload.entries) ? payload.entries : []);
      appendLedgerItems(items, payload ? payload.nextCursor : null);
      setChipStatus('', '');
    } catch (err){
      setChipStatus('Could not load chip history right now.', 'error');
      ledgerState.error = 'load_failed';
    } finally {
      ledgerState.loading = false;
      queueLedgerRender();
    }
  }

  function handleLedgerScroll(){
    queueLedgerRender();
    if (shouldLoadMore()){
      loadLedgerPage(false);
    }
  }

  async function loadChips(){
    if (
      !currentUser ||
      !window ||
      !window.ChipsClient ||
      typeof window.ChipsClient.fetchBalance !== 'function' ||
      typeof window.ChipsClient.fetchLedger !== 'function'
    ){
      clearChips();
      setBlockVisibility(nodes.chipPanel, false);
      return;
    }

    if (chipsInFlight){ return chipsInFlight; }

    setBlockVisibility(nodes.chipPanel, true);
    setChipStatus('Syncing chips…', 'info');
    if (nodes.chipBalanceValue){ nodes.chipBalanceValue.textContent = '—'; }
    if (nodes.chipLedgerList){ nodes.chipLedgerList.innerHTML = ''; }
    if (nodes.chipLedgerSpacer){ nodes.chipLedgerSpacer.style.height = '0px'; }
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = true; }
    resetLedgerState();

    chipsInFlight = (async function(){
      try {
        var balance = await window.ChipsClient.fetchBalance();
        renderChipBalance(balance);
        await loadLedgerPage();
        setChipStatus('', '');
      } catch (err){
        if (err && (err.status === 404 || err.code === 'not_found')){
          clearChips();
          setChipStatus('Chips are not available right now.', 'info');
          setBlockVisibility(nodes.chipPanel, false);
          return;
        }
        if (err && err.code === 'not_authenticated'){
          clearChips();
          setBlockVisibility(nodes.chipPanel, false);
          return;
        }
        setChipStatus('Could not load chips right now.', 'error');
      } finally {
        chipsInFlight = null;
      }
    })();

    return chipsInFlight;
  }

  function handleSignIn(e){
    e.preventDefault();
    var email = nodes.signInEmail && nodes.signInEmail.value ? nodes.signInEmail.value.trim() : '';
    var password = nodes.signInPass && nodes.signInPass.value ? nodes.signInPass.value : '';
    if (!email || !password){
      setStatus('Enter both email and password to sign in.', 'error');
      return;
    }

    if (!auth || !auth.signIn){
      setStatus('Authentication is not ready. Refresh and try again.', 'error');
      return;
    }

    setStatus('Signing in…', 'info');
    auth.signIn(email, password).then(function(res){
      var user = res && res.data && res.data.user ? res.data.user : null;
      if (user){
        setStatus('Signed in successfully.', 'success');
        renderUser(user);
        loadChips();
      } else {
        setStatus('Signed in. Redirecting…', 'success');
      }
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not sign in. Please try again.';
      setStatus(msg, 'error');
    });
  }

  function handleSignUp(e){
    e.preventDefault();
    var email = nodes.signUpEmail && nodes.signUpEmail.value ? nodes.signUpEmail.value.trim() : '';
    var password = nodes.signUpPass && nodes.signUpPass.value ? nodes.signUpPass.value : '';
    if (!email || !password){
      setStatus('Enter both email and password to sign up.', 'error');
      return;
    }

    if (!auth || !auth.signUp){
      setStatus('Authentication is not ready. Refresh and try again.', 'error');
      return;
    }

    setStatus('Creating your account…', 'info');
    auth.signUp(email, password).then(function(res){
      var needsVerify = res && res.data && res.data.user && res.data.user.confirmation_sent_at;
      if (needsVerify){
        setStatus('Check your inbox to confirm your email.', 'success');
      } else {
        setStatus('Account created. You are signed in.', 'success');
      }
      loadChips();
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not sign up. Please try again.';
      setStatus(msg, 'error');
    });
  }

  function handleSignOut(){
    setStatus('Signing out…', 'info');
    if (!auth || !auth.signOut){
      setStatus('Authentication is not ready. Refresh and try again.', 'error');
      return;
    }

    auth.signOut().then(function(){
      setStatus('Signed out.', 'success');
      renderUser(null);
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not sign out right now.';
      setStatus(msg, 'error');
    });
  }

  function wireEvents(){
    if (nodes.signInForm){ nodes.signInForm.addEventListener('submit', handleSignIn); }
    if (nodes.signUpForm){ nodes.signUpForm.addEventListener('submit', handleSignUp); }
    if (nodes.signOut){ nodes.signOut.addEventListener('click', handleSignOut); }
    if (nodes.deleteBtn && nodes.deleteNote){
      nodes.deleteBtn.addEventListener('click', function(e){
        e.preventDefault();
        setStatus('Account deletion is coming soon. Contact support to remove data.', 'info');
        nodes.deleteNote.focus();
      });
    }

    doc.addEventListener('auth:signin-request', function(){
      setBlockVisibility(nodes.forms, true);
      setBlockVisibility(nodes.account, false);
      if (nodes.signInEmail){ nodes.signInEmail.focus(); }
    });

    if (nodes.chipLedgerScroll){
      nodes.chipLedgerScroll.addEventListener('scroll', handleLedgerScroll);
    }
    window.addEventListener('resize', queueLedgerRender);
  }

  function hydrateUser(){
    if (!auth || !auth.getCurrentUser){
      setStatus('Authentication is not configured yet.', 'error');
      return;
    }

    setStatus('Checking session…', 'info');
    auth.getCurrentUser().then(function(user){
      renderUser(user);
      setStatus(user ? 'Signed in.' : '', user ? 'success' : '');
      if (user){
        loadChips();
      } else {
        clearChips();
        setBlockVisibility(nodes.chipPanel, false);
      }
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not load your session. Please try again.';
      setStatus(msg, 'error');
    });

    if (auth.onAuthChange){
      auth.onAuthChange(function(_event, user){
        renderUser(user);
        if (user){
          setStatus('Signed in.', 'success');
          loadChips();
        } else {
          setStatus('You have been signed out.', 'info');
          clearChips();
          setBlockVisibility(nodes.chipPanel, false);
        }
      });
    }
  }

  function init(){
    auth = (typeof window !== 'undefined' && window.SupabaseAuth) ? window.SupabaseAuth : null;
    selectNodes();
    wireEvents();
    hydrateUser();

    doc.addEventListener('chips:tx-complete', loadChips);
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
