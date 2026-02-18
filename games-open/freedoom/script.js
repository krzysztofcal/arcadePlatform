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

  // Bundle URL - using v8.js-dos.com bundle (cdn.dos.zone is blocked)
  // For DOOM/Freedoom, you'll need to self-host the bundle
  var FREEDOOM_BUNDLE_URL = 'https://v8.js-dos.com/bundles/digger.jsdos';

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
    // Find the canvas inside js-dos container and dispatch keyboard events
    var target = null;
    if (elements.dos) {
      target = elements.dos.querySelector('canvas') || elements.dos;
    }
    if (!target) target = document.activeElement || document.body;

    try {
      // Try CI method first if available
      if (state.ci && typeof state.ci.simulateKeyPress === 'function') {
        if (pressed) { state.ci.simulateKeyPress(keyCodeFromString(code)); }
        else { state.ci.simulateKeyRelease(keyCodeFromString(code)); }
        return;
      }

      // Dispatch keyboard event to canvas
      var keyCode = keyCodeFromString(code);
      var event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
        code: code,
        key: codeToKey(code),
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true
      });
      target.dispatchEvent(event);
    } catch (e) {
      klog('freedoom_key_error', { code: code, error: String(e) });
    }
  }

  function codeToKey(code) {
    var map = { 'KeyW': 'w', 'KeyA': 'a', 'KeyS': 's', 'KeyD': 'd', 'KeyE': 'e', 'Space': ' ', 'ControlLeft': 'Control', 'ControlRight': 'Control', 'ShiftLeft': 'Shift', 'Enter': 'Enter', 'Escape': 'Escape', 'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown', 'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4', 'Digit5': '5', 'Digit6': '6', 'Digit7': '7' };
    return map[code] || code;
  }

  function keyCodeFromString(code) {
    var keyMap = { 'KeyW': 17, 'KeyA': 30, 'KeyS': 31, 'KeyD': 32, 'KeyE': 18, 'Space': 57, 'ControlLeft': 29, 'ControlRight': 29, 'ShiftLeft': 42, 'Enter': 28, 'Escape': 1, 'ArrowUp': 72, 'ArrowDown': 80, 'ArrowLeft': 75, 'ArrowRight': 77, 'Digit1': 2, 'Digit2': 3, 'Digit3': 4, 'Digit4': 5, 'Digit5': 6, 'Digit6': 7, 'Digit7': 8 };
    return keyMap[code] || 0;
  }

  function notifyActivity() {
    if (window.GameXpBridge && typeof window.GameXpBridge.nudge === 'function') window.GameXpBridge.nudge();
  }

  function showLoading(show, msg) {
    if (elements.loadingOverlay) {
      elements.loadingOverlay.style.display = show ? 'flex' : 'none';
    }
    if (elements.loadingText && msg) {
      elements.loadingText.textContent = msg;
      elements.loadingText.style.color = show ? '#ff6b6b' : '';
    }
    if (elements.loadingProgress) {
      elements.loadingProgress.textContent = show ? '' : '';
    }
  }

  function showRetryButton(errorMsg) {
    showLoading(true, errorMsg);
    if (elements.playBtn) {
      elements.playBtn.disabled = false;
      elements.playBtn.style.display = 'inline-flex';
      elements.playBtn.textContent = 'Retry';
    }
  }

  // Preflight diagnostics for js-dos API
  function getDosPreflight() {
    var info = {
      dosType: typeof window.Dos,
      dosKeys: [],
      elementExists: !!elements.dos
    };
    if (window.Dos && typeof window.Dos === 'function') {
      try {
        info.dosKeys = Object.keys(window.Dos);
      } catch (e) {
        info.dosKeysError = String(e);
      }
    }
    return info;
  }

  // Handle success after game loads
  function onGameLoaded(ci) {
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
  }

  // Handle failure during game load
  function onGameError(error, preflight) {
    var errMsg = String(error);
    klog('freedoom_load_error', { error: errMsg, preflight: preflight });
    showRetryButton('Failed: ' + errMsg.slice(0, 50));
  }

  function startGame() {
    if (state.loaded) { resumeGame(); return; }
    if (elements.playBtn) { elements.playBtn.disabled = true; elements.playBtn.style.display = 'none'; }

    // Preflight diagnostics
    var preflight = getDosPreflight();
    klog('dos_preflight', preflight);

    // Check if Dos is available
    if (typeof window.Dos !== 'function') {
      onGameError('js-dos not loaded: Dos is ' + typeof window.Dos, preflight);
      return;
    }

    // IMPORTANT: Hide our loading overlay immediately so js-dos can show its own UI
    // js-dos v8 has built-in loading screen and start button
    showLoading(false);

    try {
      // js-dos v8 API: pass URL in options object
      // Dos(element, { url: bundleUrl }) - this is the correct v8 API
      var dosInstance = window.Dos(elements.dos, {
        url: FREEDOOM_BUNDLE_URL
      });

      if (dosInstance) {
        klog('dos_instance_created', { keys: Object.keys(dosInstance).join(',') });

        // Mark as loaded - js-dos handles its own UI from here
        state.loaded = true;
        state.running = true;
        state.startTime = Date.now();
        if (elements.restartBtn) elements.restartBtn.style.display = 'inline-flex';
        initMobileControls();
        if (state.timeInterval) clearInterval(state.timeInterval);
        state.timeInterval = setInterval(updateTime, 1000);
        setupGameEventListeners();
        klog('freedoom_started', { success: true });
      } else {
        throw new Error('Dos() returned null/undefined');
      }

    } catch (err) {
      onGameError(err, preflight);
    }
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
