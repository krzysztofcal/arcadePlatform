/**
 * Freedoom Game - js-dos integration with XP system
 * Arcade Hub adaptation using Freedoom (BSD License) and js-dos (GPL-2.0)
 */
(function() {
  'use strict';

  function klog(kind, data) {
    if (window.KLog && typeof window.KLog.log === 'function') {
      window.KLog.log(kind, data);
    }
  }

  var state = { running: false, paused: false, muted: false, loaded: false, startTime: null, ci: null, timeInterval: null, activityInterval: null, listenersAttached: false };

  var elements = { dos: null, playBtn: null, restartBtn: null, timeEl: null, loadingOverlay: null, loadingProgress: null, loadingText: null, mobileControls: null };

  var FREEDOOM_BUNDLE_URL = 'https://cdn.dos.zone/original/2X/2/24b00b14f118580763440ecaddcc948f8cb94f14.jsdos';

  function initElements() {
    elements.dos = document.getElementById('dos');
    elements.playBtn = document.getElementById('play');
    elements.restartBtn = document.getElementById('restart');
    elements.timeEl = document.getElementById('time');
    elements.loadingOverlay = document.getElementById('loadingOverlay');
    elements.loadingProgress = document.getElementById('loadingProgress');
    elements.loadingText = document.querySelector('.loading-text');
    elements.mobileControls = document.getElementById('mobileControls');
  }

  function formatTime(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function updateTime() {
    if (!state.running || state.paused || !state.startTime) return;
    var elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    if (elements.timeEl) elements.timeEl.textContent = formatTime(elapsed);
  }

  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 768);
  }

  function initMobileControls() {
    if (!isMobile()) {
      if (elements.mobileControls) elements.mobileControls.style.display = 'none';
      return;
    }
    if (elements.mobileControls) elements.mobileControls.style.display = 'flex';

    var moveJoystick = document.getElementById('moveJoystick');
    var lookJoystick = document.getElementById('lookJoystick');
    if (moveJoystick) setupJoystick(moveJoystick, handleMoveJoystick);
    if (lookJoystick) setupJoystick(lookJoystick, handleLookJoystick);

    var fireBtn = document.getElementById('btnFire');
    var useBtn = document.getElementById('btnUse');

    if (fireBtn) {
      fireBtn.addEventListener('touchstart', function(e) { e.preventDefault(); sendKey('ControlLeft', true); notifyActivity(); }, { passive: false });
      fireBtn.addEventListener('touchend', function(e) { e.preventDefault(); sendKey('ControlLeft', false); }, { passive: false });
    }
    if (useBtn) {
      useBtn.addEventListener('touchstart', function(e) { e.preventDefault(); sendKey('Space', true); notifyActivity(); }, { passive: false });
      useBtn.addEventListener('touchend', function(e) { e.preventDefault(); sendKey('Space', false); }, { passive: false });
    }

    var weaponBtns = document.querySelectorAll('.weapon-btn');
    weaponBtns.forEach(function(btn) {
      btn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        var weapon = btn.getAttribute('data-weapon');
        if (weapon) {
          sendKey('Digit' + weapon, true);
          notifyActivity();
          setTimeout(function() { sendKey('Digit' + weapon, false); }, 100);
        }
      }, { passive: false });
    });
  }

  var joystickState = { move: { x: 0, y: 0, active: false }, look: { x: 0, y: 0, active: false } };

  function setupJoystick(element, handler) {
    var stick = element.querySelector('.joystick-stick');
    var base = element.querySelector('.joystick-base');
    var rect = null;
    var centerX = 0;
    var centerY = 0;
    var maxDistance = 40;

    function updateRect() { rect = base.getBoundingClientRect(); centerX = rect.width / 2; centerY = rect.height / 2; }

    function handleMove(clientX, clientY) {
      if (!rect) updateRect();
      var x = clientX - rect.left - centerX;
      var y = clientY - rect.top - centerY;
      var distance = Math.sqrt(x * x + y * y);
      if (distance > maxDistance) { x = (x / distance) * maxDistance; y = (y / distance) * maxDistance; }
      stick.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
      handler(x / maxDistance, y / maxDistance, true);
    }

    function handleEnd() { stick.style.transform = 'translate(0, 0)'; handler(0, 0, false); }

    element.addEventListener('touchstart', function(e) { e.preventDefault(); updateRect(); handleMove(e.touches[0].clientX, e.touches[0].clientY); notifyActivity(); }, { passive: false });
    element.addEventListener('touchmove', function(e) { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    element.addEventListener('touchend', function(e) { e.preventDefault(); handleEnd(); }, { passive: false });
    element.addEventListener('touchcancel', function(e) { e.preventDefault(); handleEnd(); }, { passive: false });
  }

  var movementKeys = { up: false, down: false, left: false, right: false };

  function handleMoveJoystick(x, y, active) {
    joystickState.move = { x: x, y: y, active: active };
    var threshold = 0.3;
    var shouldMoveUp = y < -threshold;
    var shouldMoveDown = y > threshold;
    if (shouldMoveUp !== movementKeys.up) { movementKeys.up = shouldMoveUp; sendKey('KeyW', shouldMoveUp); }
    if (shouldMoveDown !== movementKeys.down) { movementKeys.down = shouldMoveDown; sendKey('KeyS', shouldMoveDown); }
    var shouldMoveLeft = x < -threshold;
    var shouldMoveRight = x > threshold;
    if (shouldMoveLeft !== movementKeys.left) { movementKeys.left = shouldMoveLeft; sendKey('KeyA', shouldMoveLeft); }
    if (shouldMoveRight !== movementKeys.right) { movementKeys.right = shouldMoveRight; sendKey('KeyD', shouldMoveRight); }
  }

  var lookKeys = { left: false, right: false };

  function handleLookJoystick(x, y, active) {
    joystickState.look = { x: x, y: y, active: active };
    var threshold = 0.3;
    var shouldTurnLeft = x < -threshold;
    var shouldTurnRight = x > threshold;
    if (shouldTurnLeft !== lookKeys.left) { lookKeys.left = shouldTurnLeft; sendKey('ArrowLeft', shouldTurnLeft); }
    if (shouldTurnRight !== lookKeys.right) { lookKeys.right = shouldTurnRight; sendKey('ArrowRight', shouldTurnRight); }
  }

  function sendKey(code, pressed) {
    if (!state.ci) return;
    try {
      if (pressed) { state.ci.simulateKeyPress(keyCodeFromString(code)); }
      else { state.ci.simulateKeyRelease(keyCodeFromString(code)); }
    } catch (e) {
      try {
        var event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code: code, key: code, bubbles: true, cancelable: true });
        elements.dos.dispatchEvent(event);
      } catch (e2) {
        klog('freedoom_key_error', { code: code, error: String(e2) });
      }
    }
  }

  function keyCodeFromString(code) {
    var keyMap = { 'KeyW': 17, 'KeyA': 30, 'KeyS': 31, 'KeyD': 32, 'KeyE': 18, 'Space': 57, 'ControlLeft': 29, 'ControlRight': 29, 'ShiftLeft': 42, 'Enter': 28, 'Escape': 1, 'ArrowUp': 72, 'ArrowDown': 80, 'ArrowLeft': 75, 'ArrowRight': 77, 'Digit1': 2, 'Digit2': 3, 'Digit3': 4, 'Digit4': 5, 'Digit5': 6, 'Digit6': 7, 'Digit7': 8 };
    return keyMap[code] || 0;
  }

  function notifyActivity() {
    if (window.GameXpBridge && typeof window.GameXpBridge.nudge === 'function') window.GameXpBridge.nudge();
  }

  function showLoading(show, errorMsg) {
    if (elements.loadingOverlay) {
      elements.loadingOverlay.style.display = show ? 'flex' : 'none';
      if (errorMsg && elements.loadingText) {
        elements.loadingText.textContent = errorMsg;
        elements.loadingText.style.color = '#ff6b6b';
      }
    }
  }

  function startGame() {
    if (state.loaded) { resumeGame(); return; }
    if (elements.playBtn) { elements.playBtn.disabled = true; elements.playBtn.textContent = 'Loading...'; }
    showLoading(true);

    var config = { url: FREEDOOM_BUNDLE_URL, autoStart: true, kiosk: false, noSideBar: true, noFullscreen: true, noSocialLinks: true };

    Dos(elements.dos, config).then(function(ci) {
      state.ci = ci;
      state.loaded = true;
      state.running = true;
      state.startTime = Date.now();
      showLoading(false);
      if (elements.playBtn) elements.playBtn.style.display = 'none';
      if (elements.restartBtn) elements.restartBtn.style.display = 'inline-flex';
      initMobileControls();
      if (state.timeInterval) clearInterval(state.timeInterval);
      state.timeInterval = setInterval(updateTime, 1000);
      setupGameEventListeners();
      klog('freedoom_loaded', { success: true });
    }).catch(function(error) {
      klog('freedoom_load_error', { error: String(error) });
      showLoading(true, 'Failed to load. Tap Retry.');
      if (elements.playBtn) { elements.playBtn.disabled = false; elements.playBtn.textContent = 'Retry'; }
    });
  }

  function setupGameEventListeners() {
    if (state.listenersAttached) return;
    state.listenersAttached = true;
    document.addEventListener('keydown', function() { notifyActivity(); }, { passive: true });
    document.addEventListener('mousedown', function() { notifyActivity(); }, { passive: true });
    document.addEventListener('touchstart', function() { notifyActivity(); }, { passive: true });
    if (state.activityInterval) clearInterval(state.activityInterval);
    state.activityInterval = setInterval(function() { if (state.running && !state.paused) notifyActivity(); }, 3000);
  }

  function resumeGame() { if (!state.ci) return; state.paused = false; state.running = true; }

  function pauseGame() {
    if (!state.ci) return;
    state.paused = true;
    sendKey('Escape', true);
    setTimeout(function() { sendKey('Escape', false); }, 100);
  }

  function restartGame() {
    if (state.ci) { sendKey('Escape', true); setTimeout(function() { sendKey('Escape', false); }, 100); }
    state.startTime = Date.now();
    if (elements.timeEl) elements.timeEl.textContent = '0:00';
  }

  window.FreedoomGame = {
    start: startGame,
    pause: pauseGame,
    resume: resumeGame,
    restart: restartGame,
    setMuted: function(muted) { state.muted = muted; if (state.ci && state.ci.setVolume) state.ci.setVolume(muted ? 0 : 1); },
    setPaused: function(paused) { if (paused) pauseGame(); else resumeGame(); },
    isMuted: function() { return state.muted; },
    isPaused: function() { return state.paused; },
    isRunning: function() { return state.running; }
  };

  function init() {
    initElements();
    if (elements.playBtn) elements.playBtn.addEventListener('click', startGame);
    if (elements.restartBtn) elements.restartBtn.addEventListener('click', restartGame);
    window.addEventListener('resize', function() { if (state.loaded) initMobileControls(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
