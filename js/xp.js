(function (window, document) {
  if (!window || !window.XpCore || typeof window.XpCore.boot !== 'function') {
    if (window && window.console && console.error) {
      console.error('[xp] core module missing');
    }
    return;
  }
  window.XpCore.boot(window, document);
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);
