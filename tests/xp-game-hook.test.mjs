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
