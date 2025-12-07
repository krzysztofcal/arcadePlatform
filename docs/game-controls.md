# Game Controls Service

## Overview

The GameControlsService provides a standardized set of game control buttons across all game pages in the Arcade Hub portal. This ensures a consistent user experience regardless of whether a game is a native canvas game (like Catch Cats or T-Rex Runner) or an iframe-embedded distributor game.

## Features

All game pages support the following controls:

| Control | Button | Keyboard | Description |
|---------|--------|----------|-------------|
| Mute/Unmute | 🔇/🔈 | `M` | Toggle game audio on/off |
| Pause/Resume | ⏸/▶ | `Space`* | Pause or resume the game |
| Enter Fullscreen | ↗ icon | `F` | Enter fullscreen mode |
| Exit Fullscreen | ↙ icon | `Esc` | Exit fullscreen mode |

*Note: Space key for pause can be disabled via `disableSpacePause: true` for games that use Space for gameplay (e.g., T-Rex jump).

## Architecture

### Core Services

The game controls are implemented through several services in `js/core/`:

1. **GameControlsService.js** - The main service that provides standardized mute, pause, and fullscreen controls with klog logging
2. **FullscreenService.js** - Handles fullscreen API interactions and button state synchronization
3. **AudioService.js** - Manages audio context and mute state for games with sound
4. **InputController.js** - Handles keyboard and pointer input for game controls

### Game Page Integration

Each game type integrates the controls differently:

#### Native Canvas Games (game_cats.html, game_trex.html)

Native games directly integrate with the GameControlsService:

```javascript
const controls = GameControlsService({
  wrap: gameWrap,
  canvas: canvas,
  btnMute: btnMute,
  btnPause: btnPause,
  btnEnterFs: btnEnterFs,
  btnExitFs: btnExitFs,
  overlayExit: overlayExit,
  gameId: 'game-id',
  disableSpacePause: false, // Set to true if game uses Space for gameplay
  onMuteChange: function(muted) { /* handle mute */ },
  onPauseChange: function(paused) { /* handle pause */ },
  onFullscreenChange: function(isFs) { /* handle fullscreen */ },
  isMutedProvider: function() { return state.muted; },
  isPausedProvider: function() { return state.paused; },
  isRunningProvider: function() { return state.running; }
});
controls.init();
```

#### Iframe Games (game.html via frame.js)

Iframe games use postMessage to communicate control state to the embedded game:

```javascript
// Parent frame sends control messages to iframe
function sendIframeMessage(type, data) {
  iframe.contentWindow.postMessage({
    type: 'kcswh:game-control',
    action: type,
    ...data
  }, '*');
}
```

## HTML Structure

The control buttons should be placed in the `.titleBar` section of each game page:

```html
<div class="titleBar">
  <h1>Game Title</h1>
  <div class="actions">
    <button type="button" class="btnIcon" id="btnMute" title="Mute" aria-label="Mute">🔇</button>
    <button type="button" class="btnIcon" id="btnPause" title="Pause/Resume" aria-label="Pause/Resume">⏸</button>
    <button type="button" class="btnIcon" id="btnEnterFs" title="Full screen" aria-label="Full screen">
      <svg><!-- fullscreen icon --></svg>
    </button>
    <button type="button" class="btnIcon" id="btnExitFs" title="Exit full screen" aria-label="Exit full screen" style="display:none;">
      <svg><!-- exit fullscreen icon --></svg>
    </button>
  </div>
</div>
```

## Fullscreen Exit Overlay

Each game should include a fullscreen exit overlay that appears on hover in fullscreen mode:

```html
<div class="fsExitOverlay">
  <button id="overlayExit" type="button" class="fsBtn" title="Exit full screen">
    <svg><!-- exit icon --></svg>
    Exit full screen
  </button>
</div>
```

## Logging

All game control events are logged using the klog utility with the following prefixes:

