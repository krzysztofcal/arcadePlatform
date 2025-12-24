(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var auth = null;
  var nodes = {};
  var currentUser = null;
  var chipsInFlight = null;

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
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = false; }
    setChipStatus('', '');
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
    var parsedCreated = entry && entry.created_at ? new Date(entry.created_at) : null;
    var parsedTxCreated = entry && entry.tx_created_at ? new Date(entry.tx_created_at) : null;
    var useCreated = parsedCreated && !Number.isNaN(parsedCreated.getTime()) ? parsedCreated : null;
    var useTxCreated = parsedTxCreated && !Number.isNaN(parsedTxCreated.getTime()) ? parsedTxCreated : null;
    var displayTime = useCreated || useTxCreated;
    time.textContent = displayTime ? displayTime.toLocaleString() : '';

    meta.appendChild(type);
    if (desc.textContent){ meta.appendChild(desc); }
    if (time.textContent){ meta.appendChild(time); }

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

  function renderLedger(entries){
    if (!nodes.chipLedgerList) return;
    nodes.chipLedgerList.innerHTML = '';
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = true; }
    if (!entries || !entries.length){
      if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = false; }
      return;
    }
    for (var i = 0; i < entries.length; i++){
      var row = buildLedgerRow(entries[i]);
      if (row){ nodes.chipLedgerList.appendChild(row); }
    }
  }

  async function loadChips(){
    if (!currentUser || !window || !window.ChipsClient || typeof window.ChipsClient.fetchState !== 'function'){
      clearChips();
      setBlockVisibility(nodes.chipPanel, false);
      return;
    }

    if (chipsInFlight){ return chipsInFlight; }

    setBlockVisibility(nodes.chipPanel, true);
    setChipStatus('Syncing chips…', 'info');
    if (nodes.chipBalanceValue){ nodes.chipBalanceValue.textContent = '—'; }
    if (nodes.chipLedgerList){ nodes.chipLedgerList.innerHTML = ''; }
    if (nodes.chipLedgerEmpty){ nodes.chipLedgerEmpty.hidden = true; }

    chipsInFlight = (async function(){
      try {
        var state = await window.ChipsClient.fetchState({ limit: 10 });
        renderChipBalance(state && state.balance ? state.balance : null);
        renderLedger(state && state.ledger && state.ledger.entries ? state.ledger.entries : []);
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
