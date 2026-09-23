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
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'royal');
  input.revealedShowdownCardsByUserId.a = ['K', '9'].map(r => ({ r, s: 'S' }));
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'pot');
  input.buyIn = null;
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
  input.revealedShowdownCardsByUserId.a = [];
  input.heroCards = ['K', 'A'].map(r => ({ r, s: 'S' }));
  assert.equal(hooks.selectCelebrationForSettlement(input), null, 'never consult private cards');
  input.communityCards = ['10', 'J', 'Q', 'K', 'A'].map(r => ({ r, s: 'H' }));
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'royal', 'board royal is public proof');
  input.showdown.reason = 'all_folded';
  input.showdown.potsAwarded[0].eligibleUserIds = ['a'];
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input).kind, 'royal', 'confirmed fold winner can prove a public board royal');
  input.handId = 'other';
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
});

test('monster pot uses each contested recipient award, excludes returns and fails closed', () => {
  const hooks = loadHooks();
  assert.equal(hooks.selectCelebrationForSettlement(celebrationInput(hooks, 499)), null);
  assert.equal(hooks.selectCelebrationForSettlement(celebrationInput(hooks, 500)).kind, 'pot');
  const input = celebrationInput(hooks);
  input.showdown.potAwardedTotal = 1000;
  input.showdown.potsAwarded = [{ amount: 600, winners: ['a', 'b'], eligibleUserIds: ['a', 'b'] }, { amount: 400, winners: ['a'], eligibleUserIds: ['a'] }];
  input.handSettlement.payouts = { a: 700, b: 300 };
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
  input.showdown.potsAwarded[1].eligibleUserIds = ['a', 'c'];
  input.settlementPresentation = project(hooks, input.showdown, input.handSettlement.payouts);
  assert.equal(hooks.selectCelebrationForSettlement(input).userId, 'a', 'sum main and side for one winner');
  input.settlementPresentation.valid = false;
  assert.equal(hooks.selectCelebrationForSettlement(input), null);
});

test('celebration deadline uses earliest existing deadline and skips insufficient windows', () => {
  const { celebrationDuration } = loadHooks();
  assert.equal(celebrationDuration(1000, [4500, 3400, null]), 1800);
  assert.equal(celebrationDuration(1000, [4500, 3199]), 0);
  assert.equal(celebrationDuration(1000, [900]), 0);
  assert.equal(celebrationDuration(1000, []), 0);
  assert.equal(celebrationDuration(1000, [3200]), 1800);
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
