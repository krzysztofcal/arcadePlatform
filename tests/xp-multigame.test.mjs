import assert from 'node:assert/strict';

import { createEnvironment } from './helpers/xp-env.mjs';

{
  const env = createEnvironment({ bodyGameId: 'First Championship', title: 'First Championship' });
  const { Bridge, drainTimers, installXp, triggerDoc, updateGameDocument } = env;

  Bridge.auto();

  const { XP, getState } = installXp();

  const startHistory = [];
  const stopHistory = [];

  const originalStart = XP.startSession;
  XP.startSession = function patchedStart(gameId) {
    startHistory.push(gameId);
    return originalStart.apply(this, arguments);
  };

  const originalStop = XP.stopSession;
  XP.stopSession = function patchedStop(options) {
    stopHistory.push(options);
    return originalStop.apply(this, arguments);
  };

  drainTimers();

  assert.equal(getState().running, true, 'auto should start the detected game once XP loads');
  const firstGameId = getState().gameId;
  assert.equal(firstGameId, 'first-championship', 'auto should slugify the first document game id');
  assert.equal(startHistory.at(-1), firstGameId, 'initial start should use the slugged id');

  triggerDoc('xp:hidden');
  drainTimers();

  assert.equal(getState().running, false, 'xp:hidden should pause the session');
  const hiddenStop = stopHistory.at(-1) || {};
  assert.equal(hiddenStop && typeof hiddenStop, 'object', 'xp:hidden should forward stop options');
  assert.equal(hiddenStop.flush, true, 'xp:hidden should flush by default');

  triggerDoc('xp:visible');
  drainTimers();

  assert.equal(getState().running, true, 'xp:visible should resume the session');
  assert.equal(startHistory.at(-1), firstGameId, 'resume should reuse the original slug');

  const initialScore = getState().scoreDelta;
  Bridge.add(0.4);
  drainTimers();
  assert.equal(getState().scoreDelta, initialScore, 'fractional adds below one should queue');

  Bridge.add(0.35);
  drainTimers();
  assert.equal(getState().scoreDelta, initialScore, 'queued fractions should persist across adds');

  Bridge.add(0.25);
  drainTimers();
  assert.equal(getState().scoreDelta, initialScore + 1, 'fractional adds should roll up to a whole point');

  triggerDoc('xp:hidden');
  drainTimers();
  assert.equal(getState().running, false, 'hidden before switching should stop the first session');

  updateGameDocument({ bodyGameId: 'Second Showdown', title: 'Second Showdown' });

  Bridge.auto();
  drainTimers();

  assert.equal(getState().running, true, 'auto should start the new game after navigation');
  const secondGameId = getState().gameId;
  assert.equal(secondGameId, 'second-showdown', 'auto should detect the second document game id');
  assert.notEqual(secondGameId, firstGameId, 'each document should receive a distinct game id');
  assert.equal(startHistory.at(-1), secondGameId, 'second start should pass the new slug to XP');

  const inputsBefore = getState().inputEvents;
  Bridge.nudge();
  assert.equal(getState().inputEvents > inputsBefore, true, 'nudge should increment XP activity counters');

  const secondScore = getState().scoreDelta;
  Bridge.add(0.4);
  drainTimers();
  assert.equal(getState().scoreDelta, secondScore, 'new session should reset fractional remainder');

  Bridge.add(0.35);
  drainTimers();
  assert.equal(getState().scoreDelta, secondScore, 'queued adds should carry within the new session');

  Bridge.add(0.25);
  drainTimers();
  assert.equal(getState().scoreDelta, secondScore + 1, 'new session fractional roll-up should award points');

  triggerDoc('xp:hidden');
  drainTimers();
  assert.equal(getState().running, false, 'final hidden event should stop the second session');
  const finalStop = stopHistory.at(-1) || {};
  assert.equal(finalStop.flush, true, 'final stop should preserve the flush option');
}
