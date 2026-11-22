(function(window, document){
  'use strict';
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Diagnostics self-test';
  button.addEventListener('click', function(){
    window.MobilePokerDiagnostics.report('selftest', 'handled');
    window.setTimeout(function(){
      throw new Error('Diagnostics self-test');
    }, 0);
    window.setTimeout(function(){
      Promise.reject(new Error('Diagnostics self-test'));
    }, 250);
  });
  document.body.appendChild(button);
})(window, document);
