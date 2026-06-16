/**
 * Freedoom browser integration.
 * Runs Freedoom Phase 2 with the vendored Dwasm PrBoom/PrBoomX runtime.
 */
(function() {
  'use strict';

  var WAD_ARCHIVE_URL = 'assets/freedoom2.bin';
  var WAD_FILENAME = 'freedoom2.wad';
  var RUNTIME_SCRIPT = 'vendor/dwasm/index.js';
  var ARCHIVE_SCRIPT = './vendor/dwasm/libarchive.js';

  var state = {
    booting: false,
    running: false,
    paused: false,
    muted: false,
    loaded: false,
    startTime: null,
    timeInterval: null,
    activityInterval: null,
    listenersAttached: false,
    wadData: null
  };

  var elements = {
    canvas: null,
    output: null,
    playBtn: null,
    restartBtn: null,
    timeEl: null,
    loadingOverlay: null,
    loadingProgress: null,
    loadingText: null,
    mobileControls: null
  };

  function klog(kind, data) {
    if (window.KLog && typeof window.KLog.log === 'function') {
      window.KLog.log(kind, data);
    }
  }

  function initElements() {
    elements.canvas = document.getElementById('doomCanvas');
    elements.output = document.getElementById('doomOutput');
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

  function setStatus(message, progress) {
    if (elements.loadingText && message) {
      elements.loadingText.textContent = String(message).replace(/<[^>]*>/g, ' ');
    }
    if (elements.loadingProgress) {
      elements.loadingProgress.textContent = typeof progress === 'number' ? Math.round(progress) + '%' : '';
    }
  }

  function showLoading(show, message) {
    if (elements.loadingOverlay) elements.loadingOverlay.style.display = show ? 'flex' : 'none';
    if (message) setStatus(message);
  }

  function showRetryButton(message) {
    state.booting = false;
    showLoading(true, message);
    if (elements.playBtn) {
      elements.playBtn.disabled = false;
      elements.playBtn.style.display = 'inline-flex';
      elements.playBtn.textContent = 'Retry';
    }
  }

  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
  }

  function fetchBlob(url, title) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.onprogress = function(event) {
        var progress = event.lengthComputable ? (event.loaded / event.total) * 100 : null;
        setStatus('Downloading ' + title + '...', progress);
      };
      xhr.onload = function() {
        if (xhr.status === 200) {
          resolve(new File([xhr.response], title, { type: xhr.getResponseHeader('Content-Type') || 'application/octet-stream' }));
        } else {
          reject(new Error('Download failed with HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function() {
        reject(new Error('Download failed'));
      };
      xhr.send();
    });
  }

  async function loadWad() {
    if (state.wadData) return state.wadData;

    setStatus('Preparing Freedoom runtime...');
    var archiveModule = await import(ARCHIVE_SCRIPT);
    var archiveBlob = await fetchBlob(WAD_ARCHIVE_URL, 'freedoom2.bin');

    setStatus('Opening Freedoom archive...');
    var archive = await archiveModule.Archive.open(archiveBlob);
    try {
      var files = await archive.getFilesObject();
      if (!files[WAD_FILENAME] || typeof files[WAD_FILENAME].extract !== 'function') {
        throw new Error(WAD_FILENAME + ' missing from archive');
      }

      setStatus('Extracting Freedoom WAD...');
      var wadFile = await files[WAD_FILENAME].extract();
      state.wadData = new Uint8Array(await wadFile.arrayBuffer());
      return state.wadData;
    } finally {
      await archive.close();
    }
  }

  function appendOutput(prefix, text) {
    if (!elements.output) return;
    elements.output.value += (prefix ? prefix + ' ' : '') + text + '\n';
    if (elements.output.value.length > 1024 * 1024) {
      elements.output.value = elements.output.value.slice(-512 * 1024);
    }
    elements.output.scrollTop = elements.output.scrollHeight;
  }

  function bootRuntime() {
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      var resolved = false;

      window.Module = {
        canvas: elements.canvas,
        arguments: ['-iwad', WAD_FILENAME],
        print: function(text) { appendOutput('', text); },
        printErr: function(text) { appendOutput('(!)', text); },
        locateFile: function(path) { return 'vendor/dwasm/' + path; },
        setStatus: function(text) { setStatus(text || 'Starting Freedoom...'); },
        monitorRunDependencies: function(left) {
          if (left > 0) setStatus('Preparing engine dependencies... (' + left + ' left)');
        },
        onRuntimeInitialized: function() {
          var file = window.FS.open('/' + WAD_FILENAME, 'w');
          window.FS.write(file, state.wadData, 0, state.wadData.length, 0);
          window.FS.close(file);
          onGameLoaded();
          if (!resolved) {
            resolved = true;
            resolve();
          }
        },
        onAbort: function(reason) {
          reject(new Error(String(reason || 'Freedoom runtime aborted')));
        }
      };

      script.src = RUNTIME_SCRIPT;
      script.async = true;
      script.onload = function() {
        klog('freedoom_runtime_loaded', { success: true });
      };
      script.onerror = function() {
        reject(new Error('Unable to load Freedoom runtime'));
      };
      document.body.appendChild(script);
    });
  }

  function onGameLoaded() {
    state.loaded = true;
    state.running = true;
    state.booting = false;
    state.startTime = Date.now();
    showLoading(false);
    if (elements.canvas) {
      elements.canvas.style.display = 'block';
      elements.canvas.focus();
    }
    if (elements.playBtn) elements.playBtn.style.display = 'none';
    if (elements.restartBtn) elements.restartBtn.style.display = 'inline-flex';
    initMobileControls();
    if (state.timeInterval) clearInterval(state.timeInterval);
    state.timeInterval = setInterval(updateTime, 1000);
    setupGameEventListeners();
    klog('freedoom_loaded', { success: true, engine: 'dwasm' });
  }

  async function startGame() {
    if (state.loaded) {
      if (elements.canvas) elements.canvas.focus();
      return;
    }
    if (state.booting) return;

    state.booting = true;
    showLoading(true, 'Loading Freedoom...');
    if (elements.playBtn) {
      elements.playBtn.disabled = true;
      elements.playBtn.style.display = 'none';
    }

    try {
      await loadWad();
      setStatus('Starting Freedoom engine...');
      await bootRuntime();
    } catch (error) {
      klog('freedoom_load_error', { error: String(error) });
      showRetryButton('Freedoom failed to start: ' + String(error.message || error));
    }
  }

  function notifyActivity() {
    if (window.GameXpBridge && typeof window.GameXpBridge.nudge === 'function') window.GameXpBridge.nudge();
  }

  function setupGameEventListeners() {
    if (state.listenersAttached) return;
    state.listenersAttached = true;
    document.addEventListener('keydown', notifyActivity, { passive: true });
    document.addEventListener('mousedown', notifyActivity, { passive: true });
    document.addEventListener('touchstart', notifyActivity, { passive: true });
    if (state.activityInterval) clearInterval(state.activityInterval);
    state.activityInterval = setInterval(function() {
      if (state.running && !state.paused) notifyActivity();
    }, 3000);
  }

  function sendKey(code, pressed) {
    var target = elements.canvas || document.activeElement || document.body;
    try {
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
    } catch (error) {
      klog('freedoom_key_error', { code: code, error: String(error) });
    }
  }

  function codeToKey(code) {
    var map = {
      KeyW: 'w',
      KeyA: 'a',
      KeyS: 's',
      KeyD: 'd',
      KeyE: 'e',
      Space: ' ',
      ControlLeft: 'Control',
      ControlRight: 'Control',
      ShiftLeft: 'Shift',
      Enter: 'Enter',
      Escape: 'Escape',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      Digit1: '1',
      Digit2: '2',
      Digit3: '3',
      Digit4: '4',
      Digit5: '5',
      Digit6: '6',
      Digit7: '7'
    };
    return map[code] || code;
  }

  function keyCodeFromString(code) {
    var keyMap = {
      KeyW: 87,
      KeyA: 65,
      KeyS: 83,
      KeyD: 68,
      KeyE: 69,
      Space: 32,
      ControlLeft: 17,
      ControlRight: 17,
      ShiftLeft: 16,
      Enter: 13,
      Escape: 27,
      ArrowUp: 38,
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
      Digit1: 49,
      Digit2: 50,
      Digit3: 51,
      Digit4: 52,
      Digit5: 53,
      Digit6: 54,
      Digit7: 55
    };
    return keyMap[code] || 0;
  }

  var movementKeys = { up: false, down: false, left: false, right: false };
  var lookKeys = { left: false, right: false };

  function setupJoystick(element, handler) {
    var stick = element.querySelector('.joystick-stick');
    var base = element.querySelector('.joystick-base');
    var rect = null;
    var centerX = 0;
    var centerY = 0;
    var maxDistance = 40;

    function updateRect() {
      rect = base.getBoundingClientRect();
      centerX = rect.width / 2;
      centerY = rect.height / 2;
    }

    function handleMove(clientX, clientY) {
      if (!rect) updateRect();
      var x = clientX - rect.left - centerX;
      var y = clientY - rect.top - centerY;
      var distance = Math.sqrt(x * x + y * y);
      if (distance > maxDistance) {
        x = (x / distance) * maxDistance;
        y = (y / distance) * maxDistance;
      }
      stick.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
      handler(x / maxDistance, y / maxDistance);
    }

    function handleEnd() {
      stick.style.transform = 'translate(0, 0)';
      handler(0, 0);
    }

    element.addEventListener('touchstart', function(event) {
      event.preventDefault();
      updateRect();
      handleMove(event.touches[0].clientX, event.touches[0].clientY);
      notifyActivity();
    }, { passive: false });
    element.addEventListener('touchmove', function(event) {
      event.preventDefault();
      handleMove(event.touches[0].clientX, event.touches[0].clientY);
    }, { passive: false });
    element.addEventListener('touchend', function(event) {
      event.preventDefault();
      handleEnd();
    }, { passive: false });
    element.addEventListener('touchcancel', function(event) {
      event.preventDefault();
      handleEnd();
    }, { passive: false });
  }

  function handleMoveJoystick(x, y) {
    var threshold = 0.3;
    var shouldMoveUp = y < -threshold;
    var shouldMoveDown = y > threshold;
    var shouldMoveLeft = x < -threshold;
    var shouldMoveRight = x > threshold;
    if (shouldMoveUp !== movementKeys.up) {
      movementKeys.up = shouldMoveUp;
      sendKey('KeyW', shouldMoveUp);
    }
    if (shouldMoveDown !== movementKeys.down) {
      movementKeys.down = shouldMoveDown;
      sendKey('KeyS', shouldMoveDown);
    }
    if (shouldMoveLeft !== movementKeys.left) {
      movementKeys.left = shouldMoveLeft;
      sendKey('KeyA', shouldMoveLeft);
    }
    if (shouldMoveRight !== movementKeys.right) {
      movementKeys.right = shouldMoveRight;
      sendKey('KeyD', shouldMoveRight);
    }
  }

  function handleLookJoystick(x) {
    var threshold = 0.3;
    var shouldTurnLeft = x < -threshold;
    var shouldTurnRight = x > threshold;
    if (shouldTurnLeft !== lookKeys.left) {
      lookKeys.left = shouldTurnLeft;
      sendKey('ArrowLeft', shouldTurnLeft);
    }
    if (shouldTurnRight !== lookKeys.right) {
      lookKeys.right = shouldTurnRight;
      sendKey('ArrowRight', shouldTurnRight);
    }
  }

  function initMobileControls() {
    if (!isMobile()) {
      if (elements.mobileControls) elements.mobileControls.style.display = 'none';
      return;
    }
    if (elements.mobileControls) elements.mobileControls.style.display = 'flex';

    var moveJoystick = document.getElementById('moveJoystick');
    var lookJoystick = document.getElementById('lookJoystick');
    if (moveJoystick && !moveJoystick.dataset.ready) {
      moveJoystick.dataset.ready = '1';
      setupJoystick(moveJoystick, handleMoveJoystick);
    }
    if (lookJoystick && !lookJoystick.dataset.ready) {
      lookJoystick.dataset.ready = '1';
      setupJoystick(lookJoystick, handleLookJoystick);
    }

    var fireBtn = document.getElementById('btnFire');
    var useBtn = document.getElementById('btnUse');
    if (fireBtn && !fireBtn.dataset.ready) {
      fireBtn.dataset.ready = '1';
      fireBtn.addEventListener('touchstart', function(event) {
        event.preventDefault();
        sendKey('ControlLeft', true);
        notifyActivity();
      }, { passive: false });
      fireBtn.addEventListener('touchend', function(event) {
        event.preventDefault();
        sendKey('ControlLeft', false);
      }, { passive: false });
    }
    if (useBtn && !useBtn.dataset.ready) {
      useBtn.dataset.ready = '1';
      useBtn.addEventListener('touchstart', function(event) {
        event.preventDefault();
        sendKey('Space', true);
        notifyActivity();
      }, { passive: false });
      useBtn.addEventListener('touchend', function(event) {
        event.preventDefault();
        sendKey('Space', false);
      }, { passive: false });
    }

    document.querySelectorAll('.weapon-btn').forEach(function(btn) {
      if (btn.dataset.ready) return;
      btn.dataset.ready = '1';
      btn.addEventListener('touchstart', function(event) {
        event.preventDefault();
        var weapon = btn.getAttribute('data-weapon');
        if (!weapon) return;
        sendKey('Digit' + weapon, true);
        notifyActivity();
        setTimeout(function() {
          sendKey('Digit' + weapon, false);
        }, 100);
      }, { passive: false });
    });
  }

  function pauseGame() {
    if (!state.running) return;
    state.paused = true;
    sendKey('Escape', true);
    setTimeout(function() { sendKey('Escape', false); }, 100);
  }

  function resumeGame() {
    state.paused = false;
    state.running = true;
    if (elements.canvas) elements.canvas.focus();
  }

  function restartGame() {
    window.location.reload();
  }

  window.FreedoomGame = {
    start: startGame,
    pause: pauseGame,
    resume: resumeGame,
    restart: restartGame,
    setMuted: function(muted) { state.muted = muted; },
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
