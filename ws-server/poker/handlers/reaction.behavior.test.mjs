import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HUMAN_REACTION_KEYS,
  REACTION_KEYS,
  classifyAmbientReaction,
  classifyDirectedBotReaction,
  classifyRaiseReaction,
  classifySettlementReaction,
  canBotStartReaction,
  clearTable,
  deriveRiverChangedWinnerUserIds,
  evaluateHumanReactionCommand,
  isCompleteReactionSettlement,
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
    'thanks',
    'hurry_up',
    'you_are_bluffing',
    'i_was_bluffing',
    'lucky',
    'congrats',
    'not_this_time',
    'ambient_hmm',
    'ambient_interesting',
    'ambient_lets_see',
    'ambient_well_see',
    'ambient_watching',
    'ambient_good_move',
    'ambient_bold',
    'ambient_nice',
    'ambient_tough_one',
    'ambient_here_we_go',
    'ambient_your_move',
    'ambient_lets_play',
    'ambient_thinking'
  ]);
  assert.equal(HUMAN_REACTION_KEYS.includes('hurry_up'), false);
  assert.equal(HUMAN_REACTION_KEYS.includes('lucky'), false);
  assert.equal(HUMAN_REACTION_KEYS.includes('not_this_time'), false);
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-bot-key',
    senderSeatNo: 6,
    reactionKey: 'hurry_up',
    nowMs: 1_000
  }), { ok: false, reason: 'invalid_reaction' });
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-fold',
    senderSeatNo: 5,
    reactionKey: 'not_this_time',
    nowMs: 1_000
  }), { ok: false, reason: 'invalid_reaction' });

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

test('targeted human reactions allow each winner once per authoritative settled hand', () => {
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
    settlementHandId: 'hand-a',
    nowMs: 1_000
  });
  assert.deepEqual(first, { ok: true, seatNo: 2, targetSeatNo: 4, reactionKey: 'nice_hand' });

  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-1',
    senderSeatNo: 2,
    reactionKey: 'nice_hand',
    targeted: true,
    targetSeatNo: 5,
    targetOccupied: true,
    targetIsWinner: true,
    settlementMatchesHand: true,
    settlementWindowOpen: true,
    settlementHandId: 'hand-a',
    nowMs: 1_000
  }), { ok: true, seatNo: 2, targetSeatNo: 5, reactionKey: 'nice_hand' });

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
    settlementHandId: 'hand-a',
    nowMs: 5_001
  }), { ok: false, reason: 'reaction_already_sent' });

  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-1',
    senderSeatNo: 2,
    reactionKey: 'wow',
    nowMs: 1_000
  }), { ok: true, seatNo: 2, reactionKey: 'wow' });
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-1',
    senderSeatNo: 2,
    reactionKey: 'hello',
    nowMs: 1_000
  }), { ok: false, reason: 'reaction_rate_limited' });

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
    settlementHandId: 'hand-b',
    nowMs: 1_000
  }), { ok: true, seatNo: 2, targetSeatNo: 4, reactionKey: 'nice_hand' });

  clearTable(tableId);
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
    settlementHandId: 'hand-b',
    nowMs: 1_000
  }), { ok: true, seatNo: 2, targetSeatNo: 4, reactionKey: 'nice_hand' });
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
    settlementHandId: 'hand-validation',
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
    settlementHandId: 'hand-validation',
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
    settlementHandId: 'hand-validation',
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
    settlementHandId: 'hand-validation',
    nowMs: 2_000
  }), { ok: false, reason: 'settlement_reaction_window_closed' });

  clearTable(tableId);
});

