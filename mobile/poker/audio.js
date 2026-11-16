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
  // Resolves the named boolean of the native result, or false on any failure.
  function call(method, options, field){
    try {
      var native = plugin();
      if (!native) return Promise.resolve(false);
      return Promise.resolve(native[method](options)).then(function(result){
        return field ? !!(result && result[field]) : true;
      }).catch(function(){ failed(); return false; });
    } catch (_err){
      failed();
      return Promise.resolve(false);
    }
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

  function mountToggle(){
    try {
      if (!plugin() || typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') return;
      if (document.getElementById('mobileSoundSetting')) return;
      var panel = document.getElementById('pokerSocialSettingsPanel');
      var avatar = document.getElementById('avatarMenu');
      var host = panel || avatar;
      if (!host) return;

      var label = document.createElement('label');
      label.id = 'mobileSoundSetting';
      label.hidden = true;

      var input;
      try {
        label.innerHTML = '<input type="checkbox" id="mobileSoundPreference"> Sound';
        input = label.querySelector ? label.querySelector('#mobileSoundPreference') : (label.children && label.children[0]);
      } catch (_err){}
      if (!input) {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'mobileSoundPreference';
        label.appendChild(input);
        if (typeof document.createTextNode === 'function') {
          label.appendChild(document.createTextNode(' Sound'));
        }
      }

      if (panel) {
        label.className = 'poker-social-settings__option';
        var firstOption = panel.querySelector && panel.querySelector('.poker-social-settings__option');
        if (firstOption && firstOption.parentNode === panel && typeof panel.insertBefore === 'function') {
          panel.insertBefore(label, firstOption);
        } else {
          panel.appendChild(label);
        }
      } else {
        label.className = 'avatar-menu__sound';
        avatar.appendChild(label);
      }

      function sync(on){
        input.checked = !!on;
        label.hidden = false;
      }

      window.MobilePokerAudio.isEnabled().then(sync).catch(function(){});

      input.addEventListener('change', function(){
        window.MobilePokerAudio.setEnabled(input.checked).then(function(on){
          input.checked = !!on;
        }).catch(function(){});
      });

      function refresh(){
        window.MobilePokerAudio.isEnabled().then(function(on){
          input.checked = !!on;
        }).catch(function(){});
      }

      if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
        window.addEventListener('pageshow', refresh);
      }
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', function(){
          if (document.visibilityState === 'visible' || !document.hidden) refresh();
        });
      }
    } catch (_err){
      // Failure never throws into the page
    }
  }

  try {
    if (plugin() && typeof document !== 'undefined' && document) {
      if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', mountToggle);
      } else {
        mountToggle();
      }
    }
  } catch (_err){}
})();
