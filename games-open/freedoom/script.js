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
  var RENDER_WIDTH = 1366;
  var RENDER_HEIGHT = 768;

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
    wadData: null,
    renderCanvas: null,
    presentationFrame: null,
    desktopMouseReady: false,
    pointerLockReady: false
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

  function ensureRenderCanvas() {
    if (state.renderCanvas) return state.renderCanvas;
    var canvas = document.createElement('canvas');
    canvas.width = RENDER_WIDTH;
    canvas.height = RENDER_HEIGHT;
    canvas.tabIndex = -1;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'doom-render-canvas';
    canvas.style.position = 'fixed';
    canvas.style.left = '-10000px';
    canvas.style.top = '0';
    canvas.style.width = RENDER_WIDTH + 'px';
    canvas.style.height = RENDER_HEIGHT + 'px';
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);
    state.renderCanvas = canvas;
    return canvas;
  }

  function bootRuntime() {
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      var resolved = false;
      var renderCanvas = ensureRenderCanvas();

      window.Module = {
        canvas: renderCanvas,
        arguments: ['-iwad', WAD_FILENAME, '-config', '/arcade-prboomx.cfg', '-warp', '1', '-skill', '3'],
        print: function(text) { appendOutput('', text); },
        printErr: function(text) { appendOutput('(!)', text); },
        locateFile: function(path) { return 'vendor/dwasm/' + path; },
        setStatus: function(text) { setStatus(text || 'Starting Freedoom...'); },
        monitorRunDependencies: function(left) {
          if (left > 0) setStatus('Preparing engine dependencies... (' + left + ' left)');
        },
        onRuntimeInitialized: function() {
          window.FS.writeFile('/arcade-prboomx.cfg', buildPrBoomConfig());
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

  function buildPrBoomConfig() {
    return [
      '# Arcade Hub PrBoomX mobile config',
      'videomode                         "32bit"',
      'screen_resolution                 "1366x768"',
      'usegamma                          1',
      'filter_wall                       3',
      'filter_floor                      3',
      'filter_sprite                     3',
      'filter_z                          2',
      'gl_sprite_filter                  3',
      'gl_texture_filter_anisotropic     1',
      'gl_sprite_blend                   1',
      'use_mouse                         1',
      'use_joystick                      0',
      'mouse_sensitivity_horiz           12',
      'mouse_sensitivity_vert            8',
      'mouse_sensitivity_mlook           18',
      'movement_mouselook                1',
      'movement_mousenovert              0',
      'movement_maxviewpitch             90',
      'movement_mouseinvert              0',
      'key_up                            0x77',
      'key_down                          0x73',
      'key_strafeleft                    0x61',
      'key_straferight                   0x64',
      'key_left                          0xac',
      'key_right                         0xae',
      'key_fire                          0x9d',
      'key_use                           0x20',
      'key_mlook                         0x5c',
      'hudadd_leveltime                  1',
      'hudadd_demotime                   1',
      'hudadd_secretarea                 1',
      'hudadd_smarttotals                1',
      'hudadd_crosshair                  1',
      'hudadd_crosshair_health           1',
      'hudadd_crosshair_target           1',
      'hudadd_crosshair_lock_target      1',
      'health_bar                        1',
      'render_multisampling              2',
      'gl_texture_hqresize               1',
      'gl_texture_hqresize_sprites       1',
      'gl_lightmode                      2',
      'gl_blend_animations               1',
      ''
    ].join('\n');
  }

  function fitCanvasToFrame() {
    if (!elements.canvas) return;
    elements.canvas.style.setProperty('display', 'block', 'important');
    elements.canvas.style.setProperty('width', '100%', 'important');
    elements.canvas.style.setProperty('height', '100%', 'important');
    elements.canvas.style.setProperty('max-width', '100%', 'important');
    elements.canvas.style.setProperty('max-height', '100%', 'important');
    elements.canvas.style.setProperty('margin', '0', 'important');
    elements.canvas.style.setProperty('object-fit', 'contain', 'important');
  }

  function paintPresentationCanvas() {
    var source = state.renderCanvas;
    var target = elements.canvas;
    if (!source || !target) return;

    var rect = target.getBoundingClientRect();
    var cssWidth = Math.max(1, Math.round(rect.width));
    var cssHeight = Math.max(1, Math.round(rect.height));
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var targetWidth = Math.max(1, Math.round(cssWidth * ratio));
    var targetHeight = Math.max(1, Math.round(cssHeight * ratio));
    if (target.width !== targetWidth) target.width = targetWidth;
    if (target.height !== targetHeight) target.height = targetHeight;

    var ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    var sourceWidth = source.width || RENDER_WIDTH;
    var sourceHeight = source.height || RENDER_HEIGHT;
    var scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    var drawWidth = Math.max(1, Math.round(sourceWidth * scale));
    var drawHeight = Math.max(1, Math.round(sourceHeight * scale));
    var drawX = Math.floor((targetWidth - drawWidth) / 2);
    var drawY = Math.floor((targetHeight - drawHeight) / 2);
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
  }

  function startPresentationLoop() {
    if (state.presentationFrame) return;
    function tick() {
      fitCanvasToFrame();
      paintPresentationCanvas();
      state.presentationFrame = window.requestAnimationFrame(tick);
    }
    tick();
  }

  function scheduleCanvasFit() {
    var ticks = 0;
    function tick() {
      fitCanvasToFrame();
      paintPresentationCanvas();
      ticks += 1;
      if (ticks < 20) window.requestAnimationFrame(tick);
    }
    tick();
    window.setTimeout(fitCanvasToFrame, 750);
    window.setTimeout(fitCanvasToFrame, 1500);
  }

  function onGameLoaded() {
    state.loaded = true;
    state.running = true;
    state.booting = false;
    state.startTime = Date.now();
    showLoading(false);
    if (elements.canvas) {
      scheduleCanvasFit();
      startPresentationLoop();
      elements.canvas.focus();
    }
    if (elements.playBtn) elements.playBtn.style.display = 'none';
    if (elements.restartBtn) elements.restartBtn.style.display = 'inline-flex';
    initMobileControls();
    initDesktopPointerLock();
    initDesktopMouseControls();
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
    var targets = [state.renderCanvas, elements.canvas, document, window].filter(Boolean);
    try {
      var keyCode = keyCodeFromString(code);
      targets.forEach(function(target) {
        var event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
          code: code,
          key: codeToKey(code),
          keyCode: keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true
        });
        try {
          Object.defineProperty(event, 'keyCode', { get: function() { return keyCode; } });
          Object.defineProperty(event, 'which', { get: function() { return keyCode; } });
        } catch (_error) {}
        target.dispatchEvent(event);
      });
    } catch (error) {
      klog('freedoom_key_error', { code: code, error: String(error) });
    }
  }

  function sendMouseMove(deltaX, deltaY) {
    var source = state.renderCanvas || elements.canvas;
    var targets = [source, document, window].filter(Boolean);
    targets.forEach(function(target) {
      var event = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 240,
        movementX: deltaX,
        movementY: deltaY
      });
      try {
        Object.defineProperty(event, 'movementX', { get: function() { return deltaX; } });
        Object.defineProperty(event, 'movementY', { get: function() { return deltaY; } });
        Object.defineProperty(event, '__arcadeSynthetic', { value: true });
      } catch (_error) {}
      event.__arcadeSynthetic = true;
      target.dispatchEvent(event);
    });
  }

  function hasDesktopPointerLock() {
    return document.pointerLockElement === elements.canvas;
  }

  function requestDesktopPointerLock() {
    if (!elements.canvas || isMobile() || hasDesktopPointerLock()) return;
    if (typeof elements.canvas.requestPointerLock === 'function') {
      try { elements.canvas.requestPointerLock(); } catch (_error) {}
    }
  }

  function initDesktopPointerLock() {
    if (state.pointerLockReady || !elements.canvas || isMobile()) return;
    state.pointerLockReady = true;

    document.addEventListener('mousemove', function(event) {
      if (!hasDesktopPointerLock()) return;
      if (event.__arcadeSynthetic) return;
      if (!event.movementX && !event.movementY) return;
      sendMouseMove(event.movementX || 0, event.movementY || 0);
      notifyActivity();
    }, { passive: true });

    elements.canvas.addEventListener('click', function() {
      requestDesktopPointerLock();
    });
  }

  function initDesktopMouseControls() {
    if (state.desktopMouseReady || !elements.canvas || isMobile()) return;
    state.desktopMouseReady = true;

    var activePointerId = null;

    function releaseFire(event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (event.cancelable) event.preventDefault();
      if (elements.canvas.releasePointerCapture && activePointerId !== null) {
        try { elements.canvas.releasePointerCapture(activePointerId); } catch (_error) {}
      }
      activePointerId = null;
      sendKey('ControlLeft', false);
    }

    elements.canvas.addEventListener('pointerdown', function(event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (event.cancelable) event.preventDefault();
      activePointerId = event.pointerId;
      if (elements.canvas.setPointerCapture) elements.canvas.setPointerCapture(activePointerId);
      elements.canvas.focus();
      requestDesktopPointerLock();
      sendKey('ControlLeft', true);
      notifyActivity();
    });

    elements.canvas.addEventListener('pointerup', releaseFire);
    elements.canvas.addEventListener('pointercancel', releaseFire);
    elements.canvas.addEventListener('lostpointercapture', function(event) {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      sendKey('ControlLeft', false);
    });
    window.addEventListener('blur', function() {
      if (activePointerId === null) return;
      activePointerId = null;
      sendKey('ControlLeft', false);
    });
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
      Comma: ',',
      Period: '.',
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
      Comma: 188,
      Period: 190,
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
  var lookVector = { x: 0, y: 0 };
  var lookFrame = null;

  function setupJoystick(element, handler) {
    var stick = element.querySelector('.joystick-stick');
    var base = element.querySelector('.joystick-base');
    var rect = null;
    var centerX = 0;
    var centerY = 0;
    var maxDistance = 40;
    var activePointerId = null;

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

    element.addEventListener('pointerdown', function(event) {
      if (activePointerId !== null) return;
      event.preventDefault();
      activePointerId = event.pointerId;
      if (element.setPointerCapture) element.setPointerCapture(activePointerId);
      updateRect();
      handleMove(event.clientX, event.clientY);
      notifyActivity();
    }, { passive: false });
    element.addEventListener('pointermove', function(event) {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      handleMove(event.clientX, event.clientY);
    }, { passive: false });

    function finishPointer(event) {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      if (element.releasePointerCapture) {
        try { element.releasePointerCapture(activePointerId); } catch (_error) {}
      }
      activePointerId = null;
      handleEnd();
    }

    element.addEventListener('pointerup', finishPointer, { passive: false });
    element.addEventListener('pointercancel', finishPointer, { passive: false });
    element.addEventListener('lostpointercapture', function(event) {
      if (event.pointerId === activePointerId) {
        activePointerId = null;
        handleEnd();
      }
    });
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

  function startLookLoop() {
    if (lookFrame) return;
    function tick() {
      if (Math.abs(lookVector.y) > 0.15) {
        sendMouseMove(0, Math.round(lookVector.y * 18));
      }
      lookFrame = window.requestAnimationFrame(tick);
    }
    tick();
  }

  function handleLookJoystick(x, y) {
    var threshold = 0.3;
    var shouldTurnLeft = x < -threshold;
    var shouldTurnRight = x > threshold;
    lookVector.x = x;
    lookVector.y = y;
    startLookLoop();
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

    function bindKeyButton(button, keyCode) {
      var activePointerId = null;

      function release(event) {
        if (event.pointerId !== activePointerId) return;
        event.preventDefault();
        if (button.releasePointerCapture) {
          try { button.releasePointerCapture(activePointerId); } catch (_error) {}
        }
        activePointerId = null;
        sendKey(keyCode, false);
      }

      button.addEventListener('pointerdown', function(event) {
        if (activePointerId !== null) return;
        event.preventDefault();
        activePointerId = event.pointerId;
        if (button.setPointerCapture) button.setPointerCapture(activePointerId);
        sendKey(keyCode, true);
        notifyActivity();
      }, { passive: false });
      button.addEventListener('pointerup', release, { passive: false });
      button.addEventListener('pointercancel', release, { passive: false });
      button.addEventListener('lostpointercapture', function(event) {
        if (event.pointerId === activePointerId) {
          activePointerId = null;
          sendKey(keyCode, false);
        }
      });
    }

    var fireBtn = document.getElementById('btnFire');
    var useBtn = document.getElementById('btnUse');
    if (fireBtn && !fireBtn.dataset.ready) {
      fireBtn.dataset.ready = '1';
      bindKeyButton(fireBtn, 'ControlLeft');
    }
    if (useBtn && !useBtn.dataset.ready) {
      useBtn.dataset.ready = '1';
      bindKeyButton(useBtn, 'Space');
    }

    document.querySelectorAll('.weapon-btn').forEach(function(btn) {
      if (btn.dataset.ready) return;
      btn.dataset.ready = '1';
      btn.addEventListener('pointerdown', function(event) {
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
    window.addEventListener('resize', function() {
      if (state.loaded) {
        initMobileControls();
        scheduleCanvasFit();
      }
    });
    window.addEventListener('orientationchange', function() {
      window.setTimeout(function() {
        if (state.loaded) scheduleCanvasFit();
      }, 250);
    });
    startGame();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
