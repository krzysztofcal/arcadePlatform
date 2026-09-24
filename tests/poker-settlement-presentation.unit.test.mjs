import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadHooks(){
  const source = fs.readFileSync(path.join(process.cwd(), 'poker', 'poker-v2.js'), 'utf8');
  const sandbox = {
    window: {
      __RUNNING_POKER_UI_TESTS__: true,
      location: { search: '' }
    },
    document: {
      readyState: 'loading',
      addEventListener(){},
      getElementById(){ return null; },
      querySelector(){ return null; }
    },
    URLSearchParams,
    Date,
    console
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'poker/poker-v2.js' });
  return sandbox.window.__POKER_V2_TEST_HOOKS__;
}

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function project(hooks, showdown, payouts, settledAt = '2026-07-14T12:00:00.000Z'){
  return plain(hooks.buildSettlementPresentation({
    showdown,
    handSettlement: { handId: showdown.handId, settledAt, payouts }
  }));
}

function celebrationInput(hooks, amount = 500){
  const showdown = { handId: 'h', reason: 'computed', winners: ['a'], potAwardedTotal: amount,
    potsAwarded: [{ amount, winners: ['a'], eligibleUserIds: ['a', 'b'] }] };
  return { handId: 'h', phase: 'SETTLED', buyIn: 100, showdown,
    handSettlement: { handId: 'h', payouts: { a: amount } },
    settlementPresentation: project(hooks, showdown, { a: amount }), communityCards: [], revealedShowdownCardsByUserId: {} };
}

test('celebrations prove a royal from legal cards, prioritize it and reject ordinary straight flushes', () => {
  const hooks = loadHooks();
  const input = celebrationInput(hooks, 500);
  input.communityCards = ['10', 'J', 'Q'].map(r => ({ r, s: 'S' }));
  input.revealedShowdownCardsByUserId.a = ['K', 'A'].map(r => ({ r, s: 'S' }));
  assert.deepEqual(plain(hooks.selectCelebrationForSettlement(input)), {
    kind: 'royal', userId: 'a', cards: ['10', 'J', 'Q', 'K', 'A'].map(r => ({ r, s: 'S' }))
  });
  input.revealedShowdownCardsByUserId.a = ['K', '9'].map(r => ({ r, s: 'S' }));
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'pot');
  input.buyIn = null;
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
  input.revealedShowdownCardsByUserId.a = [];
  input.heroCards = ['K', 'A'].map(r => ({ r, s: 'S' }));
  assert.equal(hooks.selectCelebrationForSettlement(input), null, 'never consult private cards');
  input.buyIn = 100;
  input.currentUserId = 'a';
  assert.deepEqual(plain(hooks.selectCelebrationForSettlement(input)), {
    kind: 'royal', userId: 'a', cards: ['10', 'J', 'Q', 'K', 'A'].map(r => ({ r, s: 'S' }))
  }, 'the viewer may use their own current-hand cards to prove the winning hand');
  input.currentUserId = 'spectator';
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'pot', 'a spectator still cannot inspect the winner private cards');
  input.communityCards = ['10', 'J', 'Q', 'K', 'A'].map(r => ({ r, s: 'H' }));
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'royal', 'board royal is public proof');
  input.showdown.reason = 'all_folded';
  input.showdown.potsAwarded[0].eligibleUserIds = ['a'];
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'royal', 'confirmed fold winner can prove a public board royal');
  input.handId = 'other';
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
});

test('live royal presentation never invents cards while preview may use an explicit demo hand', () => {
  const hooks = loadHooks();
  assert.equal(hooks.resolveCelebrationRoyalCards(undefined, false), null);
  assert.equal(hooks.resolveCelebrationRoyalCards(['10S', 'JS', 'QH', 'KS', 'AS'], false), null);
  assert.deepEqual(plain(hooks.resolveCelebrationRoyalCards(undefined, true)),
    ['10', 'J', 'Q', 'K', 'A'].map(r => ({ r, s: 'S' })));
});

