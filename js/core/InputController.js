(function(){
  function InputController(opts){
    const { canvas, paddle, leftBtn, rightBtn, onStart, onBuy, onReset, playBtn, buyBtn, resetBtn, widthProvider } = opts;
    function clientToCanvasX(clientX){ const r=canvas.getBoundingClientRect(); return (clientX-r.left); }
    function setPaddleByPointerX(clientX){ const cx=clientToCanvasX(clientX); paddle.x=Math.max(0, Math.min(widthProvider()-paddle.w, cx-paddle.w/2)); }
    window.addEventListener('keydown', e=>{ if(e.key==='ArrowLeft') paddle.left=true; if(e.key==='ArrowRight') paddle.right=true; });
    window.addEventListener('keyup', e=>{ if(e.key==='ArrowLeft') paddle.left=false; if(e.key==='ArrowRight') paddle.right=false; });
    canvas.addEventListener('pointerdown', e=>{ setPaddleByPointerX(e.clientX); e.preventDefault(); }, {passive:false});
    canvas.addEventListener('pointermove', e=>{ if(e.buttons) setPaddleByPointerX(e.clientX); e.preventDefault(); }, {passive:false});
    let btnInterval=null;
    function pressDir(dir){ if(btnInterval) clearInterval(btnInterval); if(dir==='left'){ paddle.left=true; paddle.right=false; } if(dir==='right'){ paddle.right=true; paddle.left=false; } btnInterval=setInterval(()=>{},50); }
    function releaseDir(){ if(btnInterval) clearInterval(btnInterval); paddle.left=false; paddle.right=false; }
    leftBtn.addEventListener('pointerdown',()=>pressDir('left'));
    rightBtn.addEventListener('pointerdown',()=>pressDir('right'));
    leftBtn.addEventListener('pointerup',releaseDir);
    rightBtn.addEventListener('pointerup',releaseDir);
    leftBtn.addEventListener('pointerleave',releaseDir);
    rightBtn.addEventListener('pointerleave',releaseDir);
    playBtn.addEventListener('click', onStart);
    buyBtn.addEventListener('click', onBuy);
    resetBtn.addEventListener('click', onReset);
    return { };
  }
  window.InputController = InputController;
})();

