(function(){
  'use strict';
  // Android APK only. The native PokerAudio plugin owns every sound and the music playhead;
  // this adapter is a thin, never-throwing bridge. Browsers and WWW get silent no-ops.
  // Lobby music starts natively by itself; no page script or user gesture is involved.
  var CUE = /^[a-z0-9_]{1,40}$/;
  function plugin(){
    var cap = window.Capacitor;
    return cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android' && cap.Plugins && cap.Plugins.PokerAudio || null;
  }
  function failed(){
    if (window.KLog && window.KLog.log) window.KLog.log('mobile:audio_failed', {});
  }
  // Resolves the native result object, or null when the call failed or there is no plugin.
  function native(method, options){
    try {
      var target = plugin();
      if (!target) return Promise.resolve(null);
      return Promise.resolve(target[method](options)).then(function(result){ return result || {}; }).catch(function(){ failed(); return null; });
    } catch (_err){
      failed();
      return Promise.resolve(null);
    }
  }
  // Public calls resolve a plain boolean: the named field of the result, false on any failure.
  function call(method, options, field){
    return native(method, options).then(function(result){ return !!result && (field ? !!result[field] : true); });
  }
  function cue(name, channel){
    if (typeof name !== 'string' || !CUE.test(name)) return Promise.resolve(false);
    return call('play', { cue: name, channel: channel }, 'played');
  }
  window.MobilePokerAudio = {
    available: function(){ return !!plugin(); },
    isEnabled: function(){ return call('getState', undefined, 'enabled'); },
    setEnabled: function(on){ return call('setEnabled', { enabled: !!on }, 'enabled'); },
    play: function(name){ return cue(name, 'sfx'); },
    voice: function(name){ return cue(name, 'voice'); },
    preload: function(names){ return call('preload', { cues: (Array.isArray(names) ? names : []).filter(function(name){ return typeof name === 'string' && CUE.test(name); }) }); },
    stop: function(){ return call('stop'); }
  };

  if (!plugin()) return;
  // Bonus claims happen on the Lobby document, so start decoding the bonus cue as it loads. This
  // does not wait for decoding to finish: a claim confirmed before it does still gets only the
  // native 400 ms pending window (accepted M1 limitation, #1275 review R3).
  if (/^\/poker\/(index\.html)?$/.test(window.location && window.location.pathname || '')) window.MobilePokerAudio.preload(['bonus_coins']);
  // One Sound setting, mounted into the existing menu of each APK screen: Table settings on the
  // Online and Offline tables, the avatar menu on Lobby and Profile. The value lives natively.
  function mount(){
    try {
      var panel = document.getElementById('pokerSocialSettingsPanel');
      var host = panel || document.getElementById('avatarMenu');
      if (!host || document.getElementById('mobileSoundSetting')) return;
      var label = document.createElement('label');
      var input = document.createElement('input');
      // Only a confirmed native state is shown; a failed call hides the control instead of claiming OFF.
      var show = function(state){ label.hidden = !state; if (state) input.checked = !!state.enabled; };
      label.id = 'mobileSoundSetting';
      label.className = panel ? 'poker-social-settings__option' : 'avatar-menu__sound';
      label.hidden = true;
      input.type = 'checkbox';
      input.id = 'mobileSoundPreference';
      label.appendChild(input);
      label.appendChild(document.createTextNode(' Sound'));
      input.addEventListener('change', function(){
        native('setEnabled', { enabled: input.checked }).then(function(state){ return state || native('getState'); }).then(show);
      });
      var first = panel && panel.querySelector('.poker-social-settings__option');
      if (first) first.parentNode.insertBefore(label, first);
      else host.appendChild(label);
      // Every document reads the one native value when it loads; nothing else can change it meanwhile.
      native('getState').then(show);
    } catch (_err){
      failed();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
