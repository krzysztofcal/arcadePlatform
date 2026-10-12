(function () {
  'use strict';

  function klog(msg, data) {
    if (typeof window !== 'undefined' && typeof window.klog === 'function') {
      window.klog('[DealerPoC] ' + msg, data);
    }
  }

  var STATE_CONFIG = {
    idle: {
      name: 'Idle (Breathing & Blink)',
      src: './assets/idle.webp',
      frames: 105,
      duration: '3.46 s',
      fps: '30.3 FPS (33ms/frame)',
      size: '7.55 MiB',
      loop: 'Infinite Loop (Periodic)',
      autoRevert: false
    },
    deal: {
      name: 'Deal (Card Slide & Pitch)',
      src: './assets/deal.webp',
      frames: 30,
      duration: '0.99 s',
      fps: '30.3 FPS (33ms/frame)',
      size: '2.37 MiB',
      loop: 'One-Shot -> Returns to Idle',
      autoRevert: true,
      revertMs: 1050
    },
    'hand-end': {
      name: 'Hand End (Nod & Gracious Smile)',
      src: './assets/hand-end.webp',
      frames: 36,
      duration: '1.19 s',
      fps: '30.3 FPS (33ms/frame)',
      size: '2.10 MiB',
      loop: 'One-Shot -> Returns to Idle',
      autoRevert: true,
      revertMs: 1250
    },
    static: {
      name: 'Original Static Baseline',
      src: './assets/dealer-v2.webp',
      frames: 1,
      duration: 'Static Poster',
      fps: 'N/A (Poster)',
      size: '82.0 KiB',
      loop: 'None',
      autoRevert: false
    }
  };

  var currentState = 'idle';
  var isReducedMotion = false;
  var revertTimer = null;

  var dom = {
    dealerImg: document.getElementById('dealerAnimImg'),
    dealerOverlayImg: document.getElementById('dealerOverlayImg'),
    sideImg: document.getElementById('dealerSideImg'),
    scene: document.getElementById('pocScene'),
    btnIdle: document.getElementById('btnIdle'),
    btnDeal: document.getElementById('btnDeal'),
    btnHandEnd: document.getElementById('btnHandEnd'),
    btnStatic: document.getElementById('btnStatic'),
    btnOrientation: document.getElementById('btnOrientation'),
    btnReducedMotion: document.getElementById('btnReducedMotion'),
    telemState: document.getElementById('telemState'),
    telemFps: document.getElementById('telemFps'),
    telemFrames: document.getElementById('telemFrames'),
    telemDuration: document.getElementById('telemDuration'),
    telemSize: document.getElementById('telemSize'),
    telemLoop: document.getElementById('telemLoop'),
    telemLiveFps: document.getElementById('telemLiveFps')
  };

  function updateTelemetry(cfg) {
    if (dom.telemState) dom.telemState.textContent = cfg.name;
    if (dom.telemFps) dom.telemFps.textContent = cfg.fps;
    if (dom.telemFrames) dom.telemFrames.textContent = cfg.frames + ' frames';
    if (dom.telemDuration) dom.telemDuration.textContent = cfg.duration;
    if (dom.telemSize) dom.telemSize.textContent = cfg.size;
    if (dom.telemLoop) dom.telemLoop.textContent = cfg.loop;
  }

  function setActiveButton(state) {
    [dom.btnIdle, dom.btnDeal, dom.btnHandEnd, dom.btnStatic].forEach(function (btn) {
      if (!btn) return;
      if (btn.getAttribute('data-state') === state) {
        btn.classList.add('poc-btn--active');
      } else {
        btn.classList.remove('poc-btn--active');
      }
    });
  }

  function applyState(stateName) {
    if (revertTimer) {
      clearTimeout(revertTimer);
      revertTimer = null;
    }

    currentState = stateName;
    var cfg = STATE_CONFIG[stateName] || STATE_CONFIG.idle;
    var targetSrc = isReducedMotion ? STATE_CONFIG.static.src : cfg.src;

    if (dom.dealerImg) dom.dealerImg.src = targetSrc;
    if (dom.dealerOverlayImg) dom.dealerOverlayImg.src = targetSrc;
    if (dom.sideImg) dom.sideImg.src = targetSrc;

    setActiveButton(stateName);
    updateTelemetry(cfg);
    klog('Switched dealer animation state to ' + stateName, { src: targetSrc, reducedMotion: isReducedMotion });

    if (cfg.autoRevert && !isReducedMotion) {
      revertTimer = setTimeout(function () {
        klog('Auto-reverting to idle from ' + stateName);
        applyState('idle');
      }, cfg.revertMs || 1100);
    }
  }

  function toggleOrientation() {
    if (!dom.scene) return;
    var current = dom.scene.getAttribute('data-orientation') || 'portrait';
    var next = current === 'portrait' ? 'landscape' : 'portrait';
    dom.scene.setAttribute('data-orientation', next);
    if (dom.btnOrientation) {
      dom.btnOrientation.textContent = next === 'portrait' ? 'View: Portrait (360x480)' : 'View: Landscape (720x440)';
    }
    klog('Toggled preview orientation to ' + next);
  }

  function toggleReducedMotion() {
    isReducedMotion = !isReducedMotion;
    if (dom.btnReducedMotion) {
      dom.btnReducedMotion.textContent = isReducedMotion ? 'Reduced Motion: ON (Static)' : 'Reduced Motion: OFF';
      dom.btnReducedMotion.classList.toggle('poc-btn--active', isReducedMotion);
    }
    applyState(currentState);
  }

  // Real-time render loop FPS meter
  var frameCount = 0;
  var lastFpsTime = performance.now();
  function measureFps(now) {
    frameCount++;
    if (now - lastFpsTime >= 500) {
      var measuredFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      if (dom.telemLiveFps) {
        dom.telemLiveFps.textContent = measuredFps + ' FPS';
      }
      frameCount = 0;
      lastFpsTime = now;
    }
    requestAnimationFrame(measureFps);
  }

  function bindEvents() {
    if (dom.btnIdle) dom.btnIdle.addEventListener('click', function () { applyState('idle'); });
    if (dom.btnDeal) dom.btnDeal.addEventListener('click', function () { applyState('deal'); });
    if (dom.btnHandEnd) dom.btnHandEnd.addEventListener('click', function () { applyState('hand-end'); });
    if (dom.btnStatic) dom.btnStatic.addEventListener('click', function () { applyState('static'); });
    if (dom.btnOrientation) dom.btnOrientation.addEventListener('click', toggleOrientation);
    if (dom.btnReducedMotion) dom.btnReducedMotion.addEventListener('click', toggleReducedMotion);

    // Respect system prefers-reduced-motion media query
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.matches) {
        isReducedMotion = true;
        if (dom.btnReducedMotion) {
          dom.btnReducedMotion.textContent = 'Reduced Motion: ON (System)';
          dom.btnReducedMotion.classList.add('poc-btn--active');
        }
      }
      mq.addEventListener('change', function (e) {
        isReducedMotion = e.matches;
        if (dom.btnReducedMotion) {
          dom.btnReducedMotion.textContent = isReducedMotion ? 'Reduced Motion: ON (System)' : 'Reduced Motion: OFF';
          dom.btnReducedMotion.classList.toggle('poc-btn--active', isReducedMotion);
        }
        applyState(currentState);
      });
    }
  }

  function init() {
    bindEvents();
    applyState('idle');
    requestAnimationFrame(measureFps);
    klog('Dealer PoC initialized successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
