(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var nodes = {};
  var state = { user: null, open: false, client: null };

  function logDiag(label, payload){
    var logger = window && window.KLog;

    if (logger && typeof logger.log === 'function'){
      try { logger.log(label, payload || {}); } catch (_err){}
    }

    if (window && window.XP_DIAG && typeof console !== 'undefined' && console && typeof console.debug === 'function'){
      try { console.debug('[supabase]', label, payload || {}); } catch (_err){}
    }
  }

  function pickEnv(){
    var cfg = (window.SUPABASE_CONFIG || {});
    return {
      url: cfg.SUPABASE_URL || cfg.supabaseUrl || cfg.url,
      key: cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_KEY || cfg.supabaseKey || cfg.key
    };
  }

  function getClient(){
    if (state.client){ return state.client; }

    var env = pickEnv();
    var hasSupabase = !!(window.supabase && window.supabase.createClient);
    if (hasSupabase && env.url && env.key){
      try {
        state.client = window.supabase.createClient(env.url, env.key);
        window.supabaseClient = state.client;
        logDiag('supabase:init_ok', { urlPresent: !!env.url, keyPresent: !!env.key });
      } catch (_err){
        state.client = null;
      }
    } else if (window.supabaseClient){
      state.client = window.supabaseClient;
    }

    if (!state.client){
      logDiag('supabase:init_failed', { hasSupabase: hasSupabase, url: !!env.url, key: !!env.key });
    }

    return state.client;
  }

  function getCurrentUser(){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.getSession !== 'function'){
      return Promise.resolve(null);
    }

    return client.auth.getSession().then(function(res){
      var session = res && res.data ? res.data.session : null;
      var user = session && session.user ? session.user : null;
      logDiag('supabase:session_initial', { hasSession: !!user, hasEmail: !!(user && user.email) });
      return user;
    }).catch(function(err){
      logDiag('supabase:session_error', { message: err && err.message ? String(err.message) : 'error' });
      return null;
    });
  }

  function onAuthChange(callback){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function'){
      return function(){};
    }

    var result = client.auth.onAuthStateChange(function(event, session){
      var user = session && session.user ? session.user : null;
      logDiag('supabase:auth_change', { event: event, hasUser: !!user });
      if (typeof callback === 'function'){
        try { callback(event, user); } catch (_err){}
      }
    });

    var subscription = result && result.data ? result.data.subscription : null;
    if (subscription && typeof subscription.unsubscribe === 'function'){
      return function(){ subscription.unsubscribe(); };
    }
    if (result && typeof result.unsubscribe === 'function'){ return function(){ result.unsubscribe(); }; }
    return function(){};
  }

  function signIn(email, password){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.signInWithPassword !== 'function'){
      return Promise.reject(new Error('Authentication client not ready'));
    }
    return client.auth.signInWithPassword({ email: email, password: password });
  }

  function signUp(email, password){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.signUp !== 'function'){
      return Promise.reject(new Error('Authentication client not ready'));
    }
    return client.auth.signUp({ email: email, password: password });
  }

  function signOut(){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.signOut !== 'function'){
      return Promise.reject(new Error('Authentication client not ready'));
    }
    return client.auth.signOut();
  }

  function computeInitials(name){
    var str = (name || '').trim();
    if (!str){ return 'AH'; }
    var parts = str.split(/\s+/).filter(Boolean);
    if (parts.length >= 2){ return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase(); }
    return str.slice(0, 2).toUpperCase();
  }

  function selectNodes(){
    nodes.shell = doc.getElementById('avatarShell');
    nodes.button = doc.getElementById('avatarButton');
    nodes.initials = doc.getElementById('avatarInitials');
    nodes.label = doc.getElementById('avatarLabel');
    nodes.menu = doc.getElementById('avatarMenu');
    nodes.menuInitials = doc.getElementById('avatarMenuInitials');
    nodes.menuName = doc.getElementById('avatarMenuName');
    nodes.menuEmail = doc.getElementById('avatarMenuEmail');
    nodes.menuAction = doc.getElementById('avatarMenuAction');
    nodes.menuUser = doc.querySelector('.avatar-menu__user');
  }

  function renderUser(user){
    state.user = user || null;
    var name = 'Guest';
    var email = 'Sign in to sync progress';

    if (user){
      var meta = user.user_metadata || {};
      name = meta.full_name || meta.name || user.email || 'Player';
      email = user.email || email;
    }

    var initials = computeInitials(name);

    if (nodes.initials){ nodes.initials.textContent = initials; }
    if (nodes.label){ nodes.label.textContent = user ? name : 'Sign in'; }
    if (nodes.menuInitials){ nodes.menuInitials.textContent = initials; }
    if (nodes.menuName){ nodes.menuName.textContent = name; }
    if (nodes.menuEmail){ nodes.menuEmail.textContent = email; }
    if (nodes.menuAction){
      nodes.menuAction.textContent = user ? 'Sign out' : 'Sign in';
      nodes.menuAction.dataset.intent = user ? 'signout' : 'signin';
    }
    if (nodes.button){
      nodes.button.setAttribute('aria-label', user ? 'Account menu' : 'Sign in');
    }
  }

  function toggleMenu(force){
    if (!nodes.shell || !nodes.menu || !nodes.button) return;
    var next = typeof force === 'boolean' ? force : !state.open;
    state.open = next;
    if (next){
      nodes.shell.classList.add('is-open');
      nodes.menu.hidden = false;
      nodes.button.setAttribute('aria-expanded', 'true');
    } else {
      nodes.shell.classList.remove('is-open');
      nodes.menu.hidden = true;
      nodes.button.setAttribute('aria-expanded', 'false');
    }
  }

  function outsideClick(e){
    if (!state.open) return;
    var target = e.target;
    if (!nodes.shell || nodes.shell.contains(target)) return;
    toggleMenu(false);
  }

  function handleEscape(e){
    if (e.key === 'Escape'){ toggleMenu(false); }
  }

  function isOnAccountPage(){
    var href = '';
    try {
      href = String(window.location.href || '');
    } catch (_err){
      href = '';
    }
    return href.indexOf('account.html') !== -1;
  }

  function navigateToAccount(){
    var url = '/account.html';
    try {
      window.location.assign(url);
    } catch (_err) {
      window.location.href = url;
    }
  }

  function handleAction(){
    if (!nodes.menuAction) return;
    var intent = nodes.menuAction.dataset.intent || 'signin';
    logDiag('supabase:avatar_action', { intent: intent });

    // SIGN OUT
    if (intent === 'signout'){
      signOut().catch(function(err){
        logDiag('supabase:signout_error', {
          message: err && err.message ? String(err.message) : 'error'
        });
      });
      toggleMenu(false);
      return;
    }

    // SIGN IN / OPEN ACCOUNT PAGE
    if (!isOnAccountPage()){
      // Important: do NOT close the popup before navigation
      logDiag('supabase:navigate_account', { from: window.location.href || '' });
      navigateToAccount();
      return;
    }

    // ALREADY ON ACCOUNT PAGE → Show/focus sign-in form
    try {
      var ev;
      if (typeof CustomEvent === 'function') {
        ev = new CustomEvent('auth:signin-request');
      } else if (doc.createEvent) {
        ev = doc.createEvent('Event');
        ev.initEvent('auth:signin-request', true, true);
      }
      if (ev && doc.dispatchEvent){
        doc.dispatchEvent(ev);
      }
    } catch (_err){}

    toggleMenu(false);
  }

  function handleMenuUserClick(e){
    if (!state.user) return;
    e.preventDefault();
    navigateToAccount();
  }

  function wireAvatar(){
    selectNodes();
    if (!nodes.button || !nodes.shell) return;

    nodes.button.addEventListener('click', function(){ toggleMenu(); });
    doc.addEventListener('click', outsideClick);
    doc.addEventListener('keydown', handleEscape);
    if (nodes.menuAction){ nodes.menuAction.addEventListener('click', handleAction); }
    if (nodes.menuUser){ nodes.menuUser.addEventListener('click', handleMenuUserClick); }

    renderUser(state.user);
  }

  function hydrateSession(){
    renderUser(null);

    getCurrentUser().then(function(user){
      renderUser(user);
    });

    onAuthChange(function(_event, user){
      renderUser(user);
    });
  }

  function init(){
    logDiag('supabase:init_start', {});
    wireAvatar();
    getClient();
    hydrateSession();
  }

  window.SupabaseAuth = {
    getClient: getClient,
    getCurrentUser: getCurrentUser,
    onAuthChange: onAuthChange,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut
  };

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
