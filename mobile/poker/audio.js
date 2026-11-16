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
})();
