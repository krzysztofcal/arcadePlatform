(function () {
  'use strict';
  try {
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  } catch (e) {
    // Fail closed without logging or exposing location/token state.
  }
})();
