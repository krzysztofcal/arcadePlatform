(function(window){
  'use strict';
  if (window.location.origin !== 'https://localhost') return;
  var busy = false;
  function report(code, stage, file, line){
    if (busy) return;
    var capacitor = window.Capacitor;
    var bridge = capacitor && capacitor.Plugins && capacitor.Plugins.PokerDiagnostics;
    if (!bridge) return;
    var payload = { code: code, stage: stage };
    if (file) payload.js_file = file;
    if (Number.isInteger(line) && line >= 1 && line <= 999999) payload.js_line = line;
    busy = true;
    try {
      Promise.resolve(bridge.report(payload)).catch(function(){});
    } catch (_err){
      // Bridge failures must not surface as application errors.
    } finally {
      busy = false;
    }
  }
  var stage = window.location.pathname === '/poker/offline/play.html' ? 'offline' : 'window';
  window.MobilePokerDiagnostics = { report: function(code, category){ report(code, category); } };
  window.addEventListener('error', function(event){
    if (!event.filename) return;
    var source;
    try { source = new URL(event.filename); } catch (_err){ return; }
    if (source.origin !== 'https://localhost') return;
    var file = source.pathname.slice(source.pathname.lastIndexOf('/') + 1);
    report('js_uncaught', stage, /^[a-z0-9_.-]{1,40}\.js$/.test(file) ? file : null, event.lineno);
  });
  window.addEventListener('unhandledrejection', function(){
    report('js_unhandled_rejection', stage);
  });
})(window);
