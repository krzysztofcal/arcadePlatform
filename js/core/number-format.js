(function(){
  if (typeof window === 'undefined') return;
  if (!window.ArcadeFormat){ window.ArcadeFormat = {}; }
  if (typeof window.ArcadeFormat.formatCompactNumber === 'function') return;
  window.ArcadeFormat.formatCompactNumber = function(value){
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    var abs = Math.abs(numeric);
    var sign = numeric < 0 ? '-' : '';
    if (abs < 1000) return '' + sign + Math.round(abs);
    var divisor = 1000;
    var suffix = 'k';
    if (abs >= 1e9){ divisor = 1e9; suffix = 'b'; }
    else if (abs >= 1e6){ divisor = 1e6; suffix = 'm'; }
    var scaled = abs / divisor;
    var rounded = scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
    var text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return '' + sign + text + suffix;
  };
})();
