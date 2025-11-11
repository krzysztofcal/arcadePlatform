import assert from 'node:assert/strict';

import { createEnvironment } from './helpers/xp-env.mjs';

// Fractional roll-up and queued awards survive until XP loads
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp } = env;

  Bridge.start('pre-init-game');
  Bridge.add(0.4);
  Bridge.add(0.4);
  Bridge.add(0.4);

  drainTimers();
  assert.equal(typeof env.context.window.XP, 'undefined', 'XP should not exist before loading xp.js');

  const { XP, getState } = installXp();
  drainTimers();

  assert.equal(getState().scoreDelta, 1, 'queued fractional adds should roll to a whole point once XP loads');

  Bridge.add(0.25);
  drainTimers();
  assert.equal(getState().scoreDelta, 1, 'sub-integer adds should remain queued');

  Bridge.add(0.25);
  drainTimers();
  assert.equal(getState().scoreDelta, 1, 'partial sum below one should not award points');

  Bridge.add(0.6);
  drainTimers();
  assert.equal(getState().scoreDelta, 2, 'fractional roll-up should award once threshold reached');

  Bridge.add(9_999.5);
  drainTimers();
  assert.equal(getState().scoreDelta, 10_000, 'window awards should respect 10k cap');

  // stop should still flush cleanly when XP is present
  Bridge.stop({ flush: true });
  drainTimers();
  assert.equal(getState().running, false, 'stop should halt running session');
  assert.equal(typeof XP.stopSession, 'function');
}

// Auto wiring responds to visibility toggles and activity
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerDoc, triggerWindow } = env;

  Bridge.auto('Auto Session Name');
  drainTimers();

  const { XP, getState } = installXp();
  drainTimers();

  assert.equal(getState().running, true, 'auto should start a session once XP is ready');
  assert.equal(getState().gameId, 'auto-session-name', 'auto start should slugify provided game id');

  let stopCalls = 0;
  const originalStop = XP.stopSession;
  XP.stopSession = function wrappedStop(options) {
    stopCalls += 1;
    return originalStop.call(this, options);
  };

  triggerDoc('xp:hidden');
  drainTimers();
  assert.equal(getState().running, false, 'xp:hidden should stop the session');
  assert.equal(stopCalls > 0, true, 'xp:hidden should flush stop');

  triggerDoc('xp:visible');
  drainTimers();
  assert.equal(getState().running, true, 'xp:visible should restart the session');

  let nudges = 0;
  const originalNudge = XP.nudge;
  XP.nudge = function wrappedNudge() {
    nudges += 1;
    return originalNudge.apply(this, arguments);
  };

  triggerWindow('pointerdown');
  assert.equal(nudges > 0, true, 'pointerdown should proxy to XP.nudge');
}

// DOM readiness fallback should trigger auto start even without custom events
{
  const env = createEnvironment({ readyState: 'loading', bodyGameId: 'fallback-body' });
  const { Bridge, drainTimers, installXp, triggerDoc, setReadyState } = env;

  Bridge.auto();
  drainTimers();

  // simulate early stop before XP or visibility hooks fire
  Bridge.stop({ flush: false });
  drainTimers();

  setReadyState('interactive');
  triggerDoc('DOMContentLoaded');
  drainTimers();

  const { getState } = installXp();
  drainTimers();
  assert.equal(getState().running, true, 'DOMContentLoaded fallback should restart the session');
  assert.equal(getState().gameId, 'fallback-body', 'detected body data attribute should provide the slugged id');
}

// Stop calls before XP loads should queue and flush later
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp } = env;

  Bridge.start('queued-stop');
  Bridge.add(1.4);
  Bridge.stop({ flush: true });
  drainTimers();

  const { XP } = installXp();
  let stopCalls = 0;
  const originalStop = XP.stopSession;
  XP.stopSession = function wrappedStop(options) {
    stopCalls += 1;
    return originalStop.call(this, options);
  };

  drainTimers();
  assert.equal(stopCalls, 1, 'queued stop should flush once XP becomes available');
}

