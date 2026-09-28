import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_IN_LOSS_REACTION_KEYS,
  HUMAN_REACTION_KEYS,
  REACTION_KEYS,
  classifyAmbientReaction,
  classifyDirectedBotReaction,
  classifyRaiseReaction,
  classifySettlementReaction,
  canBotStartReaction,
  clearTable,
  deriveRiverChangedWinnerUserIds,
  eligibleActiveHandBotSeats,
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
    'cheers',
    'gg',
    'hurry_up',
    'you_are_bluffing',
    'i_was_bluffing',
    'lucky',
    'congrats',
    'not_this_time',
    'all_in_oh_no',
    'all_in_that_hurts',
    'all_in_no_way',
    'all_in_come_on',
    'all_in_censored',
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
  assert.deepEqual(ALL_IN_LOSS_REACTION_KEYS, [
    'all_in_oh_no',
    'all_in_that_hurts',
    'all_in_no_way',
    'all_in_come_on',
    'all_in_censored'
  ]);
  assert.deepEqual(HUMAN_REACTION_KEYS, [
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
    'cheers',
    'gg',
    'hurry_up'
  ]);
  assert.equal(HUMAN_REACTION_KEYS.includes('lucky'), false);
  assert.equal(HUMAN_REACTION_KEYS.includes('not_this_time'), false);
  for (const key of ALL_IN_LOSS_REACTION_KEYS) {
    assert.equal(HUMAN_REACTION_KEYS.includes(key), false, `${key} must not be in HUMAN_REACTION_KEYS`);
  }
  assert.deepEqual(evaluateHumanReactionCommand({
    tableId,
    senderUserId: 'human-hurry',
    senderSeatNo: 6,
    reactionKey: 'hurry_up',
    nowMs: 1_000
  }), { ok: true, seatNo: 6, reactionKey: 'hurry_up' });
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

test('active-hand bot eligibility excludes folded, departed, sitting-out, and non-participating bots', () => {
  assert.deepEqual(eligibleActiveHandBotSeats({
    state: {
      handSeats: [
        { userId: 'bot-active', seatNo: 5 },
        { userId: 'bot-folded', seatNo: 2 },
        { userId: 'bot-left', seatNo: 3 },
        { userId: 'bot-sit-out', seatNo: 4 }
      ],
      foldedByUserId: { 'bot-folded': true },
      leftTableByUserId: { 'bot-left': true },
      sitOutByUserId: { 'bot-sit-out': true }
    },
    botSeats: [
      { userId: 'bot-active', seatNo: 5 },
      { userId: 'bot-outside', seatNo: 1 },
      { userId: 'bot-folded', seatNo: 2 },
      { userId: 'bot-left', seatNo: 3 },
      { userId: 'bot-sit-out', seatNo: 4 }
    ]
  }), [{ userId: 'bot-active', seatNo: 5 }]);
});

