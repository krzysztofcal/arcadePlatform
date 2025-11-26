(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var state = { user: null, open: false };
  var nodes = {};

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

  function initClient(){
    var env = pickEnv();
    var hasSupabase = !!(window.supabase && window.supabase.createClient);
    if (hasSupabase && env.url && env.key){
      try {
        window.supabaseClient = window.supabase.createClient(env.url, env.key);
        logDiag('supabase:init_ok', { urlPresent: !!env.url, keyPresent: !!env.key });
      } catch (_err){
        window.supabaseClient = null;
      }
    } else {
      window.supabaseClient = window.supabaseClient || null;
    }
    if (!window.supabaseClient){
      logDiag('supabase:init_failed', { hasSupabase: hasSupabase, url: !!env.url, key: !!env.key });
    }
    return window.supabaseClient;
  }

  function computeInitials(name){
    var str = (name || '').trim();
    if (!str){
      return 'AH';
    }
    var parts = str.split(/\s+/).filter(Boolean);
    if (parts.length >= 2){
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
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

  function handleAction(){
    if (!nodes.menuAction) return;
    var intent = nodes.menuAction.dataset.intent;
    logDiag('supabase:avatar_action', { intent: intent });
    if (intent === 'signout' && window.supabaseClient && window.supabaseClient.auth){
      window.supabaseClient.auth.signOut().catch(function(err){
        logDiag('supabase:signout_error', { message: err && err.message ? String(err.message) : 'error' });
      });
      toggleMenu(false);
      return;
    }
    try {
      var ev;
      if (typeof CustomEvent === 'function') {
        ev = new CustomEvent('auth:signin-request');
      } else if (doc.createEvent) {
        ev = doc.createEvent('Event');
        ev.initEvent('auth:signin-request', true, true);
      }
      if (ev && doc.dispatchEvent) {
        doc.dispatchEvent(ev);
      }
    } catch (_err){}
    toggleMenu(false);
  }

  function wireAvatar(){
    selectNodes();
    if (!nodes.button || !nodes.shell) return;

    nodes.button.addEventListener('click', function(){ toggleMenu(); });
    doc.addEventListener('click', outsideClick);
    doc.addEventListener('keydown', handleEscape);
    if (nodes.menuAction){ nodes.menuAction.addEventListener('click', handleAction); }

    renderUser(state.user);
  }

  function hydrateSession(client){
    if (!client || !client.auth) {
      renderUser(null);
      return;
    }

    client.auth.getSession().then(function(res){
      var session = res.data && res.data.session ? res.data.session : null;
      logDiag('supabase:session_initial', { hasSession: !!(session && session.user), hasEmail: !!(session && session.user && session.user.email) });
      renderUser(session && session.user ? session.user : null);
    }).catch(function(err){
      logDiag('supabase:session_error', { message: err && err.message ? String(err.message) : 'error' });
      renderUser(null);
    });

    client.auth.onAuthStateChange(function(event, session){
      logDiag('supabase:auth_change', { event: event, hasUser: !!(session && session.user) });
      renderUser(session && session.user ? session.user : null);
    });
  }

  function init(){
    logDiag('supabase:init_start', {});
    wireAvatar();
    var client = initClient();
    hydrateSession(client);
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