test('monster pot uses each contested recipient award, excludes returns and fails closed', () => {
  const hooks = loadHooks();
  assert.equal(hooks.selectCelebrationForSettlement(celebrationInput(hooks, 499)), null);
  assert.deepEqual(plain(hooks.selectCelebrationForSettlement(celebrationInput(hooks, 500))), {
    kind: 'pot', userId: 'a', amount: 500
  });
  const input = celebrationInput(hooks);
  input.showdown.potAwardedTotal = 1000;
  input.showdown.potsAwarded = [{ amount: 600, winners: ['a', 'b'], eligibleUserIds: ['a', 'b'] }, { amount: 400, winners: ['a'], eligibleUserIds: ['a'] }];
  input.handSettlement.payouts = { a: 700, b: 300 };
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
  input.showdown.potsAwarded[1].eligibleUserIds = ['a', 'c'];
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.deepEqual(plain(hooks.selectCelebrationForSettlement(input)), {
    kind: 'pot', userId: 'a', amount: 700
  }, 'sum main and side awards for the same winner');
  input.settlementPresentation.valid = false;
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
});

test('Monster Pot accepts an awarded all-folded main pot and never counts an uncalled return', () => {
  const hooks = loadHooks();
  const input = celebrationInput(hooks, 500);
  input.showdown.reason = 'all_folded';
  input.showdown.potsAwarded = [{ amount: 500, winners: ['a'], eligibleUserIds: ['a'] }];
  input.handSettlement.payouts = { a: 500 };
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.deepEqual(plain(hooks.selectCelebrationForSettlement(input)), {
    kind: 'pot', userId: 'a', amount: 500
  });
  input.showdown.reason = 'computed';
  input.showdown.potsAwarded = [{ amount: 500, winners: ['a'], eligibleUserIds: ['a'] }];
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
});

test('celebrations prefer the local qualifying winner without overriding royal priority', () => {
  const hooks = loadHooks();
  const input = celebrationInput(hooks);
  input.currentUserId = 'b';
  input.showdown.winners = ['a', 'b'];
  input.showdown.potAwardedTotal = 1000;
  input.showdown.potsAwarded = [{ amount: 1000, winners: ['a', 'b'], eligibleUserIds: ['a', 'b'] }];
  input.handSettlement.payouts = { a: 500, b: 500 };
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input).userId, 'b', 'split contested awards qualify independently');
  input.communityCards = ['10', 'J', 'Q', 'K', 'A'].map(r => ({ r, s: 'S' }));
  assert.equal(hooks.selectCelebrationForSettlement(input).userId, 'b', 'shared board royal prefers viewer');
  input.communityCards = ['10', 'J', 'Q'].map(r => ({ r, s: 'S' }));
  input.revealedShowdownCardsByUserId.a = ['K', 'A'].map(r => ({ r, s: 'S' }));
  assert.deepEqual(plain(hooks.selectCelebrationForSettlement(input)).userId, 'a', 'opponent royal outranks local pot');
  input.revealedShowdownCardsByUserId = {};
  input.currentUserId = 'spectator';
  assert.equal(hooks.selectCelebrationForSettlement(input).userId, 'a', 'unknown viewer never becomes winner');
  input.currentUserId = 'b';
  input.showdown.potsAwarded = [{ amount: 1000, winners: ['a'], eligibleUserIds: ['a', 'b'] }];
  input.handSettlement.payouts = { a: 1000 };
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input).userId, 'a', 'viewer must actually qualify');
});

