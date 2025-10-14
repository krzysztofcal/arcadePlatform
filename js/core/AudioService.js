(function(){
  function AudioService(){
    let audioCtx = null;
    function ensure(){ if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }
    function meow(){
      ensure(); const now=audioCtx.currentTime;
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.type="triangle"; o.frequency.setValueAtTime(300, now); o.frequency.exponentialRampToValueAtTime(220, now+0.12);
      g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.3, now+0.02); g.gain.exponentialRampToValueAtTime(0.0001, now+0.22);
      o.connect(g).connect(audioCtx.destination); o.start(now); o.stop(now+0.25);
    }
    function hiss(){
      ensure(); const now=audioCtx.currentTime; const len=2*audioCtx.sampleRate*0.2; const buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
      const data=buf.getChannelData(0); for(let i=0;i<len;i++) data[i]=(Math.random()*2-1)*0.6;
      const src=audioCtx.createBufferSource(); src.buffer=buf; const filter=audioCtx.createBiquadFilter(); filter.type="highpass"; filter.frequency.value=2000;
      const g=audioCtx.createGain(); g.gain.value=0.2; src.connect(filter).connect(g).connect(audioCtx.destination); src.start(now); src.stop(now+0.2);
    }
    return { ensure, meow, hiss };
  }
  window.AudioService = AudioService;
})();

