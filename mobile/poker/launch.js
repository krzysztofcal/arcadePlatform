(function(){
  'use strict';
  // Entry and lobby share the same critical, inline-painted loading screen.
  if (window.location.pathname !== '/poker/index.html' && window.location.pathname !== '/poker/') {
    window.location.replace('/poker/index.html');
    return;
  }
  function ready(){
    var overlay = document.getElementById('pokerLaunch');
    if (!overlay) return;
    var styles = Array.prototype.filter.call(document.querySelectorAll('link[rel="stylesheet"]'), function(link){ return !link.disabled; });
    // Do not reveal unstyled fallback content if a bundled stylesheet failed.
    if (styles.some(function(link){ return !link.sheet; })) return;
    var images = Array.prototype.map.call(document.querySelectorAll('.tile--online img,.tile--offline img'), function(image){
      return image.decode ? image.decode().catch(function(){}) : Promise.resolve();
    });
    Promise.all([document.fonts ? document.fonts.ready : Promise.resolve()].concat(images)).then(function(){
      // Layout and styles have a painted frame before the overlay is removed.
      window.requestAnimationFrame(function(){
        window.requestAnimationFrame(function(){ overlay.hidden = true; });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
