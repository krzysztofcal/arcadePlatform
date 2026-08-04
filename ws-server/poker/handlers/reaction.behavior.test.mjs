import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REACTION_KEYS,
  clearTable,
  evaluateHumanReactionCommand,
  tryCreateBotReaction
} from './reaction.mjs';

test('human reactions use the closed allowlist and atomically reserve the sender cooldown', () => {
  const tableId = 'reaction-human-contract';
  clearTable(tableId);

  assert.deepEqual(REACTION_KEYS, [
    'hello',
    'nice_hand',
    'well_played',
    'thinking',
    'haha',
    'wow',
    'bad_beat',
    'nice_bluff',
    'good_luck',
    'thanks'
  ]);

  const first = evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-1',
    senderSeatNo: 2,
    reactionKey: ' wow ',
    nowMs: 1_000
  });
  const second = evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-1',
    senderSeatNo: 2,
    reactionKey: 'hello',
    nowMs: 1_000
  });

  assert.deepEqual(first, { ok: true, seatNo: 2, reactionKey: 'wow' });
  assert.deepEqual(second, { ok: false, reason: 'reaction_rate_limited' });
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-2',
    senderSeatNo: 1,
    reactionKey: 'not_allowed',
    nowMs: 1_000
  }), { ok: false, reason: 'invalid_reaction' });
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-3',
    senderSeatNo: null,
    reactionKey: 'hello',
    nowMs: 1_000
  }), { ok: false, reason: 'invalid_sender' });

  clearTable(tableId);
});

test('targeted human reactions require nice_hand, matching settlement facts, and share the cooldown', () => {
  const tableId = 'reaction-targeted-contract';
  clearTable(tableId);

  const first = evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-1',
    senderSeatNo: 2,
    reactionKey: 'nice_hand',
    targeted: true,
    targetSeatNo: 4,
    targetOccupied: true,
    targetIsWinner: true,
    settlementMatchesHand: true,
    settlementWindowOpen: true,
    nowMs: 1_000
  });
  assert.deepEqual(first, { ok: true, seatNo: 2, targetSeatNo: 4, reactionKey: 'nice_hand' });

  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-1',
    senderSeatNo: 2,
    reactionKey: 'nice_hand',
    targeted: true,
    targetSeatNo: 4,
    targetOccupied: true,
    targetIsWinner: true,
    settlementMatchesHand: true,
    settlementWindowOpen: true,
    nowMs: 1_000
  }), { ok: false, reason: 'reaction_rate_limited' });

  clearTable(tableId);
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-2',
    senderSeatNo: 2,
    reactionKey: 'wow',
    targeted: true,
    targetSeatNo: 4,
    targetOccupied: true,
    targetIsWinner: true,
    settlementMatchesHand: true,
    settlementWindowOpen: true,
    nowMs: 2_000
  }), { ok: false, reason: 'invalid_reaction' });
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-3',
    senderSeatNo: 2,
    reactionKey: 'nice_hand',
    targeted: true,
    targetSeatNo: 4,
    targetOccupied: true,
    targetIsWinner: true,
    settlementMatchesHand: false,
    settlementWindowOpen: true,
    nowMs: 2_000
  }), { ok: false, reason: 'settlement_mismatch' });
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-4',
    senderSeatNo: 2,
    reactionKey: 'nice_hand',
    targeted: true,
    targetSeatNo: 4,
    targetOccupied: true,
    targetIsWinner: false,
    settlementMatchesHand: true,
    settlementWindowOpen: true,
    nowMs: 2_000
  }), { ok: false, reason: 'target_not_available' });
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-5',
    senderSeatNo: 2,
    reactionKey: 'nice_hand',
    targeted: true,
    targetSeatNo: 4,
    targetOccupied: true,
    targetIsWinner: true,
    settlementMatchesHand: true,
    settlementWindowOpen: false,
    nowMs: 2_000
  }), { ok: false, reason: 'settlement_reaction_window_closed' });

  clearTable(tableId);
});

test('bot reactions use the real bot action object and table-level throttle', () => {
  const tableId = 'reaction-bot-contract';
  clearTable(tableId);

  const accepted = tryCreateBotReaction({
    tableId,
    botUserId: 'bot-1',
    botSeatNo: 3,
    botAction: { type: ' raise ', amount: 40 },
    nowMs: 2_000,
    random: (() => {
      const values = [0.01, 0.9];
      return () => values.shift();
    })()
  });
  const throttledForAnotherBot = tryCreateBotReaction({
    tableId,
    botUserId: 'bot-2',
    botSeatNo: 4,
    botAction: { type: 'BET', amount: 20 },
    nowMs: 2_001,
    random: () => 0.01
  });

  assert.deepEqual(accepted, { seatNo: 3, reactionKey: 'haha' });
  assert.equal(throttledForAnotherBot, null);
  assert.equal(tryCreateBotReaction({
    tableId,
    botUserId: 'bot-3',
    botSeatNo: 5,
    botAction: { type: 'FOLD' },
    nowMs: 30_000,
    random: () => 0.01
  }), null);
  assert.equal(tryCreateBotReaction({
    tableId,
    botUserId: 'bot-4',
    botSeatNo: 6,
    botAction: 'RAISE',
    nowMs: 30_000,
    random: () => 0.01
  }), null);

  clearTable(tableId);
  const afterClear = tryCreateBotReaction({
    tableId,
    botUserId: 'bot-1',
    botSeatNo: 3,
    botAction: { type: 'ALL_IN' },
    nowMs: 40_000,
    random: () => 0.01
  });
  assert.deepEqual(afterClear, { seatNo: 3, reactionKey: 'wow' });
  clearTable(tableId);
});
