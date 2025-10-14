(function(){
  function FullscreenService(opts){
    const { wrap, btnEnter, btnExit, overlayExit, canvas, aspect, reserved, onResizeRequest } = opts;
    function isActive(){ return document.fullscreenElement === wrap || document.webkitFullscreenElement === wrap; }
    function enter(){ if (wrap.requestFullscreen) wrap.requestFullscreen(); else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen(); }
    function exit(){ if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); }
    function fit(){
      if (!isActive()) { canvas.style.width = '100%'; requestAnimationFrame(onResizeRequest); return; }
      const wrapRect = wrap.getBoundingClientRect();
      const maxW = wrapRect.width - 20;
      const maxHforCanvas = Math.max(200, (window.innerHeight - reserved));
      const fitWidth = Math.min(maxW, Math.floor(maxHforCanvas * aspect));
      canvas.style.width = fitWidth + 'px';
      requestAnimationFrame(onResizeRequest);
    }
    function syncButtons(){
      const isFs = isActive();
      btnEnter.style.display = isFs ? 'none' : '';
      btnExit.style.display = isFs ? '' : 'none';
      wrap.classList.toggle('fsActive', isFs);
      fit();
    }
    function init(){
      btnEnter.addEventListener('click', e=>{ e.preventDefault(); enter(); });
      btnExit.addEventListener('click', e=>{ e.preventDefault(); exit(); });
      overlayExit.addEventListener('click', e=>{ e.preventDefault(); exit(); });
      document.addEventListener('fullscreenchange', syncButtons);
      document.addEventListener('webkitfullscreenchange', syncButtons);
      window.addEventListener('resize', ()=>fit());
      syncButtons();
    }
    return { isActive, enter, exit, fit, syncButtons, init };
  }
  window.FullscreenService = FullscreenService;
})();