function streakSettlement(hooks, options){
  const handId = options.handId;
  const pots = options.pots || [{ amount: 100, winners: options.winners, eligibleUserIds: options.eligible }];
  const payouts = {};
  for (const pot of pots){
    const share = Math.floor(pot.amount / pot.winners.length);
    let remainder = pot.amount - share * pot.winners.length;
    for (const userId of pot.winners){
      payouts[userId] = (payouts[userId] || 0) + share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
  }
  const showdown = {
    handId,
    reason: options.reason || 'computed',
    winners: options.showdownWinners || options.winners || [],
    potAwardedTotal: pots.reduce((total, pot) => total + pot.amount, 0),
    potsAwarded: pots
  };
  return {
    tableId: options.tableId || 'table-a', currentUserId: 'viewer', currentSeatNo: options.currentSeatNo || 1,
    handId, version: options.version, phase: 'SETTLED', transition: true,
    sequenceIntact: options.sequenceIntact !== false,
    settlementPresentation: project(hooks, showdown, payouts),
    seats: options.seats || [],
    foldedByUserId: options.foldedByUserId || {}
  };
}

test('celebration lifetime completes in about two seconds regardless of the Winner deadline', () => {
  const { celebrationDuration, celebrationExitDuration } = loadHooks();
  const heroMs = celebrationDuration(1000, [1001]);
  assert.equal(heroMs, 1600);
  const exitMs = celebrationExitDuration();
  assert.equal(exitMs, 400);
  assert.equal(heroMs + exitMs, 2000);
});

test('local win streak counts distinct confirmed awards through ×5, ×6 and beyond', () => {
  const hooks = loadHooks();
  const cursor = hooks.newWinStreakCursor();
  for (let version = 1; version <= 4; version++){
    assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
      handId: 'hand-' + version, version, winners: ['a'], eligible: ['a', 'b']
    }))), []);
  }
  assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'hand-5', version: 5, winners: ['a'], eligible: ['a', 'b']
  }))), [{ userId: 'a', count: 5 }]);
  assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'hand-6', version: 6, winners: ['a'], eligible: ['a', 'b']
  }))), [{ userId: 'a', count: 6 }]);
  assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'hand-6', version: 7, winners: ['a'], eligible: ['a', 'b']
  }))), []);
  assert.equal(cursor.counts.a, 6, 'a repeated patch cannot increment or erase the count');
  assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, {
    ...streakSettlement(hooks, { handId: 'hand-7', version: 8, winners: ['a'], eligible: ['a', 'b'] }),
    transition: false
  })), []);
  assert.equal(cursor.counts.a, 6, 'a non-settlement patch leaves the confirmed streak intact');
});

test('split awards count for each winner while a sit-out is not treated as a loss', () => {
  const hooks = loadHooks();
  const cursor = hooks.newWinStreakCursor();
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'split', version: 1, winners: ['a', 'b'], eligible: ['a', 'b']
  }));
  assert.equal(cursor.counts.a, 1);
  assert.equal(cursor.counts.b, 1);
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'while-a-sits-out', version: 2, winners: ['b'], eligible: ['b', 'c'],
    seats: [{ userId: 'a', status: 'WAITING_NEXT_HAND' }]
  }));
  assert.equal(cursor.counts.a, 1, 'a receives no win and no loss while sitting out');
  assert.equal(cursor.counts.b, 2);
});

test('local streak resets on a known loss, a fold, an uncalled return and an uncertain hand', () => {
  const hooks = loadHooks();
  const cursor = hooks.newWinStreakCursor();
  for (let version = 1; version <= 3; version++){
    hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
      handId: 'win-' + version, version, winners: ['a'], eligible: ['a', 'b']
    }));
  }
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'loss', version: 4, winners: ['b'], eligible: ['a', 'b']
  }));
  assert.equal(cursor.counts.a || 0, 0);
  assert.equal(cursor.counts.b, 1);
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'win-before-fold', version: 5, winners: ['a'], eligible: ['a', 'b']
  }));
  assert.equal(cursor.counts.a, 1);
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'folded', version: 6, winners: ['b'], eligible: ['b'], reason: 'all_folded',
    foldedByUserId: { a: true }
  }));
  assert.equal(cursor.counts.a || 0, 0, 'a folded player is a known loser');
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'win-again', version: 7, winners: ['a'], eligible: ['a', 'b']
  }));
  assert.equal(cursor.counts.a, 1);
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'return', version: 8, winners: ['a'], eligible: ['a'],
    pots: [{ amount: 100, winners: ['a'], eligibleUserIds: ['a'] }]
  }));
  assert.equal(cursor.counts.a || 0, 0, 'uncalled returned chips are not a win');
  hooks.recordWinStreakSettlement(cursor, {
    ...streakSettlement(hooks, { handId: 'uncertain', version: 9, winners: ['a'], eligible: ['a', 'b'] }),
    settlementPresentation: { valid: false, handId: 'uncertain', pots: [] }
  });
  assert.equal(cursor.counts.b || 0, 0, 'an incomplete result clears pending streaks');
});

