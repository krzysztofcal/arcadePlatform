(function(){
  function InputController(opts){
    const {
      canvas,
      paddle,
      leftBtn,
      rightBtn,
      onStart,
      onBuy,
      onReset,
      playBtn,
      buyBtn,
      resetBtn,
      widthProvider,
      btnMute,
      btnPause,
      onToggleMute,
      onTogglePause,
      onActivity
    } = opts;
    const nudge = typeof onActivity === 'function' ? onActivity : function(){};
    function clientToCanvasX(clientX){ const r=canvas.getBoundingClientRect(); return (clientX-r.left); }
    function setPaddleByPointerX(clientX){ const cx=clientToCanvasX(clientX); paddle.x=Math.max(0, Math.min(widthProvider()-paddle.w, cx-paddle.w/2)); }
    window.addEventListener('keydown', e=>{ if(e.key==='ArrowLeft'){ paddle.left=true; nudge(); } if(e.key==='ArrowRight'){ paddle.right=true; nudge(); } });
    window.addEventListener('keyup', e=>{ if(e.key==='ArrowLeft'){ paddle.left=false; nudge(); } if(e.key==='ArrowRight'){ paddle.right=false; nudge(); } });
    canvas.addEventListener('pointerdown', e=>{ setPaddleByPointerX(e.clientX); nudge(); e.preventDefault(); }, {passive:false});
    canvas.addEventListener('pointermove', e=>{ if(e.buttons){ setPaddleByPointerX(e.clientX); nudge(); } e.preventDefault(); }, {passive:false});
    let btnInterval=null;
    function pressDir(dir){ if(btnInterval) clearInterval(btnInterval); if(dir==='left'){ paddle.left=true; paddle.right=false; } if(dir==='right'){ paddle.right=true; paddle.left=false; } nudge(); btnInterval=setInterval(()=>{},50); }
    function releaseDir(){ if(btnInterval) clearInterval(btnInterval); paddle.left=false; paddle.right=false; }
    leftBtn.addEventListener('pointerdown',()=>pressDir('left'));
    rightBtn.addEventListener('pointerdown',()=>pressDir('right'));
    leftBtn.addEventListener('pointerup',()=>{ releaseDir(); nudge(); });
    rightBtn.addEventListener('pointerup',()=>{ releaseDir(); nudge(); });
    leftBtn.addEventListener('pointerleave',releaseDir);
    rightBtn.addEventListener('pointerleave',releaseDir);
    playBtn.addEventListener('click', ()=>{ if(onStart) onStart(); nudge(); });
    buyBtn.addEventListener('click', ()=>{ if(onBuy) onBuy(); nudge(); });
    resetBtn.addEventListener('click', ()=>{ if(onReset) onReset(); nudge(); });

    if (btnMute && onToggleMute) btnMute.addEventListener('click', ()=>{ onToggleMute(); nudge(); });
    if (btnPause && onTogglePause) btnPause.addEventListener('click', ()=>{ onTogglePause(); nudge(); });

    window.addEventListener('keydown', e=>{
      if (e.code === 'Space') { e.preventDefault(); if (onTogglePause) onTogglePause(); nudge(); }
      if (e.code === 'KeyM') { if (onToggleMute) onToggleMute(); nudge(); }
    });
    return { };
  }
  window.InputController = InputController;
})();
