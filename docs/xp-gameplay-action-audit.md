# XP Gameplay Action Audit

## Finding

Before this change, a visible game page could submit a server-calculated XP window using only browser input and visibility. The generic iframe bridge also emits `kcswh:activity` heartbeats, so a paused, unstarted, or non-responsive game could still satisfy the technical activity gate.

## Immediate protection

`js/xp/core.js` now requires at least one gameplay action for every XP window. Browser input, iframe heartbeats, focus, and a score observer's initial `0` only keep the session alive; they do not award XP.

`XPClient` includes the action count in the server-calculation payload for observability. The current protection is intentionally client-runtime gating; requiring the field server-side would break older direct integrations before they are migrated.

The core accepts gameplay actions from:

- a strictly increasing score reported through `game-score` or `reportScoreToPortal`;
- a positive internal `XP.addScore(delta)` call;
- a future explicit `XP.reportGameAction(gameId, { kind })` call.

This blocks the reported Maze Muncher case: loading the page or clicking while the game is paused does not create a qualifying action. It also blocks random clicking that does not change game state.

## Coverage review, excluding poker

The catalog uses three integration patterns:

1. **Score-relay shells:** `2048`, `asteroids`, `breakout`, `flappy`, `frogger`, `galaga`, `minesweeper`, `missile-command`, `pacman`, `pong`, `snake`, `space-invaders`, and `tetris` relay increasing score changes to the portal. They are covered by the immediate gate.
2. **Direct score hooks:** first-party games and several open games call `XP.addScore` or bridge score APIs. Positive deltas qualify their window.
3. **State/action-only games:** `connect-four`, `hangman`, `memory-match`, `simon`, `sokoban`, `solitaire`, `sudoku`, `tic-tac-toe`, and parts of `freedoom` and `whac-a-mole` have meaningful moves that may not change score promptly. They are protected from farming, but must emit `XP.reportGameAction()` from a successful move, card flip, valid placement, accepted answer, or running simulation tick before they can reliably earn XP.

## Required follow-up for complete semantic coverage

Each state/action-only game needs a small local integration at the point where its own reducer accepts a move. Call `XP.reportGameAction(gameId, { kind: "move" })` only after the game confirms that the action changed state. Do not call it from raw DOM listeners, pause controls, start controls, rejected moves, or animation loops with no game-state change.

For continuous games, emit the action after a successful movement/update tick caused by a user-controlled action. For turn-based games, emit it after a valid turn is committed. This instrumentation is intentionally per game: a shared DOM-level listener cannot distinguish a game move from random clicking without reintroducing the exploit.

## Breaking impact

- Games without score progression or an explicit action hook will no longer award XP until instrumented.
- XP starts only after the first qualifying action, not when a playable page loads.
- The server still treats client reports as untrusted telemetry; this change closes passive/random-click farming but is not full anti-cheat attestation.
