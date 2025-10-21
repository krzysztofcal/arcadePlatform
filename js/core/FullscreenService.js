(function(){
  function FullscreenService(opts){
    const { wrap, btnEnter, btnExit, overlayExit, canvas, aspect, reserved, onResizeRequest, analyticsContext } = opts;
    const analytics = window.Analytics;
    let pendingAction = null;
    let lastState = false;

    function contextPayload(){
      if (!analyticsContext) return {};
      if (typeof analyticsContext === 'string') return { context: analyticsContext };
      try { return { ...analyticsContext }; } catch (_) { return {}; }
    }

    function emit(state){
      if (!(analytics && analytics.fullscreenToggle)) return;
      const payload = { state: state ? 'enter' : 'exit', ...contextPayload() };
      if (pendingAction){
        if (pendingAction.trigger) payload.trigger = pendingAction.trigger;
        if (pendingAction.requested) payload.requested = pendingAction.requested;
      } else {
        payload.trigger = 'system';
      }
      analytics.fullscreenToggle(payload);
    }

    function isActive(){ return document.fullscreenElement === wrap || document.webkitFullscreenElement === wrap; }
    function enter(){
      pendingAction = { trigger: 'button', requested: 'enter' };
      if (wrap.requestFullscreen) wrap.requestFullscreen(); else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
    }
    function exit(){
      pendingAction = { trigger: 'button', requested: 'exit' };
      if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
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
      if (lastState !== isFs){
        emit(isFs);
        lastState = isFs;
      }
      pendingAction = null;
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