// Stop followed by start before XP initializes should leave the last start active
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp } = env;

  Bridge.start('game-a');
  Bridge.stop({ flush: true });
  Bridge.start('game-b');

  const { getState } = installXp();
  drainTimers();

  assert.equal(getState().running, true, 'queued start should run after pending stop');
  assert.equal(getState().gameId, 'game-b', 'latest queued start should determine the running session');
}

// new_record_starts_boost
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerWindow } = env;

  Bridge.start('record-game');

  const { getState } = installXp();
  drainTimers();

  const boostEvents = [];
  const xpBoosts = [];
  env.context.window.addEventListener('xp:boost', (event) => {
    if (!event || !event.detail) return;
    const detail = { ...event.detail };
    boostEvents.push(detail);
    if (detail.__xpOrigin === 'xp.js') {
      xpBoosts.push(detail);
    }
  });

  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 12 } });
  drainTimers();

  assert.equal(xpBoosts.length, 1, 'new record should emit exactly one boost event');
  const detail = xpBoosts[0];
  assert.equal(detail.multiplier, 1.5, 'new record boost should use 1.5x multiplier');
  assert.equal(detail.source, 'newRecord', 'new record boost should mark the source');
  assert.equal(detail.secondsLeft, 15, 'new record boost should expose the remaining seconds');
  assert.equal(detail.totalSeconds, 15, 'new record boost should expose the total duration');
  assert.equal(detail.gameId, 'record-game', 'new record boost should include the game id');
  assert.equal(getState().boost.multiplier > 1, true, 'boost multiplier should be active after new record');
  assert.equal(Bridge.getHighScore('record-game'), 12, 'new record should persist the high score');
}

// no_double_start_in_same_run
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerWindow } = env;

  Bridge.start('record-game');

  const { getState } = installXp();
  drainTimers();

  const boostEvents = [];
  const xpBoosts = [];
  env.context.window.addEventListener('xp:boost', (event) => {
    if (!event || !event.detail) return;
    const detail = { ...event.detail };
    boostEvents.push(detail);
    if (detail.__xpOrigin === 'xp.js') {
      xpBoosts.push(detail);
    }
  });

  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 5 } });
  drainTimers();
  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 9 } });
  drainTimers();
  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 25 } });
  drainTimers();

  const newRecordEvents = xpBoosts.filter((event) => event.source === 'newRecord');
  assert.equal(newRecordEvents.length, 1, 'a single run should only start one new record boost');

  env.triggerWindow('pagehide', { persisted: false });
  drainTimers();

  const pagehideEvents = boostEvents.filter((event) => event.source === 'pagehide');
  assert.equal(pagehideEvents.length > 0, true, 'pagehide fallback should emit a boost reset');
  assert.equal(getState().boost.multiplier, 1, 'pagehide fallback should clear the active boost');
}

// game_over_stops_boost_and_saves_hs
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerWindow } = env;

  Bridge.start('record-game');

  const { getState } = installXp();
  drainTimers();

  const boostEvents = [];
  const xpBoosts = [];
  env.context.window.addEventListener('xp:boost', (event) => {
    if (!event || !event.detail) return;
    const detail = { ...event.detail };
    boostEvents.push(detail);
    if (detail.__xpOrigin === 'xp.js') {
      xpBoosts.push(detail);
    }
  });

  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 40 } });
  drainTimers();

  Bridge.gameOver({ score: 40 });
  drainTimers();

  assert.equal(Bridge.getHighScore('record-game'), 40, 'game over should persist the best score');
  assert.equal(getState().boost.multiplier, 1, 'game over should reset the boost state');

  const gameOverEvents = xpBoosts.filter((event) => event.source === 'gameOver');
  assert.equal(gameOverEvents.length, 1, 'game over should emit exactly one termination event');
  assert.equal(gameOverEvents[0].multiplier, 1, 'game over termination should disable boost');
  assert.equal(gameOverEvents[0].secondsLeft, 0, 'game over termination should report zero seconds left');

  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 45 } });
  drainTimers();

  const newRecordEvents = xpBoosts.filter((event) => event.source === 'newRecord');
  assert.equal(newRecordEvents.length, 2, 'a new run after game over should trigger another boost');
}

