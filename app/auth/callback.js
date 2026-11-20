(function () {
  'use strict';
  try {
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  } catch (e) {
    // Best effort only: if replaceState throws, the address stays unchanged; nothing is logged or sent.
  }
})();