test('bot reactions use the real bot action object and independent sender cooldowns', () => {
  const tableId = 'reaction-bot-contract';
  clearTable(tableId);

  const accepted = tryCreateBotReaction({
    tableId,
    botUserId: 'bot-1',
    botSeatNo: 3,
    botAction: { type: ' bet ', amount: 40 },
    nowMs: 2_000,
    random: (() => {
      const values = [0.01, 0.9, 0];
      return () => values.shift();
    })()
  });
  const acceptedForAnotherBot = tryCreateBotReaction({
    tableId,
    botUserId: 'bot-2',
    botSeatNo: 4,
    botAction: { type: 'BET', amount: 20 },
    nowMs: 2_001,
    random: (() => { const values = [0.01, 0, 0]; return () => values.shift(); })()
  });

  assert.deepEqual(accepted, { seatNo: 3, reactionKey: 'haha', delayMs: 300 });
  assert.deepEqual(acceptedForAnotherBot, { seatNo: 4, reactionKey: 'wow', delayMs: 300 });
  assert.equal(canBotStartReaction({ tableId, botUserId: 'bot-1', nowMs: 2_001 }), false);
  assert.equal(canBotStartReaction({ tableId, botUserId: 'bot-3', nowMs: 2_001 }), true);
  assert.equal(tryCreateBotReaction({
    tableId,
    botUserId: 'bot-1',
    botSeatNo: 3,
    botAction: { type: 'BET', amount: 20 },
    nowMs: 2_001,
    random: () => 0.01
  }), null, 'the same bot must retain its four-second cooldown');
  assert.deepEqual(tryCreateBotReaction({
    tableId,
    botUserId: 'bot-3',
    botSeatNo: 5,
    botAction: { type: 'FOLD' },
    nowMs: 30_000,
    random: (() => { const values = [0.69, 0, 0]; return () => values.shift(); })()
  }), { seatNo: 5, reactionKey: 'not_this_time', delayMs: 300 });
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
  assert.deepEqual(afterClear, { seatNo: 3, reactionKey: 'wow', delayMs: 309 });
  clearTable(tableId);
});

test('contextual classifiers keep raise and fold-win meanings distinct', () => {
  assert.deepEqual(classifyRaiseReaction({
    actorUserId: 'human',
    actorSeatNo: 2,
    botSeats: [{ userId: 'bot', seatNo: 4 }],
    random: () => 0
  }), {
    botUserId: 'bot', botSeatNo: 4, targetSeatNo: 2, reactionKey: 'you_are_bluffing'
  });
  assert.equal(classifyRaiseReaction({
    actorUserId: 'human', actorSeatNo: 2, botSeats: [{ userId: 'bot', seatNo: 4 }],
    reactionSettings: { enabled: false, frequencyPercent: 100 }, random: () => 0
  }), null);
  assert.equal(classifyRaiseReaction({
    actorUserId: 'human', actorSeatNo: 2, botSeats: [{ userId: 'bot', seatNo: 4 }],
    reactionSettings: { enabled: true, frequencyPercent: 1 }, random: () => 0.007
  }), null, '1% frequency must scale the 60% base chance to 0.6%');

  const baseState = {
    phase: 'SETTLED',
    handId: 'hand-fold',
    handSettlement: { handId: 'hand-fold', payouts: { bot: 100, human: 100 } },
    showdown: { handId: 'hand-fold', winners: ['bot'] },
    handSeats: [{ userId: 'human', seatNo: 2 }, { userId: 'bot', seatNo: 4 }],
    foldedByUserId: { human: true },
    leftTableByUserId: {},
    sitOutByUserId: {},
    bigBlind: 10
  };
  assert.equal(classifySettlementReaction({
    state: baseState,
    botSeats: [{ userId: 'bot', seatNo: 4 }],
    random: () => 0
  }).reactionKey, 'i_was_bluffing');

  assert.deepEqual(classifySettlementReaction({
    state: {
      ...baseState,
      showdown: { handId: 'hand-fold', winners: ['human'] },
      foldedByUserId: { bot: true }
    },
    botSeats: [{ userId: 'bot', seatNo: 4 }],
    random: () => 0
  }), {
    botUserId: 'bot', botSeatNo: 4, targetSeatNo: 2, reactionKey: 'nice_bluff', handId: 'hand-fold'
  });

  const incomplete = { ...baseState, showdown: { winners: ['bot'] } };
  assert.equal(isCompleteReactionSettlement(incomplete), false);
  assert.equal(classifySettlementReaction({ state: incomplete, botSeats: [{ userId: 'bot', seatNo: 4 }], random: () => 0 }), null);
  assert.equal(isCompleteReactionSettlement(baseState), true);
  assert.equal(classifySettlementReaction({
    state: { ...baseState, sitOutByUserId: { bot: true } },
    botSeats: [{ userId: 'bot', seatNo: 4 }],
    random: () => 0
  }), null);
  assert.equal(classifySettlementReaction({
    state: {
      ...baseState,
      showdown: { handId: 'hand-fold', winners: ['human'] },
      foldedByUserId: { bot: true },
      sitOutByUserId: { bot: true }
    },
    botSeats: [{ userId: 'bot', seatNo: 4 }],
    random: () => 0
  }), null);
});

