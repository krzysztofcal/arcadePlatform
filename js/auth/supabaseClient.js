(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var state = { user: null, open: false };
  var nodes = {};

  function pickEnv(){
    var env = window.SUPABASE_CONFIG || window.SUPABASE_ENV || window.ENV || window.CONFIG || {};
    var maybe = env.supabase || env.SUPABASE || env;
    return {
      url: maybe.SUPABASE_URL || maybe.supabaseUrl || maybe.url,
      key: maybe.SUPABASE_KEY || maybe.supabaseKey || maybe.key
    };
  }

  function initClient(){
    var env = pickEnv();
    if (window.supabase && window.supabase.createClient && env.url && env.key){
      try {
        window.supabaseClient = window.supabase.createClient(env.url, env.key);
      } catch (_err){
        window.supabaseClient = null;
      }
    } else {
      window.supabaseClient = window.supabaseClient || null;
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
    if (intent === 'signout' && window.supabaseClient && window.supabaseClient.auth){
      window.supabaseClient.auth.signOut().catch(function(){});
      toggleMenu(false);
      return;
    }
    var event;
    try {
      event = new CustomEvent('auth:signin-request');
    } catch (_err){
      return;
    }
    doc.dispatchEvent(event);
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
      renderUser(res.data && res.data.session ? res.data.session.user : null);
    }).catch(function(){ renderUser(null); });

    client.auth.onAuthStateChange(function(_event, session){
      renderUser(session && session.user ? session.user : null);
    });
  }

  function init(){
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
