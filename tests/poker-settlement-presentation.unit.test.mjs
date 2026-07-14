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