// no_record_no_boost
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerWindow } = env;

  Bridge.setHighScore('record-game', 100);
  Bridge.start('record-game');

  const { getState } = installXp();
  drainTimers();

  const boostEvents = [];
  env.context.window.addEventListener('xp:boost', (event) => {
    if (!event || !event.detail) return;
    boostEvents.push({ ...event.detail });
  });

  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 50 } });
  drainTimers();
  triggerWindow('message', { data: { type: 'game-score', gameId: 'record-game', score: 99 } });
  drainTimers();

  assert.equal(boostEvents.length, 0, 'scores below the record should not trigger boosts');
  assert.equal(getState().boost.multiplier, 1, 'boost should remain inactive without a new record');
  assert.equal(Bridge.getHighScore('record-game'), 100, 'stored high score should remain unchanged when not beaten');
}

// iframe activity messages should extend the active window
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerWindow } = env;

  Bridge.start('activity-game');

  const { getState } = installXp();
  drainTimers();

  const before = getState().activeUntil;
  triggerWindow('message', { data: { type: 'kcswh:activity', userGesture: true }, origin: env.context.window.location.origin });
  drainTimers();

  const after = getState().activeUntil;
  assert.equal(after > before, true, 'activity messages should extend the active window');
}

// early visibility resets should not cancel the first record boost
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerDoc, triggerWindow, updateVisibility } = env;

  Bridge.start('visibility-guard');

  installXp();
  drainTimers();

  const xpBoosts = [];
  env.context.window.addEventListener('xp:boost', (event) => {
    if (!event || !event.detail) return;
    if (event.detail.__xpOrigin === 'xp.js') {
      xpBoosts.push({ ...event.detail });
    }
  });

  updateVisibility({ hidden: true, visibilityState: 'hidden' });
  triggerDoc('visibilitychange');
  drainTimers();

  assert.equal(xpBoosts.length, 0, 'early visibility reset should not emit an internal boost');

  updateVisibility({ hidden: false, visibilityState: 'visible' });
  triggerDoc('visibilitychange');
  drainTimers();

  triggerWindow('message', { data: { type: 'game-score', gameId: 'visibility-guard', score: 18 } });
  drainTimers();

  const recordEvents = xpBoosts.filter((event) => event.source === 'newRecord');
  assert.equal(recordEvents.length, 1, 'record boost should still trigger after visibility bounce');
}

// BFCache resume should unlock another record boost
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerWindow } = env;

  Bridge.start('bfcache-game');

  installXp();
  drainTimers();

  const xpBoosts = [];
  env.context.window.addEventListener('xp:boost', (event) => {
    if (!event || !event.detail) return;
    if (event.detail.__xpOrigin === 'xp.js') {
      xpBoosts.push({ ...event.detail });
    }
  });

  triggerWindow('message', { data: { type: 'game-score', gameId: 'bfcache-game', score: 22 } });
  drainTimers();

  assert.equal(xpBoosts.filter((event) => event.source === 'newRecord').length, 1, 'first run should trigger a boost');

  env.triggerWindow('pagehide', { persisted: true });
  drainTimers();
  env.triggerWindow('pageshow', { persisted: true });
  drainTimers();

  triggerWindow('message', { data: { type: 'game-score', gameId: 'bfcache-game', score: 44 } });
  drainTimers();

  assert.equal(xpBoosts.filter((event) => event.source === 'newRecord').length, 2, 'BFCache resume should allow another record boost');
}