| Service | Log Prefix | Events |
|---------|------------|--------|
| GameControlsService | `game_controls_` | `init`, `destroy`, `mute_toggle`, `pause_toggle`, `fullscreen_*` |
| FullscreenService | `fullscreen_service_` | `enter_request`, `exit_request`, `state_change` |
| Cats Game | `cats_game_` | `init`, `start`, `game_over`, `mute_toggle`, `pause_toggle` |
| T-Rex Game | `trex_game_` | `init`, `start`, `reset`, `game_over`, `mute_toggle`, `pause_toggle`, `fullscreen_change` |
| Frame (iframe games) | `frame_game_` | `init`, `init_controls`, `inject_iframe`, `mute_toggle`, `pause_toggle`, `iframe_message_*` |
| GameShell (iframe games) | `game_shell_` | `init`, `control_message`, `mute_change`, `pause_change`, `controls_registered` |

## State Persistence

Control states are persisted in localStorage:

| Key | Description |
|-----|-------------|
| `trex-muted` | Mute state for T-Rex game |
| `frame-game-muted` | Mute state for iframe games |
| Game-specific storage via StorageService | Mute state and other preferences |

## Game Page Checklist

When adding control buttons to a new game page, ensure:

1. [ ] All control buttons are present in the `.titleBar` section
2. [ ] The `.fsExitOverlay` is included in the `.gameWrap`
3. [ ] Required scripts are imported:
   - `js/config.js`
   - `js/core/StorageService.js`
   - `js/core/AudioService.js` (if game has sound)
   - `js/core/FullscreenService.js`
   - `js/core/GameControlsService.js`
4. [ ] Game logic implements pause functionality
5. [ ] Game logic implements mute functionality (if applicable)
6. [ ] klog calls are added for all control events
7. [ ] UI updates correctly when controls are toggled
8. [ ] Keyboard shortcuts work (M for mute, Space for pause, F for fullscreen)
9. [ ] If game uses Space for gameplay, set `disableSpacePause: true`

## CSS Styling

Control buttons use the `.btnIcon` class from `css/game.css`:

```css
.btnIcon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  background: transparent;
  color: #cdd6ff;
}
```

## XP Integration

Game controls integrate with the XP system:

- **Activity nudge**: Control interactions trigger `xpNudge()` to keep the session active
- **Pause on hidden**: Games pause automatically when the XP overlay is shown
- **Resume handling**: Games may optionally auto-resume when becoming visible

## Iframe Game Control Protocol

Iframe games in `games-open/` use the `GameShell` utility to handle control messages from the parent frame.

### GameShell API

The `games-open/game-shell.js` file provides a shared API for all iframe games:

```javascript
// GameShell is automatically initialized and listens for control messages
// Games register their callbacks to respond to pause/mute commands:

window.GameShell.registerControls({
  onPause: function() {
    // Handle pause - stop game loop, show overlay, etc.
    running = false;
  },
  onResume: function() {
    // Handle resume - restart game loop
    running = true;
  },
  onMute: function() {
    // Handle mute - disable audio
  },
  onUnmute: function() {
    // Handle unmute - enable audio
  }
});

// Check current state
window.GameShell.isPaused();  // returns boolean
window.GameShell.isMuted();   // returns boolean
window.GameShell.getState();  // returns { paused, muted }
```

### Supported Iframe Games

All games in `games-open/` now support control messages:

| Game | Pause Support | Notes |
|------|--------------|-------|
| Flappy Bird | ✅ | Stops game loop |
| Pong | ✅ | Stops game loop |
| Tetris | ✅ | Shows "Paused" overlay |
| Snake | ✅ | Shows "Paused" message |
| Breakout | ✅ | Stops game loop |
| Pacman | ✅ | Shows "Paused" overlay |
| 2048 | N/A | Turn-based, no continuous loop |
| Minesweeper | N/A | Turn-based, no continuous loop |

### Message Protocol

The parent frame (game.html via frame.js) sends messages in this format:

```javascript
{
  type: 'kcswh:game-control',
  action: 'pause' | 'mute',
  paused: boolean,  // for pause action
  muted: boolean    // for mute action
}
```

### Legacy Support

For games that don't use GameShell, they can listen directly for messages:

```javascript
window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'kcswh:game-control') {
    switch (event.data.action) {
      case 'mute':
        handleMute(event.data.muted);
        break;
      case 'pause':
        handlePause(event.data.paused);
        break;
    }
  }
});
```