test('contextual classifiers keep post-flop raise and fold-win meanings distinct', () => {
  assert.deepEqual(classifyRaiseReaction({
    actorUserId: 'human',
    actorSeatNo: 2,
    street: 'FLOP',
    botSeats: [{ userId: 'bot', seatNo: 4 }],
    random: () => 0
  }), {
    botUserId: 'bot', botSeatNo: 4, targetSeatNo: 2, reactionKey: 'you_are_bluffing'
  });
  assert.equal(classifyRaiseReaction({
    actorUserId: 'human', actorSeatNo: 2, botSeats: [{ userId: 'bot', seatNo: 4 }],
    street: 'TURN',
    reactionSettings: { enabled: false, frequencyPercent: 100 }, random: () => 0
  }), null);
  assert.equal(classifyRaiseReaction({
    actorUserId: 'human', actorSeatNo: 2, botSeats: [{ userId: 'bot', seatNo: 4 }],
    street: 'RIVER',
    reactionSettings: { enabled: true, frequencyPercent: 1 }, random: () => 0.007
  }), null, '1% frequency must scale the 60% base chance to 0.6%');
  assert.equal(classifyRaiseReaction({
    actorUserId: 'human', actorSeatNo: 2, street: 'PREFLOP',
    botSeats: [{ userId: 'bot', seatNo: 4 }], random: () => 0
  }), null);
  assert.equal(classifyRaiseReaction({
    actorUserId: 'human', actorSeatNo: 2, street: 'SETTLED',
    botSeats: [{ userId: 'bot', seatNo: 4 }], random: () => 0
  }), null);
  assert.equal(classifyRaiseReaction({
    actorUserId: 'human', actorSeatNo: 2,
    botSeats: [{ userId: 'bot', seatNo: 4 }], random: () => 0
  }), null);

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

test('ordinary lost all-in bot selects uniformly from the 5-item loss pool and never not_this_time', () => {
  const baseAllInLossState = {
    phase: 'SETTLED',
    handId: 'hand-all-in-loss',
    bigBlind: 10,
    handStartStacksByUserId: { 'bot-lost': 100, human: 100 },
    contributionsByUserId: { 'bot-lost': 100, human: 100 },
    handSettlement: { handId: 'hand-all-in-loss', payouts: { human: 200 } },
    showdown: {
      handId: 'hand-all-in-loss',
      winners: ['human'],
      handsByUserId: { 'bot-lost': { category: 1 }, human: { category: 2 } }
    },
    handSeats: [{ userId: 'bot-lost', seatNo: 2 }, { userId: 'human', seatNo: 1 }],
    foldedByUserId: {},
    leftTableByUserId: {},
    sitOutByUserId: {},
    riverChangedWinnerUserIds: []
  };

  const testCases = [
    { randomVal: 0.05, expectedKey: 'all_in_oh_no' },
    { randomVal: 0.25, expectedKey: 'all_in_that_hurts' },
    { randomVal: 0.45, expectedKey: 'all_in_no_way' },
    { randomVal: 0.65, expectedKey: 'all_in_come_on' },
    { randomVal: 0.85, expectedKey: 'all_in_censored' }
  ];

  for (const { randomVal, expectedKey } of testCases) {
    const draws = [0.1, randomVal];
    const result = classifySettlementReaction({
      state: baseAllInLossState,
      botSeats: [{ userId: 'bot-lost', seatNo: 2 }],
      random: () => draws.shift()
    });
    assert.ok(result, `must produce candidate for randomVal ${randomVal}`);
    assert.equal(result.reactionKey, expectedKey);
    assert.notEqual(result.reactionKey, 'not_this_time', 'must never emit not_this_time on lost all-in');
    assert.equal(result.botUserId, 'bot-lost');
    assert.equal(result.botSeatNo, 2);
    assert.equal(result.targetSeatNo, undefined, 'lost all-in reactions must omit targetSeatNo');
  }
});

test('heads-up all-in river reversal triggers bad_beat broadcast and multiway falls back to loss pool', () => {
  const headsUpBadBeatState = {
    phase: 'SETTLED',
    handId: 'hand-bad-beat',
    bigBlind: 10,
    handStartStacksByUserId: { 'bot-bb': 200, human: 200 },
    contributionsByUserId: { 'bot-bb': 200, human: 200 },
    handSettlement: { handId: 'hand-bad-beat', payouts: { human: 400 } },
    showdown: {
      handId: 'hand-bad-beat',
      winners: ['human'],
      handsByUserId: { 'bot-bb': { category: 2 }, human: { category: 3 } }
    },
    handSeats: [{ userId: 'bot-bb', seatNo: 3 }, { userId: 'human', seatNo: 1 }],
    foldedByUserId: {},
    leftTableByUserId: {},
    sitOutByUserId: {},
    riverChangedWinnerUserIds: ['human']
  };

  const result = classifySettlementReaction({
    state: headsUpBadBeatState,
    botSeats: [{ userId: 'bot-bb', seatNo: 3 }],
    random: () => 0.1
  });
  assert.deepEqual(result, {
    botUserId: 'bot-bb',
    botSeatNo: 3,
    reactionKey: 'bad_beat',
    handId: 'hand-bad-beat'
  });
  assert.equal(result.targetSeatNo, undefined, 'bad_beat must omit targetSeatNo');

  const threeSeatsHeadsUpState = {
    ...headsUpBadBeatState,
    handSeats: [
      { userId: 'bot-bb', seatNo: 3 },
      { userId: 'human', seatNo: 1 },
      { userId: 'left-player', seatNo: 5 }
    ],
    leftTableByUserId: { 'left-player': true }
  };
  const threeSeatsResult = classifySettlementReaction({
    state: threeSeatsHeadsUpState,
    botSeats: [{ userId: 'bot-bb', seatNo: 3 }],
    random: () => 0.1
  });
  assert.equal(threeSeatsResult.reactionKey, 'bad_beat', '3 handSeats with 2 evaluated hands must qualify as heads-up');

  const multiwayState = {
    ...headsUpBadBeatState,
    showdown: {
      handId: 'hand-bad-beat',
      winners: ['human'],
      handsByUserId: {
        'bot-bb': { category: 2 },
        human: { category: 3 },
        other: { category: 1 }
      }
    },
    handSeats: [
      { userId: 'bot-bb', seatNo: 3 },
      { userId: 'human', seatNo: 1 },
      { userId: 'other', seatNo: 5 }
    ]
  };
  const multiwayDraws = [0.1, 0.45];
  const multiwayResult = classifySettlementReaction({
    state: multiwayState,
    botSeats: [{ userId: 'bot-bb', seatNo: 3 }],
    random: () => multiwayDraws.shift()
  });
  assert.notEqual(multiwayResult.reactionKey, 'bad_beat', 'multiway showdown must not trigger bad_beat');
  assert.equal(multiwayResult.reactionKey, 'all_in_no_way', 'multiway must fall back to 5-reaction pool');
});

test('authoritative evidence and fail-closed safety for all-in branch', () => {
  const baseState = {
    phase: 'SETTLED',
    handId: 'hand-safety',
    bigBlind: 10,
    handStartStacksByUserId: { bot: 100, human: 100 },
    contributionsByUserId: { bot: 100, human: 100 },
    handSettlement: { handId: 'hand-safety', payouts: { human: 200 } },
    showdown: {
      handId: 'hand-safety',
      winners: ['human'],
      handsByUserId: { bot: { category: 1 }, human: { category: 4 } }
    },
    handSeats: [{ userId: 'bot', seatNo: 2 }, { userId: 'human', seatNo: 1 }],
    foldedByUserId: {},
    leftTableByUserId: {},
    sitOutByUserId: {},
    riverChangedWinnerUserIds: []
  };

  const corruptContribState = {
    ...baseState,
    contributionsByUserId: { bot: 150, human: 100 }
  };
  const corruptResult = classifySettlementReaction({
    state: corruptContribState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  });
  assert.equal(corruptResult.reactionKey, 'nice_hand', 'corrupt accounting must cleanly fall through to generic waterfall');

  const missingAccountingState = {
    ...baseState,
    handStartStacksByUserId: undefined,
    contributionsByUserId: undefined
  };
  const missingResult = classifySettlementReaction({
    state: missingAccountingState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  });
  assert.equal(missingResult.reactionKey, 'nice_hand', 'missing accounting maps must fall through to generic waterfall');

  const stringAccountingState = {
    ...baseState,
    handStartStacksByUserId: { bot: '100', human: 100 },
    contributionsByUserId: { bot: '100', human: 100 }
  };
  const stringResult = classifySettlementReaction({
    state: stringAccountingState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  });
  assert.equal(stringResult.reactionKey, 'nice_hand', 'string accounting values must not be coerced and must fall through');

  const notEvaluatedState = {
    ...baseState,
    handSeats: [{ userId: 'bot', seatNo: 2 }, { userId: 'human', seatNo: 1 }, { userId: 'third_player', seatNo: 3 }],
    showdown: {
      handId: 'hand-safety',
      winners: ['human'],
      handsByUserId: { human: { category: 4 }, third_player: { category: 1 } }
    }
  };
  const notEvaluatedResult = classifySettlementReaction({
    state: notEvaluatedState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  });
  assert.equal(notEvaluatedResult.reactionKey, 'nice_hand', 'bot omitted from evaluated showdown hands must fall through');

  const missingPayoutKeyState = {
    ...baseState,
    handSettlement: { handId: 'hand-safety', payouts: { human: 200 } }
  };
  const missingKeyDraws = [0.1, 0.05];
  const missingKeyResult = classifySettlementReaction({
    state: missingPayoutKeyState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => missingKeyDraws.shift()
  });
  assert.equal(missingKeyResult.reactionKey, 'all_in_oh_no', 'missing bot key in payouts is valid 0 chips and qualifies for all-in loss');

  const malformedPayoutCases = [null, undefined, 'abc', NaN, 12.5, -5];
  for (const badPayout of malformedPayoutCases) {
    const malformedState = {
      ...baseState,
      handSettlement: { handId: 'hand-safety', payouts: { human: 200, bot: badPayout } }
    };
    const malformedResult = classifySettlementReaction({
      state: malformedState,
      botSeats: [{ userId: 'bot', seatNo: 2 }],
      random: () => 0
    });
    assert.equal(malformedResult.reactionKey, 'nice_hand', `malformed payout (${badPayout}) must fail closed and fall through`);
  }

  const uncalledReturnState = {
    ...baseState,
    handSettlement: { handId: 'hand-safety', payouts: { human: 180, bot: 20 } }
  };
  const uncalledResult = classifySettlementReaction({
    state: uncalledReturnState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  });
  assert.equal(uncalledResult.reactionKey, 'nice_hand', 'positive payout must disqualify from all-in and fall through');

  const nonAllInState = {
    ...baseState,
    handStartStacksByUserId: { bot: 100, human: 100 },
    contributionsByUserId: { bot: 50, human: 100 }
  };
  const nonAllResult = classifySettlementReaction({
    state: nonAllInState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  });
  assert.equal(nonAllResult.reactionKey, 'nice_hand', 'non-all-in loser must fall through to generic reaction');

  const foldedState = {
    ...baseState,
    foldedByUserId: { bot: true }
  };
  const foldedResult = classifySettlementReaction({
    state: foldedState,
    botSeats: [{ userId: 'bot', seatNo: 2 }],
    random: () => 0
  });
  assert.notEqual(foldedResult?.reactionKey, 'bad_beat', 'folded bot must not trigger bad_beat');
  assert.equal(ALL_IN_LOSS_REACTION_KEYS.includes(foldedResult?.reactionKey), false, 'folded bot must not trigger all-in loss');
});

test('classifier priority and seat ordering for lost all-in reactions', () => {
  const multiBotState = {
    phase: 'SETTLED',
    handId: 'hand-priority',
    bigBlind: 10,
    handStartStacksByUserId: { 'bot-4': 100, 'bot-2': 100, human: 100 },
    contributionsByUserId: { 'bot-4': 100, 'bot-2': 100, human: 100 },
    handSettlement: { handId: 'hand-priority', payouts: { human: 300 } },
    showdown: {
      handId: 'hand-priority',
      winners: ['human'],
      handsByUserId: { 'bot-4': { category: 1 }, 'bot-2': { category: 1 }, human: { category: 4 } }
    },
    handSeats: [
      { userId: 'bot-4', seatNo: 4 },
      { userId: 'bot-2', seatNo: 2 },
      { userId: 'human', seatNo: 1 }
    ],
    foldedByUserId: {},
    leftTableByUserId: {},
    sitOutByUserId: {},
    riverChangedWinnerUserIds: []
  };

  const draws = [0.1, 0.05];
  const result = classifySettlementReaction({
    state: multiBotState,
    botSeats: [{ userId: 'bot-4', seatNo: 4 }, { userId: 'bot-2', seatNo: 2 }],
    random: () => draws.shift()
  });
  assert.equal(result.botUserId, 'bot-2');
  assert.equal(result.botSeatNo, 2);
  assert.equal(result.reactionKey, 'all_in_oh_no');

  assert.equal(classifySettlementReaction({
    state: multiBotState,
    botSeats: [{ userId: 'bot-2', seatNo: 2 }],
    reactionSettings: { enabled: false },
    random: () => 0.05
  }), null);
});