test('settlement classifiers use deterministic seats and authoritative payouts', () => {
  const state = {
    phase: 'SETTLED',
    handId: 'split',
    bigBlind: 10,
    handSettlement: { handId: 'split', payouts: { 'bot-6': 199, 'bot-3': 200 } },
    showdown: {
      handId: 'split',
      winners: ['bot-6', 'bot-3'],
      handsByUserId: { 'bot-6': { category: 2 }, 'bot-3': { category: 2 }, human: { category: 1 } }
    },
    handSeats: [
      { userId: 'bot-6', seatNo: 6 },
      { userId: 'bot-3', seatNo: 3 },
      { userId: 'human', seatNo: 1 }
    ],
    foldedByUserId: {}, leftTableByUserId: {}, sitOutByUserId: {}
  };
  assert.deepEqual(classifySettlementReaction({
    state,
    botSeats: [{ userId: 'bot-6', seatNo: 6 }, { userId: 'bot-3', seatNo: 3 }],
    random: () => 0.99
  }), { botUserId: 'bot-3', botSeatNo: 3, reactionKey: 'wow', handId: 'split' });

  const shownHandState = {
    ...state,
    handSettlement: { handId: 'split', payouts: { human: 50 } },
    showdown: {
      handId: 'split',
      winners: ['human'],
      handsByUserId: { human: { category: 4 }, 'bot-3': { category: 2 } }
    }
  };
  assert.deepEqual(classifySettlementReaction({
    state: shownHandState,
    botSeats: [{ userId: 'bot-3', seatNo: 3 }],
    random: () => 0
  }), { botUserId: 'bot-3', botSeatNo: 3, targetSeatNo: 1, reactionKey: 'nice_hand', handId: 'split' });

  assert.deepEqual(classifySettlementReaction({
    state: { ...shownHandState, showdown: { handId: 'split', winners: ['human'] } },
    botSeats: [{ userId: 'bot-3', seatNo: 3 }],
    random: () => 0
  }), { botUserId: 'bot-3', botSeatNo: 3, targetSeatNo: 1, reactionKey: 'well_played', handId: 'split' });
  assert.equal(classifySettlementReaction({
    state: { ...shownHandState, showdown: { handId: 'split', winners: ['human'] } },
    botSeats: [{ userId: 'bot-3', seatNo: 3 }],
    random: (() => { const values = [0.1, 0.9]; return () => values.shift(); })()
  }).reactionKey, 'congrats');

  assert.equal(classifySettlementReaction({
    state: { ...shownHandState, sitOutByUserId: { 'bot-3': true } },
    botSeats: [{ userId: 'bot-3', seatNo: 3 }],
    random: () => 0
  }), null);
});

