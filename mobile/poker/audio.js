(function(){
  'use strict';

  var CUE_RE = /^[a-z0-9_]{1,40}$/;

  function klog(){
    if (window.KLog && typeof window.KLog.log === 'function') {
      window.KLog.log('mobile:audio_failed', {});
    }
  }

  function isAndroidActive(){
    var cap = window.Capacitor;
    return !!(cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android' && cap.Plugins && cap.Plugins.PokerAudio);
  }

  function getPlugin(){
    return isAndroidActive() ? window.Capacitor.Plugins.PokerAudio : null;
  }

  function isValidCue(cue){
    return typeof cue === 'string' && CUE_RE.test(cue) && cue !== 'lobby';
  }

  var unlocked = false;
  function onGesture(){
    if (unlocked) return;
    unlocked = true;
    try {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointerdown', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
      }
    } catch (_e){}
    try {
      var p = getPlugin();
      if (p && typeof p.unlock === 'function') {
        Promise.resolve(p.unlock()).catch(function(){ klog(); });
      }
    } catch (_err){
      klog();
    }
  }

  if (isAndroidActive()) {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('pointerdown', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
    }
  }

  window.MobilePokerAudio = {
    available: function(){
      return isAndroidActive();
    },
    isEnabled: function(){
      if (!isAndroidActive()) return Promise.resolve(false);
      try {
        var p = getPlugin();
        if (!p || typeof p.getState !== 'function') return Promise.resolve(false);
        return Promise.resolve(p.getState()).then(function(res){
          return !!(res && res.enabled);
        }).catch(function(){
          klog();
          return false;
        });
      } catch (_err){
        klog();
        return Promise.resolve(false);
      }
    },
    setEnabled: function(on){
      if (!isAndroidActive()) return Promise.resolve(false);
      try {
        var p = getPlugin();
        if (!p || typeof p.setEnabled !== 'function') return Promise.resolve(false);
        return Promise.resolve(p.setEnabled({ enabled: !!on })).then(function(res){
          return !!(res && res.enabled);
        }).catch(function(){
          klog();
          return false;
        });
      } catch (_err){
        klog();
        return Promise.resolve(false);
      }
    },
    play: function(cue){
      if (!isAndroidActive()) return Promise.resolve(false);
      if (!isValidCue(cue)) return Promise.resolve(false);
      try {
        var p = getPlugin();
        if (!p || typeof p.play !== 'function') return Promise.resolve(false);
        return Promise.resolve(p.play({ cue: cue, channel: 'sfx' })).then(function(res){
          return !!(res && res.played);
        }).catch(function(){
          klog();
          return false;
        });
      } catch (_err){
        klog();
        return Promise.resolve(false);
      }
    },
    voice: function(cue){
      if (!isAndroidActive()) return Promise.resolve(false);
      if (!isValidCue(cue)) return Promise.resolve(false);
      try {
        var p = getPlugin();
        if (!p || typeof p.play !== 'function') return Promise.resolve(false);
        return Promise.resolve(p.play({ cue: cue, channel: 'voice' })).then(function(res){
          return !!(res && res.played);
        }).catch(function(){
          klog();
          return false;
        });
      } catch (_err){
        klog();
        return Promise.resolve(false);
      }
    },
    preload: function(cues){
      if (!isAndroidActive()) return Promise.resolve(false);
      try {
        var valid = [];
        if (Array.isArray(cues)) {
          for (var i = 0; i < cues.length; i++) {
            if (isValidCue(cues[i])) valid.push(cues[i]);
          }
        }
        var p = getPlugin();
        if (!p || typeof p.preload !== 'function') return Promise.resolve(false);
        return Promise.resolve(p.preload({ cues: valid })).then(function(){
          return true;
        }).catch(function(){
          klog();
          return false;
        });
      } catch (_err){
        klog();
        return Promise.resolve(false);
      }
    },
    stop: function(){
      if (!isAndroidActive()) return Promise.resolve();
      try {
        var p = getPlugin();
        if (!p || typeof p.stop !== 'function') return Promise.resolve();
        return Promise.resolve(p.stop()).catch(function(){
          klog();
        });
      } catch (_err){
        klog();
        return Promise.resolve();
      }
    }
  };
})();
