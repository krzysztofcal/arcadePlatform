(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var status = document.getElementById('publicProfileStatus');
  var card = document.getElementById('publicProfileCard');
  var avatar = document.getElementById('publicProfileAvatar');
  var name = document.getElementById('publicProfileName');
  var handle = document.getElementById('publicProfileHandle');
  var xp = document.getElementById('publicProfileXp');
  var level = document.getElementById('publicProfileLevel');
  var bio = document.getElementById('publicProfileBio');
  var currentProfile = null;

  function t(key, fallback){
    try { return window.I18N && window.I18N.t ? (window.I18N.t(key) || fallback) : fallback; } catch (_err){ return fallback; }
  }

  function routeHandle(){
    var path = String(window.location.pathname || '').replace(/\/+$/, '');
    var value = path.slice(path.lastIndexOf('/') + 1);
    try { return decodeURIComponent(value); } catch (_err){ return ''; }
  }

  function setStatus(message, tone){
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
    bio.textContent = profile.bio || '';
    bio.hidden = !profile.bio;
    card.hidden = false;
    setStatus('', '');
  }

  function load(){
    var value = routeHandle();
    if (!value || !window.ProfileClient || typeof window.ProfileClient.getPublic !== 'function'){
      setStatus(t('publicProfileNotFound', 'This profile is not available.'), 'error');
      return;
    }
    window.ProfileClient.getPublic(value).then(render).catch(function(error){
      setStatus(error && error.status === 404 ? t('publicProfileNotFound', 'This profile is not available.') : t('publicProfileLoadError', 'Could not load this profile. Please try again.'), 'error');
    });
  }

  document.addEventListener('langchange', function(){
    if (!card.hidden && currentProfile) {
      if (xp) xp.textContent = formatXp(currentProfile.xp);
      document.title = t('publicProfilePageTitle', 'Public profile') + ' • Arcade Hub';
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, { once: true }); else load();
})();
