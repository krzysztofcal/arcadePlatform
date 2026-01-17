/**
 * Freedoom Game - js-dos integration with XP system
 * Arcade Hub adaptation using Freedoom (BSD License) and js-dos
 */

(function() {
  'use strict';

  // Game state
  var state = {
    running: false,
    paused: false,
    muted: false,
    loaded: false,
    kills: 0,
    secrets: 0,
    startTime: null,
    ci: null // js-dos command interface
  };

  // DOM Elements
  var elements = {
    dos: null,
    playBtn: null,
    restartBtn: null,
    killsEl: null,
    secretsEl: null,
    timeEl: null,
    loadingOverlay: null,
    loadingProgress: null,
    mobileControls: null
  };

  // Freedoom bundle URL (using Freedoom Phase 1 from js-dos bundles)
  var FREEDOOM_BUNDLE_URL = 'https://cdn.dos.zone/original/2X/2/24b00b14f118580763440ecaddcc948f8cb94f14.jsdos';

  // Initialize DOM elements
  function initElements() {
    elements.dos = document.getElementById('dos');
    elements.playBtn = document.getElementById('play');
    elements.restartBtn = document.getElementById('restart');
    elements.killsEl = document.getElementById('kills');
    elements.secretsEl = document.getElementById('secrets');
    elements.timeEl = document.getElementById('time');
    elements.loadingOverlay = document.getElementById('loadingOverlay');
    elements.loadingProgress = document.getElementById('loadingProgress');
    elements.mobileControls = document.getElementById('mobileControls');
  }

  // Format time as M:SS
  function formatTime(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  // Update time display
  function updateTime() {
    if (!state.running || state.paused || !state.startTime) return;
    var elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    if (elements.timeEl) {
      elements.timeEl.textContent = formatTime(elapsed);
    }
  }

  // Check if mobile device
  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (window.innerWidth <= 768);
  }

  // Initialize mobile controls
  function initMobileControls() {
    if (!isMobile()) {
      if (elements.mobileControls) {
        elements.mobileControls.style.display = 'none';
      }
      return;
    }

    if (elements.mobileControls) {
      elements.mobileControls.style.display = 'flex';
    }

    // Virtual joystick for movement
    var moveJoystick = document.getElementById('moveJoystick');
    var lookJoystick = document.getElementById('lookJoystick');

    if (moveJoystick) {
      setupJoystick(moveJoystick, handleMoveJoystick);
    }
    if (lookJoystick) {
      setupJoystick(lookJoystick, handleLookJoystick);
    }

    // Action buttons
    var fireBtn = document.getElementById('btnFire');
    var useBtn = document.getElementById('btnUse');

    if (fireBtn) {
      fireBtn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        sendKey('ControlLeft', true);
        notifyActivity();
      }, { passive: false });
      fireBtn.addEventListener('touchend', function(e) {
        e.preventDefault();
        sendKey('ControlLeft', false);
      }, { passive: false });
    }

    if (useBtn) {
      useBtn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        sendKey('Space', true);
        notifyActivity();
      }, { passive: false });
      useBtn.addEventListener('touchend', function(e) {
        e.preventDefault();
        sendKey('Space', false);
      }, { passive: false });
    }

    // Weapon buttons
    var weaponBtns = document.querySelectorAll('.weapon-btn');
    weaponBtns.forEach(function(btn) {
      btn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        var weapon = btn.getAttribute('data-weapon');
        if (weapon) {
          sendKey('Digit' + weapon, true);
          notifyActivity();
          setTimeout(function() {
            sendKey('Digit' + weapon, false);
          }, 100);
        }
      }, { passive: false });
    });
  }

  // Joystick state
  var joystickState = {
    move: { x: 0, y: 0, active: false },
    look: { x: 0, y: 0, active: false }
  };

  // Setup virtual joystick
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

      var normalizedX = x / maxDistance;
      var normalizedY = y / maxDistance;

      handler(normalizedX, normalizedY, true);
    }

    function handleEnd() {
      stick.style.transform = 'translate(0, 0)';
      handler(0, 0, false);
    }

    element.addEventListener('touchstart', function(e) {
      e.preventDefault();
      updateRect();
      var touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
      notifyActivity();
    }, { passive: false });

    element.addEventListener('touchmove', function(e) {
      e.preventDefault();
      var touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    }, { passive: false });

    element.addEventListener('touchend', function(e) {
      e.preventDefault();
      handleEnd();
    }, { passive: false });

    element.addEventListener('touchcancel', function(e) {
      e.preventDefault();
      handleEnd();
    }, { passive: false });
  }

  // Movement key states
  var movementKeys = {
    up: false,
    down: false,
    left: false,
    right: false
  };

  // Handle movement joystick
  function handleMoveJoystick(x, y, active) {
    joystickState.move = { x: x, y: y, active: active };

    var threshold = 0.3;

    // Forward/backward
    var shouldMoveUp = y < -threshold;
    var shouldMoveDown = y > threshold;

    if (shouldMoveUp !== movementKeys.up) {
      movementKeys.up = shouldMoveUp;
      sendKey('KeyW', shouldMoveUp);
    }
    if (shouldMoveDown !== movementKeys.down) {
      movementKeys.down = shouldMoveDown;
      sendKey('KeyS', shouldMoveDown);
    }

    // Strafe left/right
    var shouldMoveLeft = x < -threshold;
    var shouldMoveRight = x > threshold;

    if (shouldMoveLeft !== movementKeys.left) {
      movementKeys.left = shouldMoveLeft;
      sendKey('KeyA', shouldMoveLeft);
    }
    if (shouldMoveRight !== movementKeys.right) {
      movementKeys.right = shouldMoveRight;
      sendKey('KeyD', shouldMoveRight);
    }
  }

  // Look key states
  var lookKeys = {
    left: false,
    right: false
  };

  // Handle look joystick
  function handleLookJoystick(x, y, active) {
    joystickState.look = { x: x, y: y, active: active };

    var threshold = 0.3;

    // Turn left/right
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

  // Send key to js-dos
  function sendKey(code, pressed) {
    if (!state.ci) return;

    try {
      if (pressed) {
        state.ci.simulateKeyPress(keyCodeFromString(code));
      } else {
        state.ci.simulateKeyRelease(keyCodeFromString(code));
      }
    } catch (e) {
      // Fallback: try direct keyboard event simulation
      try {
        var event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
          code: code,
          key: code,
          bubbles: true,
          cancelable: true
        });
        elements.dos.dispatchEvent(event);
      } catch (e2) {
        console.warn('Key simulation failed:', e2);
      }
    }
  }

  // Convert key code string to DOS keycode
  function keyCodeFromString(code) {
    var keyMap = {
      'KeyW': 17, // W
      'KeyA': 30, // A
      'KeyS': 31, // S
      'KeyD': 32, // D
      'KeyE': 18, // E
      'Space': 57,
      'ControlLeft': 29,
      'ControlRight': 29,
      'ShiftLeft': 42,
      'Enter': 28,
      'Escape': 1,
      'ArrowUp': 72,
      'ArrowDown': 80,
      'ArrowLeft': 75,
      'ArrowRight': 77,
      'Digit1': 2,
      'Digit2': 3,
      'Digit3': 4,
      'Digit4': 5,
      'Digit5': 6,
      'Digit6': 7,
      'Digit7': 8
    };
    return keyMap[code] || 0;
  }

  // Notify activity for XP system
  function notifyActivity() {
    if (window.GameXpBridge && typeof window.GameXpBridge.nudge === 'function') {
      window.GameXpBridge.nudge();
    }
  }

  // Update score display and XP
  function updateScore(kills, secrets) {
    if (kills !== state.kills) {
      state.kills = kills;
      if (elements.killsEl) {
        elements.killsEl.textContent = kills;
      }
      // Award XP for kills
      if (window.GameXpBridge && typeof window.GameXpBridge.add === 'function') {
        window.GameXpBridge.add(10); // 10 XP per kill
      }
      notifyActivity();
    }

    if (secrets !== state.secrets) {
      state.secrets = secrets;
      if (elements.secretsEl) {
        elements.secretsEl.textContent = secrets;
      }
      // Award XP for secrets
      if (window.GameXpBridge && typeof window.GameXpBridge.add === 'function') {
        window.GameXpBridge.add(50); // 50 XP per secret
      }
      notifyActivity();
    }
  }

  // Start the game
  function startGame() {
    if (state.loaded) {
      resumeGame();
      return;
    }

    if (elements.playBtn) {
      elements.playBtn.disabled = true;
      elements.playBtn.textContent = 'Loading...';
    }

    showLoading(true);

    // Configure js-dos
    var config = {
      url: FREEDOOM_BUNDLE_URL,
      autoStart: true,
      kiosk: false,
      noSideBar: true,
      noFullscreen: true, // We handle fullscreen ourselves
      noSocialLinks: true
    };

    // Start js-dos
    Dos(elements.dos, config).then(function(ci) {
      state.ci = ci;
      state.loaded = true;
      state.running = true;
      state.startTime = Date.now();

      showLoading(false);

      if (elements.playBtn) {
        elements.playBtn.style.display = 'none';
      }
      if (elements.restartBtn) {
        elements.restartBtn.style.display = 'inline-flex';
      }

      // Initialize mobile controls after game loads
      initMobileControls();

      // Start time update interval
      setInterval(updateTime, 1000);

      // Listen for game events
      setupGameEventListeners(ci);

      console.log('Freedoom loaded successfully');
    }).catch(function(error) {
      console.error('Failed to load Freedoom:', error);
      showLoading(false);
      if (elements.playBtn) {
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = 'Retry';
      }
      alert('Failed to load Freedoom. Please try again.');
    });
  }

  // Setup game event listeners
  function setupGameEventListeners(ci) {
    // Activity tracking for XP
    document.addEventListener('keydown', function() {
      notifyActivity();
    }, { passive: true });

    document.addEventListener('mousedown', function() {
      notifyActivity();
    }, { passive: true });

    document.addEventListener('touchstart', function() {
      notifyActivity();
    }, { passive: true });

    // Periodic XP award for active gameplay
    setInterval(function() {
      if (state.running && !state.paused) {
        notifyActivity();
      }
    }, 3000);
  }

  // Show/hide loading overlay
  function showLoading(show) {
    if (elements.loadingOverlay) {
      elements.loadingOverlay.style.display = show ? 'flex' : 'none';
    }
  }

  // Resume game
  function resumeGame() {
    if (!state.ci) return;
    state.paused = false;
    state.running = true;
    // js-dos handles its own resume
  }

  // Pause game
  function pauseGame() {
    if (!state.ci) return;
    state.paused = true;
    // Send Escape key to bring up menu
    sendKey('Escape', true);
    setTimeout(function() {
      sendKey('Escape', false);
    }, 100);
  }

  // Restart game
  function restartGame() {
    if (state.ci) {
      // Send key sequence to restart
      // Escape -> New Game
      sendKey('Escape', true);
      setTimeout(function() {
        sendKey('Escape', false);
      }, 100);
    }
    state.kills = 0;
    state.secrets = 0;
    state.startTime = Date.now();
    if (elements.killsEl) elements.killsEl.textContent = '0';
    if (elements.secretsEl) elements.secretsEl.textContent = '0';
    if (elements.timeEl) elements.timeEl.textContent = '0:00';
  }

  // Public API
  window.FreedoomGame = {
    start: startGame,
    pause: pauseGame,
    resume: resumeGame,
    restart: restartGame,

    setMuted: function(muted) {
      state.muted = muted;
      // js-dos v8 handles audio through its own interface
      if (state.ci && state.ci.setVolume) {
        state.ci.setVolume(muted ? 0 : 1);
      }
    },

    setPaused: function(paused) {
      if (paused) {
        pauseGame();
      } else {
        resumeGame();
      }
    },

    isMuted: function() {
      return state.muted;
    },

    isPaused: function() {
      return state.paused;
    },

    isRunning: function() {
      return state.running;
    },

    getScore: function() {
      return state.kills;
    }
  };

  // Initialize when DOM is ready
  function init() {
    initElements();

    // Play button
    if (elements.playBtn) {
      elements.playBtn.addEventListener('click', startGame);
    }

    // Restart button
    if (elements.restartBtn) {
      elements.restartBtn.addEventListener('click', restartGame);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.code === 'Escape' && state.running) {
        state.paused = !state.paused;
      }
    });

    // Check for mobile and show/hide controls accordingly
    window.addEventListener('resize', function() {
      if (state.loaded) {
        initMobileControls();
      }
    });
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
