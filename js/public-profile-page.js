(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var status = document.getElementById('publicProfileStatus');
  var card = document.getElementById('publicProfileCard');
  var avatar = document.getElementById('publicProfileAvatar');
  var identity = document.getElementById('publicProfileIdentity');
  var name = document.getElementById('publicProfileName');
  var handle = document.getElementById('publicProfileHandle');
  var xp = document.getElementById('publicProfileXp');
  var level = document.getElementById('publicProfileLevel');
  var currentProfile = null;
  var generation = 0;
  var signIn = document.getElementById('publicProfileSignIn');

  function t(key, fallback){
    try { return window.I18N && window.I18N.t ? (window.I18N.t(key) || fallback) : fallback; } catch (_err){ return fallback; }
  }

  function routeHandle(){
    var path = String(window.location.pathname || '').replace(/\/+$/, '');
    var value = path.slice(path.lastIndexOf('/') + 1);
    try { return decodeURIComponent(value); } catch (_err){ return ''; }
  }

  function setStatus(message, tone){
    status.removeAttribute('data-i18n');
    status.textContent = message || '';
    status.dataset.tone = tone || '';
    status.hidden = !message;
  }

  function formatXp(value){
    var locale = window.I18N && window.I18N.getLang && window.I18N.getLang() === 'pl' ? 'pl-PL' : 'en-US';
    return Number(value || 0).toLocaleString(locale);
  }

  function render(profile){
    currentProfile = profile;
    if (window.ProfileClient && window.ProfileClient.applyAvatar) window.ProfileClient.applyAvatar(avatar, profile);
    name.textContent = profile.displayName || '';
    avatar.setAttribute('aria-label', t('publicProfileAvatar', 'Avatar') + ': ' + (profile.displayName || ''));
    handle.textContent = '@' + (profile.handle || '');
    if (xp) xp.textContent = formatXp(profile.xp);
    if (level) level.textContent = String(Math.max(1, Number(profile.level) || 1));
    if (xp) { xp.classList.remove('public-profile__stat-loading'); xp.removeAttribute('aria-label'); }
    if (level) { level.classList.remove('public-profile__stat-loading'); level.removeAttribute('aria-label'); }
    if (identity) identity.hidden = false;
    card.hidden = false;
    card.setAttribute('aria-busy', 'false');
    setStatus('', '');
  }

  function reset(){
    generation += 1;
    currentProfile = null;
    card.hidden = true;
    card.setAttribute('aria-busy', 'true');
    if (identity) identity.hidden = true;
    name.textContent = '';
    handle.textContent = '';
    if (xp) xp.textContent = '';
    if (level) level.textContent = '';
    if (window.ProfileClient) window.ProfileClient.applyAvatar(avatar, null);
    avatar.setAttribute('aria-label', t('publicProfileAvatar', 'Avatar'));
    if (signIn) signIn.hidden = true;
  }

  function showSignIn(){
    setStatus(t('profileSignInRequired', 'Sign in to view this player profile.'), 'info');
    if (signIn) signIn.hidden = false;
  }

  async function load(){
    reset();
    if (document.hidden) return;
    var request = generation;
    setStatus(t('publicProfileLoading', 'Loading profile...'), '');
    try {
      var user = window.SupabaseAuth && await window.SupabaseAuth.getCurrentUser();
      if (request !== generation || document.hidden) return;
      if (!user){ showSignIn(); return; }
      var value = routeHandle();
      if (!value || !window.ProfileClient) throw { status: 404 };
      var profile = await window.ProfileClient.getPublic(value);
      if (request !== generation || document.hidden) return;
      render(profile);
    } catch (error){
      if (request !== generation || error && error.code === 'stale_identity') return;
      if (error && (error.status === 401 || error.code === 'not_authenticated')){ showSignIn(); return; }
      setStatus(error && error.status === 404 ? t('publicProfileNotFound', 'This profile is not available.') : t('publicProfileLoadError', 'Could not load this profile. Please try again.'), 'error');
    }
  }

  function boot(){
    if (window.SupabaseAuth && window.SupabaseAuth.onAuthChange){
      window.SupabaseAuth.onAuthChange(function(){ reset(); setTimeout(load, 0); });
    }
    document.addEventListener('visibilitychange', function(){
      if (document.hidden) reset(); else load();
    });
    load();
  }

  document.addEventListener('langchange', function(){
    if (!card.hidden && currentProfile) {
      if (xp) xp.textContent = formatXp(currentProfile.xp);
      document.title = t('publicProfilePageTitle', 'Public profile') + ' • Arcade Hub';
    } else if (signIn && !signIn.hidden) showSignIn();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
