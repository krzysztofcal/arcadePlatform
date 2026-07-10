(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var nodes = {};
  var state = { user: null, profile: null, open: false, client: null };
  var authListeners = [];
  var authSubscriptionAttached = false;

  function logDiag(label, payload){
    var logger = window && window.KLog;

    if (logger && typeof logger.log === 'function'){
      try { logger.log(label, payload || {}); } catch (_err){}
    }

    if (window && window.XP_DIAG && typeof console !== 'undefined' && console && typeof console.debug === 'function'){
      try { console.debug('[supabase]', label, payload || {}); } catch (_err){}
    }
  }

  function getEmailDomain(email){
    if (!email || typeof email !== 'string') return null;
    var atIndex = email.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === email.length - 1) return null;
    return email.slice(atIndex + 1).toLowerCase();
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
      var emailDomain = getEmailDomain(user && user.email);
      logDiag('supabase:session_initial', {
        hasSession: !!user,
        hasEmail: !!(user && user.email),
        userId: user && user.id ? user.id : null,
        emailDomain: emailDomain,
        sessionExpiresAt: session && session.expires_at ? session.expires_at : null
      });
      return user;
    }).catch(function(err){
      logDiag('supabase:session_error', { message: err && err.message ? String(err.message) : 'error' });
      return null;
    });
  }

  function getAccessToken(){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.getSession !== 'function'){
      return Promise.resolve(null);
    }

    return client.auth.getSession().then(function(res){
      var session = res && res.data ? res.data.session : null;
      var token = session && session.access_token ? session.access_token : null;
      return token || null;
    }).catch(function(err){
      logDiag('supabase:token_error', { message: err && err.message ? String(err.message) : 'error' });
      return null;
    });
  }

  if (typeof window !== 'undefined'){
    if (!window.SupabaseAuthBridge) window.SupabaseAuthBridge = {};
    var existingBridgeGetAccessToken = typeof window.SupabaseAuthBridge.getAccessToken === 'function'
      ? window.SupabaseAuthBridge.getAccessToken
      : null;
    window.SupabaseAuthBridge.getAccessToken = function(){
      var client = getClient();
      if (client && client.auth && typeof client.auth.getSession === 'function'){
        return getAccessToken();
      }
      return existingBridgeGetAccessToken
        ? Promise.resolve().then(function(){ return existingBridgeGetAccessToken(); })
        : Promise.resolve(null);
    };
    logDiag('supabase:token_bridge_init', { attached: true, preservedExisting: !!existingBridgeGetAccessToken });
  }

  function notifyAuthListeners(event, session){
    var user = session && session.user ? session.user : null;
    for (var i = 0; i < authListeners.length; i++){
      var listener = authListeners[i];
      if (typeof listener === 'function'){
        try { listener(event, user, session); } catch (_err){}
      }
    }
  }

  function attachAuthSubscription(){
    if (authSubscriptionAttached) return;
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function'){
      return;
    }
    authSubscriptionAttached = true;
    var result = client.auth.onAuthStateChange(function(event, session){
      var user = session && session.user ? session.user : null;
      var emailDomain = getEmailDomain(user && user.email);
      logDiag('supabase:auth_change', {
        event: event,
        hasUser: !!user,
        userId: user && user.id ? user.id : null,
        emailDomain: emailDomain,
        sessionExpiresAt: session && session.expires_at ? session.expires_at : null
      });
      notifyAuthListeners(event, session || null);
    });
  }

  // SupabaseAuth.onAuthChange contract: listener(event, user, session?)
  // - user is always the second argument (or null)
  // - session is an optional third argument
  function onAuthChange(callback){
    if (typeof callback === 'function'){
      authListeners.push(callback);
    }
    attachAuthSubscription();
    return function(){
      if (!callback) return;
      authListeners = authListeners.filter(function(fn){ return fn !== callback; });
    };
  }

  function signIn(email, password){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.signInWithPassword !== 'function'){
      return Promise.reject(new Error('Authentication client not ready'));
    }
    return client.auth.signInWithPassword({ email: email, password: password });
  }

  function getAuthRedirectTo(){
    try {
      if (!window || !window.location || !window.location.origin) return null;
      var protocol = window.location.protocol || '';
      if (protocol !== 'http:' && protocol !== 'https:') return null;
      return window.location.origin + '/account.html';
    } catch (_err){
      return null;
    }
  }

  function signUp(email, password){
    var client = getClient();
    if (!client || !client.auth || typeof client.auth.signUp !== 'function'){
      return Promise.reject(new Error('Authentication client not ready'));
    }
    var payload = { email: email, password: password };
    var emailRedirectTo = getAuthRedirectTo();
    if (emailRedirectTo) payload.options = { emailRedirectTo: emailRedirectTo };
    return client.auth.signUp(payload);
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

  function applyProfileAvatar(node, profile, name){
    if (!node) return;
    if (window.ProfileClient && typeof window.ProfileClient.applyAvatar === 'function'){
      window.ProfileClient.applyAvatar(node, profile || { displayName: name, avatar: { variant: 'default' } });
      return;
    }
    node.textContent = computeInitials(name);
    node.dataset.avatarVariant = profile && profile.avatar && profile.avatar.variant ? profile.avatar.variant : 'default';
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

  function t(key, fallback){
    try {
      if (window.I18N && typeof window.I18N.t === 'function'){
        return window.I18N.t(key) || fallback || key;
      }
    } catch (_err){}
    return fallback || key;
  }

  function renderUser(user, profile){
    state.user = user || null;
    state.profile = profile || null;
    var name = t('guest', 'Guest');
    var email = t('signInToSyncProgress', 'Sign in to sync progress');

    if (user){
      name = profile && profile.displayName ? profile.displayName : t('player', 'Player');
      email = t('profileAccountSynced', 'Account synced');
    }

    var initials = computeInitials(name);

    applyProfileAvatar(nodes.initials, profile, name);
    applyProfileAvatar(nodes.menuInitials, profile, name);
    if (nodes.label){ nodes.label.textContent = user ? name : t('signIn', 'Sign in'); }
    if (nodes.menuName){ nodes.menuName.textContent = name; }
    if (nodes.menuEmail){ nodes.menuEmail.textContent = email; }
    if (nodes.menuAction){
      nodes.menuAction.textContent = user ? t('signOut', 'Sign out') : t('signIn', 'Sign in');
      nodes.menuAction.dataset.intent = user ? 'signout' : 'signin';
    }
    if (nodes.button){
      nodes.button.setAttribute('aria-label', user ? t('accountMenu', 'Account menu') : t('signIn', 'Sign in'));
    }
  }

  function refreshProfile(user){
    if (!user) return;
    var load = window.ProfileClient && typeof window.ProfileClient.getMe === 'function'
      ? window.ProfileClient.getMe()
      : getAccessToken().then(function(accessToken){
        if (!accessToken) throw new Error('not_authenticated');
        return fetch('/.netlify/functions/profile-me', { headers: { Authorization: 'Bearer ' + accessToken } }).then(function(response){
          if (!response.ok) throw new Error('profile_request_failed');
          return response.json();
        });
      });
    load.then(function(profile){
      if (state.user && state.user.id === user.id) renderUser(user, profile);
    }).catch(function(error){
      logDiag('profile:topbar_load_failed', { code: error && error.code ? error.code : 'request_failed' });
    });
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
    doc.addEventListener('langchange', function(){ renderUser(state.user, state.profile); });
    doc.addEventListener('profile:updated', function(event){ if (state.user) renderUser(state.user, event && event.detail ? event.detail : state.profile); });

    renderUser(state.user);
  }

  function hydrateSession(){
    renderUser(null, null);

    getCurrentUser().then(function(user){
      renderUser(user, null);
      refreshProfile(user);
    });

    onAuthChange(function(_event, user){
      if (window.ProfileClient && typeof window.ProfileClient.clear === 'function') window.ProfileClient.clear();
      renderUser(user, null);
      refreshProfile(user);
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