test('local streak restarts at one after reconnect or a broken hand sequence', () => {
  const hooks = loadHooks();
  const cursor = hooks.newWinStreakCursor();
  for (let version = 1; version <= 4; version++){
    hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
      handId: 'before-' + version, version, winners: ['a'], eligible: ['a', 'b']
    }));
  }
  hooks.resetWinStreakCursor(cursor);
  assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'after-reconnect', version: 1, winners: ['a'], eligible: ['a', 'b']
  }))), []);
  assert.equal(cursor.counts.a, 1);
  assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'missed-hand', version: 2, winners: ['a'], eligible: ['a', 'b'], sequenceIntact: false
  }))), []);
  assert.equal(cursor.counts.a, 1, 'a missed hand restarts at one instead of extending an old run');
});

test('local streak resets when the table or current seat identity changes', () => {
  const hooks = loadHooks();
  const cursor = hooks.newWinStreakCursor();
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'before-seat-change', version: 1, winners: ['a'], eligible: ['a', 'b']
  }));
  assert.equal(cursor.counts.a, 1);
  assert.deepEqual(plain(hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'after-seat-change', version: 2, currentSeatNo: 2, winners: ['a'], eligible: ['a', 'b']
  }))), []);
  assert.equal(cursor.counts.a, undefined);
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'after-table-change', version: 3, currentSeatNo: 2, tableId: 'table-b', winners: ['a'], eligible: ['a', 'b']
  }));
  assert.equal(cursor.counts.a, undefined);
  hooks.recordWinStreakSettlement(cursor, streakSettlement(hooks, {
    handId: 'new-session', version: 4, currentSeatNo: 2, tableId: 'table-b', winners: ['a'], eligible: ['a', 'b']
  }));
  assert.equal(cursor.counts.a, 1);
});

test('celebration cursor consumes initial, duplicate, stale and recovery settlements without replay', () => {
  const { claimCelebrationTransition: claim } = loadHooks();
  const cursor = { tableId: null, handId: null, version: -1, consumed: false };
  const input = { tableId: 't', handId: 'h', phase: 'RIVER' };
  assert.equal(claim(cursor, input, { initial: true }, 1, false), false);
  input.phase = 'SETTLED';
  assert.equal(claim(cursor, input, {}, 2, true), true);
  assert.equal(claim(cursor, input, {}, 2, true), false);
  assert.equal(claim(cursor, input, {}, 3, true), false);
  input.handId = 'older';
  assert.equal(claim(cursor, input, {}, 1, true), false);
  input.handId = 'new';
  assert.equal(claim(cursor, input, { initial: true }, 4, false), false);
  assert.equal(claim(cursor, input, {}, 5, true), false);
  input.handId = 'recovery'; input.phase = 'RIVER';
  claim(cursor, input, {}, 6, false);
  input.phase = 'SETTLED';
  assert.equal(claim(cursor, input, { suppressSettlementAnimation: true }, 7, true), false);
  assert.equal(claim(cursor, input, {}, 8, true), false);
});