test('settlement uses one aggregate lucky roll for close ranks and river reversals', () => {
  const state = {
    phase: 'SETTLED',
    handId: 'lucky-hand',
    bigBlind: 10,
    handSettlement: { handId: 'lucky-hand', payouts: { winner: 40 } },
    showdown: {
      handId: 'lucky-hand',
      winners: ['winner'],
      handsByUserId: {
        winner: { category: 2, ranks: [10, 14, 9, 8], key: '2:10,14,9,8' },
        bot: { category: 2, ranks: [10, 13, 9, 8], key: '2:10,13,9,8' }
      }
    },
    handSeats: [{ userId: 'winner', seatNo: 4 }, { userId: 'bot', seatNo: 2 }],
    foldedByUserId: {}, leftTableByUserId: {}, sitOutByUserId: {}
  };
  let rolls = 0;
  assert.deepEqual(classifySettlementReaction({
    state,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => { rolls += 1; return 0; }
  }), { botUserId: 'bot', botSeatNo: 2, targetSeatNo: 4, reactionKey: 'lucky', handId: 'lucky-hand' });
  assert.equal(rolls, 1, 'overlapping close-rank signals must share one lucky probability roll');

  assert.equal(classifySettlementReaction({
    state: { ...state, riverChangedWinnerUserIds: ['winner'], showdown: { ...state.showdown, handsByUserId: undefined } },
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  }).reactionKey, 'lucky');

  assert.deepEqual(deriveRiverChangedWinnerUserIds({
    community: [
      { r: 2, s: 'H' }, { r: 7, s: 'H' }, { r: 9, s: 'S' }, { r: 13, s: 'C' }, { r: 11, s: 'H' }
    ],
    holeCardsByUserId: {
      winner: [{ r: 14, s: 'H' }, { r: 12, s: 'H' }],
      bot: [{ r: 13, s: 'S' }, { r: 13, s: 'D' }]
    },
    showdown: { winners: ['winner'], handsByUserId: { winner: {}, bot: {} } }
  }), ['winner'], 'the river flush should reverse the turn leader without mutating settlement');

  assert.equal(classifySettlementReaction({
    state: {
      ...state,
      showdown: {
        ...state.showdown,
        handsByUserId: {
          winner: { category: 5, ranks: [14] },
          bot: { category: 5, ranks: [5] }
        }
      }
    },
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0.99
  }), null, 'one differing rank with a large gap must not qualify as almost identical');
});

test('directed classifier supports bot-only hurry up copy without exposing intent inference', () => {
  assert.deepEqual(classifyDirectedBotReaction({
    botSeats: [{ userId: 'bot', seatNo: 3 }],
    excludedUserId: 'human',
    targetSeatNo: 2,
    reactionKeys: ['hurry_up'],
    probability: 0.25,
    random: () => 0
  }), { botUserId: 'bot', botSeatNo: 3, targetSeatNo: 2, reactionKey: 'hurry_up' });

  assert.equal(classifyDirectedBotReaction({
    botSeats: [{ userId: 'bot', seatNo: 3 }],
    excludedUserId: 'human',
    targetSeatNo: 2,
    reactionKeys: ['thanks'],
    probability: 0.5,
    random: () => 0
  }).reactionKey, 'thanks');
  assert.equal(classifyDirectedBotReaction({
    botSeats: [{ userId: 'bot', seatNo: 3 }],
    excludedUserId: 'human',
    targetSeatNo: 2,
    reactionKeys: ['hello', 'good_luck'],
    probability: 0.35,
    random: (() => { const values = [0, 0.9]; return () => values.shift(); })()
  }).reactionKey, 'good_luck');
});

test('ambient table talk uses one scaled roll and then selects one bot and message', () => {
  assert.deepEqual(classifyAmbientReaction({
    botSeats: [{ userId: 'bot-2', seatNo: 2 }, { userId: 'bot-4', seatNo: 4 }],
    reactionSettings: { enabled: true, frequencyPercent: 100 },
    random: (() => { const values = [0.1, 0.9, 0.99]; return () => values.shift(); })()
  }), { botUserId: 'bot-4', botSeatNo: 4, reactionKey: 'ambient_thinking' });
  assert.equal(classifyAmbientReaction({
    botSeats: [{ userId: 'bot-2', seatNo: 2 }],
    reactionSettings: { enabled: false, frequencyPercent: 100 },
    random: () => 0
  }), null);
});
