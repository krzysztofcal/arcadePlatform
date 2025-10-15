(function(){
  function FullscreenService(opts){
    const { wrap, btnEnter, btnExit, overlayExit, canvas, aspect, reserved, onResizeRequest } = opts;
    function isActive(){ return document.fullscreenElement === wrap || document.webkitFullscreenElement === wrap; }
    function enter(){ if (wrap.requestFullscreen) wrap.requestFullscreen(); else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen(); }
    function exit(){ if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); }
    function computeReserved(){
      // If caller passed a number, honor it; otherwise measure DOM siblings
      if (typeof reserved === 'number' && isFinite(reserved)) return reserved;
      let total = 0;
      try {
        const pad = getComputedStyle(wrap);
        const padV = (parseFloat(pad.paddingTop)||0) + (parseFloat(pad.paddingBottom)||0);
        total += padV;
        const measure = (sel)=>{
          wrap.querySelectorAll(sel).forEach(el=>{ if (el !== canvas) { const r=el.getBoundingClientRect(); total += r.height; } });
        };
        // Measure typical UI rows above/below the canvas
        measure('.stats');
        measure('.controls-row');
        const status = wrap.querySelector('#status');
        if (status) { const r = status.getBoundingClientRect(); total += r.height; }
        // Add small margin buffer
        total += 20;
      } catch {}
      // Ensure a sane minimum
      return Math.max(120, Math.min(window.innerHeight * 0.6, total));
    }
    function fit(){
      if (!isActive()) { canvas.style.width = '100%'; requestAnimationFrame(onResizeRequest); return; }
      const wrapRect = wrap.getBoundingClientRect();
      const maxW = wrapRect.width - 20;
      const reservedPx = computeReserved();
      const maxHforCanvas = Math.max(200, (window.innerHeight - reservedPx));
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