test('projects ordered main, side, and returned awards with exact per-seat amounts', () => {
  const hooks = loadHooks();
  const presentation = project(hooks, {
    handId: 'hand-1',
    reason: 'computed',
    potAwardedTotal: 345,
    potsAwarded: [
      { amount: 300, winners: ['a'], eligibleUserIds: ['a', 'b', 'c'] },
      { amount: 40, winners: ['b'], eligibleUserIds: ['b', 'c'] },
      { amount: 5, winners: ['c'], eligibleUserIds: ['c'] }
    ]
  }, { a: 300, b: 40, c: 5 });

  assert.equal(presentation.valid, true);
  assert.deepEqual(presentation.pots.map((pot) => [pot.kind, pot.sidePotNumber, pot.amount]), [
    ['main', null, 300],
    ['side', 1, 40],
    ['return', null, 5]
  ]);
  assert.deepEqual(presentation.byUserId.a.map((award) => award.amount), [300]);
  assert.deepEqual(presentation.byUserId.b.map((award) => award.amount), [40]);
  assert.deepEqual(presentation.byUserId.c.map((award) => award.amount), [5]);
});

test('uses server winner order for split-pot floor shares and remainder chips', () => {
  const hooks = loadHooks();
  const presentation = project(hooks, {
    handId: 'hand-split',
    reason: 'computed',
    potAwardedTotal: 5,
    potsAwarded: [{ amount: 5, winners: ['b', 'a'], eligibleUserIds: ['a', 'b'] }]
  }, { b: 3, a: 2 });

  assert.equal(presentation.valid, true);
  assert.deepEqual(presentation.pots[0].recipients, [
    { userId: 'b', amount: 3 },
    { userId: 'a', amount: 2 }
  ]);
});

test('classifies all-folded singleton award as main pot instead of return', () => {
  const hooks = loadHooks();
  const presentation = project(hooks, {
    handId: 'hand-fold',
    reason: 'all_folded',
    potAwardedTotal: 12,
    potsAwarded: [{ amount: 12, winners: ['a'], eligibleUserIds: ['a'] }]
  }, { a: 12 });

  assert.equal(presentation.valid, true);
  assert.equal(presentation.pots[0].kind, 'main');
});

test('fails closed for malformed identities, amounts, totals, payouts, and return shapes', () => {
  const hooks = loadHooks();
  const base = {
    handId: 'hand-invalid',
    reason: 'computed',
    potAwardedTotal: 10,
    potsAwarded: [{ amount: 10, winners: ['a'], eligibleUserIds: ['a', 'b'] }]
  };
  const cases = [
    [{ ...base, potsAwarded: [{ amount: -1, winners: ['a'], eligibleUserIds: ['a', 'b'] }] }, { a: 10 }],
    [{ ...base, potsAwarded: [{ amount: Number.NaN, winners: ['a'], eligibleUserIds: ['a', 'b'] }] }, { a: 10 }],
    [{ ...base, potsAwarded: [{ amount: '10', winners: ['a'], eligibleUserIds: ['a', 'b'] }] }, { a: 10 }],
    [{ ...base, potsAwarded: [{ amount: Number.MAX_SAFE_INTEGER + 1, winners: ['a'], eligibleUserIds: ['a', 'b'] }] }, { a: 10 }],
    [{ ...base, potsAwarded: [{ amount: 10, winners: ['a', 'a'], eligibleUserIds: ['a', 'b'] }] }, { a: 10 }],
    [{ ...base, potsAwarded: [{ amount: 10, winners: ['c'], eligibleUserIds: ['a', 'b'] }] }, { c: 10 }],
    [{ ...base, potAwardedTotal: 11 }, { a: 10 }],
    [base, { a: 9 }],
    [{ ...base, potsAwarded: [base.potsAwarded[0], { amount: 1, winners: ['b'], eligibleUserIds: ['a'] }], potAwardedTotal: 11 }, { a: 10, b: 1 }]
  ];

  cases.forEach(([showdown, payouts]) => assert.equal(project(hooks, showdown, payouts).valid, false));
  const mismatch = plain(hooks.buildSettlementPresentation({
    showdown: base,
    handSettlement: { handId: 'different-hand', settledAt: null, payouts: { a: 10 } }
  }));
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.failureReason, 'hand_id_mismatch');
});
