import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function makeElement(id){
  const style = {
    setProperty(name, value){ this[name] = String(value); },
    getPropertyValue(name){ return this[name] || ''; },
    removeProperty(name){ delete this[name]; }
  };
  const element = {
    id,
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    className: '',
    dataset: {},
    style: style,
    children: [],
    parentNode: null,
    attributes: {},
    classList: {
      add(){},
      remove(){},
      contains(){ return false; }
    },
    _listeners: {},
    appendChild(child){ child.parentNode = this; this.children.push(child); return child; },
    removeChild(child){ this.children = this.children.filter((it) => it !== child); },
    contains(target){
      if (target === this) return true;
      return this.children.includes(target);
    },
    addEventListener(type, fn){ this._listeners[type] = this._listeners[type] || []; this._listeners[type].push(fn); },
    setAttribute(name, value){ this.attributes[name] = String(value); },
    removeAttribute(name){ delete this.attributes[name]; },
    hasAttribute(name){ return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    click(){
      const handlers = this._listeners.click || [];
      handlers.forEach((fn) => fn({ preventDefault(){}, stopPropagation(){} }));
    }
  };
  let innerHTML = '';
  Object.defineProperty(element, 'innerHTML', {
    get(){ return innerHTML; },
    set(value){
      innerHTML = String(value == null ? '' : value);
      if (innerHTML === '') this.children = [];
    }
  });
  return element;
}

function createHarness(options = {}){
  const source = fs.readFileSync(path.join(process.cwd(), 'poker', 'poker-v2.js'), 'utf8');
  const elements = {};
  [
    'pokerMenuToggle', 'pokerMenuPanel', 'pokerClassicLink', 'pokerV2Link',
    'pokerSeatLayer', 'pokerPotPill', 'pokerCommunityCards', 'pokerDealerChip',
    'pokerHeroCards', 'pokerV2LiveStatus', 'pokerV2TableMeta', 'pokerV2TurnText',
    'pokerV2StackText', 'pokerV2ErrorText', 'pokerV2SignInBtn', 'pokerV2SeatNo',
    'pokerV2BuyIn', 'pokerV2JoinBtn', 'pokerV2StartBtn', 'pokerV2LeaveBtn',
    'pokerV2DemoPill', 'pokerV2FoldBtn', 'pokerV2PrimaryBtn', 'pokerV2AmountBtn',
    'pokerV2AllInBtn', 'pokerV2AmountInput', 'pokerV2AmountInputWrap', 'pokerV2AmountValue',
    'pokerTableScreen', 'pokerBootSplash'
  ].forEach((id) => {
    elements[id] = makeElement(id);
  });
  elements.pokerV2SeatNo.value = '1';
  elements.pokerV2BuyIn.value = '100';
  elements.pokerV2AmountInput.value = '20';
  elements.pokerMenuPanel.setAttribute('hidden', 'hidden');

  const documentEvents = {};
  const logs = [];
  const joinPayloads = [];
  const actPayloads = [];
  const startPayloads = [];
  const leavePayloads = [];
  let createOptions = null;

  const token = Object.prototype.hasOwnProperty.call(options, 'token')
    ? options.token
    : ('aaa.' + Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64') + '.zzz');
  const wsClient = {
    _ready: false,
    start(){
      Promise.resolve().then(() => {
        if (createOptions && typeof createOptions.onStatus === 'function'){
          this._ready = true;
          createOptions.onStatus('auth_ok', { roomId: 'table-1' });
        }
      });
    },
    destroy(){ this._ready = false; },
    isReady(){ return this._ready; },
    sendJoin(payload){ joinPayloads.push(payload); return Promise.resolve({ ok: true, seatNo: payload.seatNo || 1 }); },
    sendAct(payload){ actPayloads.push(payload); return Promise.resolve({ ok: true }); },
    sendStartHand(payload){ startPayloads.push(payload); return Promise.resolve({ ok: true }); },
    sendLeave(payload){ leavePayloads.push(payload); return Promise.resolve({ ok: true }); }
  };

  const intervalTimers = [];
  const sandbox = {
    window: {
      location: {
        search: typeof options.search === 'string' ? options.search : '?tableId=table-1',
        href: ''
      },
      KLog: { log(kind, data){ logs.push({ kind, data }); } },
      SupabaseAuthBridge: {
        getAccessToken: async () => token
      },
      PokerWsClient: {
        create(opts){
          createOptions = opts;
          return wsClient;
        }
      },
      setInterval(fn){
        intervalTimers.push(fn);
        return intervalTimers.length;
      },
      clearInterval(){},
      clearTimeout(){},
      setTimeout(fn){ fn(); return 1; }
    },
    document: {
      readyState: 'loading',
      addEventListener(type, fn){ documentEvents[type] = documentEvents[type] || []; documentEvents[type].push(fn); },
      getElementById(id){ return elements[id] || null; },
      createElement(tag){ return makeElement(tag); }
    },
    URLSearchParams,
    atob(value){ return Buffer.from(String(value), 'base64').toString('binary'); },
    Buffer,
    console
  };
  sandbox.window.document = sandbox.document;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'poker/poker-v2.js' });

async function flush(){
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function fireDomContentLoaded(){
    const handlers = documentEvents.DOMContentLoaded || [];
    handlers.forEach((fn) => fn());
  }

  function fireDocumentEvent(type, event){
    const handlers = documentEvents[type] || [];
    handlers.forEach((fn) => fn(event || {}));
  }

  return {
    elements,
    logs,
    joinPayloads,
    actPayloads,
    startPayloads,
    leavePayloads,
    fireDomContentLoaded,
    fireDocumentEvent,
    flush,
    getCreateOptions(){ return createOptions; },
    getIntervalCount(){ return intervalTimers.length; }
  };
}

async function waitFor(predicate, attempts = 6){
  for (let i = 0; i < attempts; i += 1){
    if (predicate()) return;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function findSeatByLabel(harness, label){
  return harness.elements.pokerSeatLayer.children.find((node) => (
    node.children || []
  ).some((child) => child.className === 'poker-seat-name' && child.textContent === label));
}

function findSeatChild(seatNode, className){
  return (seatNode.children || []).find((child) => child.className === className);
}

test('poker v2 boots live mode, preserves table links, and sends WS commands', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  assert.ok(ws, 'v2 should bootstrap a WS client when tableId is present');
  await waitFor(() => harness.elements.pokerV2JoinBtn.disabled === false);
  assert.equal(harness.elements.pokerV2JoinBtn.textContent, 'Join', 'v2 should not mark the user as seated before a live snapshot confirms it');
  assert.equal(harness.elements.pokerV2StartBtn.hidden, true, 'start hand should stay hidden until a live seat is confirmed');
  assert.equal(harness.elements.pokerV2StackText.textContent, '—', 'v2 should not show demo stack data before a live snapshot');
  assert.equal(harness.elements.pokerV2AmountInputWrap.hidden, false, 'amount rail should stay rendered even when betting is unavailable');
  assert.equal(harness.elements.pokerV2AmountInput.disabled, true, 'amount rail should disable when bet/raise is unavailable');

  harness.elements.pokerV2SeatNo.value = '3';
  harness.elements.pokerV2BuyIn.value = '240';
  harness.elements.pokerV2JoinBtn.click();
  await harness.flush();

  assert.equal(harness.joinPayloads.length, 1);
  assert.equal(JSON.stringify(harness.joinPayloads[0]), JSON.stringify({ tableId: 'table-1', buyIn: 240, seatNo: 3 }));
  assert.equal(harness.elements.pokerTableScreen.attributes['data-boot-ready'], '1');
  assert.equal(harness.elements.pokerBootSplash.hidden, true);

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        hand: { handId: 'hand-1', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        board: ['As', 'Kd', '3h', '2c'],
        pot: { total: 42, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CHECK', 'BET'] },
        actionConstraints: { toCall: 0, maxBetAmount: 120 }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerClassicLink.href, '/poker/table.html?tableId=table-1');
  assert.equal(harness.elements.pokerV2Link.href, '/poker/table-v2.html?tableId=table-1');
  assert.equal(harness.elements.pokerSeatLayer.children.length, 6, 'v2 should render all seats for the table');
  assert.equal(harness.elements.pokerCommunityCards.children.length, 4, 'v2 should render live board cards');
  assert.equal(harness.elements.pokerHeroCards.children.length, 2, 'v2 should render live hole cards');
  assert.equal(harness.elements.pokerPotPill.textContent, 'Pot 42');
  assert.equal(harness.elements.pokerV2PrimaryBtn.hidden, false, 'v2 should surface the primary turn action');
  assert.equal(harness.elements.pokerV2PrimaryBtn.textContent, 'Check', 'v2 should keep check compact when there is nothing to call');
  assert.equal(harness.elements.pokerV2AmountBtn.hidden, false, 'v2 should surface bet/raise when legal');
  assert.equal(harness.elements.pokerV2JoinBtn.disabled, true, 'join should stay disabled once the user is seated');
  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  assert.ok(heroSeat, 'v2 should render a dedicated hero seat');
  assert.equal(heroSeat.style.left, '34%', 'hero seat should be shifted left to avoid the action rail');
  assert.equal(heroSeat.style.top, '91%', 'hero seat should stay near the bottom edge');
  const seatCards = heroSeat.children.find((node) => node.className === 'poker-seat-cards');
  assert.equal(seatCards, undefined, 'hero seat should not duplicate the bottom hole cards');
  const heroStatus = heroSeat.children.find((node) => node.className === 'poker-seat-status');
  assert.equal(heroStatus, undefined, 'hero seat should not repeat the active status pill');
  const bestHand = heroSeat.children.find((node) => node.className === 'poker-seat-best-hand');
  assert.ok(bestHand, 'hero seat should surface a best-hand summary');
  assert.equal(harness.elements.pokerDealerChip.hidden, false, 'dealer chip should be visible when the dealer seat is known');
  assert.equal(harness.elements.pokerDealerChip.style.left, '24%');
  assert.equal(harness.elements.pokerDealerChip.style.top, '74%');

  harness.elements.pokerV2AmountInput.value = '77';
  harness.elements.pokerV2AmountBtn.click();
  await harness.flush();

  assert.equal(harness.actPayloads.length, 1);
  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-1', action: 'BET', amount: 77 }));

  harness.elements.pokerV2StartBtn.click();
  harness.elements.pokerV2LeaveBtn.click();
  await harness.flush();

  assert.equal(harness.startPayloads.length, 1);
  assert.equal(JSON.stringify(harness.startPayloads[0]), JSON.stringify({ tableId: 'table-1' }));
  assert.equal(harness.leavePayloads.length, 1);
  assert.equal(JSON.stringify(harness.leavePayloads[0]), JSON.stringify({ tableId: 'table-1' }));
});

test('poker v2 shows compact call amount in the primary action label', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 3,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        hand: { handId: 'hand-2', status: 'TURN', dealerSeatNo: 4 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 48, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL', 'RAISE'] },
        actionConstraints: { toCall: 1260, minRaiseTo: 2400, maxRaiseTo: 9000 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerV2PrimaryBtn.textContent, 'Call (1k)');
  assert.equal(harness.elements.pokerV2AmountValue.textContent, '2k');
});

test('poker v2 auto-joins from query params after live auth', async () => {
  const harness = createHarness({ search: '?tableId=table-1&seatNo=4&autoJoin=1' });
  harness.fireDomContentLoaded();
  await harness.flush();
  await waitFor(() => harness.joinPayloads.length === 1);

  assert.equal(JSON.stringify(harness.joinPayloads[0]), JSON.stringify({ tableId: 'table-1', buyIn: 100, seatNo: 4 }));
});

test('poker v2 aligns the right rail seats and keeps the chip on the dealer seat', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 4,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'villain-1', seat: 1, displayName: 'Villain 1' },
          { userId: 'villain-2', seat: 2, displayName: 'Villain 2' },
          { userId: 'villain-3', seat: 3, displayName: 'Villain 3' },
          { userId: 'user-1', seat: 4, displayName: 'Hero' }
        ]
      },
      public: {
        hand: { handId: 'hand-3', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-2', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] }
      },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  const rightTopSeat = findSeatByLabel(harness, 'Villain 2');
  const rightBottomSeat = findSeatByLabel(harness, 'Villain 3');
  assert.ok(rightTopSeat);
  assert.ok(rightBottomSeat);
  assert.equal(rightTopSeat.style.left, '80%');
  assert.equal(rightBottomSeat.style.left, '80%');
  assert.equal(harness.elements.pokerDealerChip.style.left, '72%');
  assert.equal(harness.elements.pokerDealerChip.style.top, '37%');
});

test('poker v2 shows a live turn clock only on the active seat avatar', async () => {
  const nowMs = Date.now();
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 5,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        hand: { handId: 'hand-4', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', startedAt: nowMs - 10_000, deadlineAt: nowMs + 10_000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 1, actions: [] }
      },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const activeSeat = findSeatByLabel(harness, 'Villain 1');
  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  const activeAvatar = activeSeat.children.find((node) => node.className === 'poker-seat-avatar');
  const heroAvatar = heroSeat.children.find((node) => node.className === 'poker-seat-avatar');
  const activeClock = activeAvatar.children.find((node) => /poker-seat-turn-clock/.test(node.className));
  const heroClock = heroAvatar.children.find((node) => /poker-seat-turn-clock/.test(node.className));

  assert.ok(activeClock, 'active seat should show a turn clock overlay');
  assert.equal(Math.abs(Number(activeClock.style['--turn-progress']) - 0.5) < 0.02, true);
  assert.equal(heroClock, undefined, 'inactive seats should not show the turn clock overlay');
});

test('poker v2 turns the live clock red when five seconds remain', async () => {
  const nowMs = Date.now();
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 6,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [{ userId: 'user-1', seat: 1, displayName: 'Hero' }]
      },
      public: {
        hand: { handId: 'hand-5', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'user-1', startedAt: nowMs - 15_500, deadlineAt: nowMs + 4_500 },
        pot: { total: 4, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CHECK'] }
      },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  const heroAvatar = heroSeat.children.find((node) => node.className === 'poker-seat-avatar');
  const heroClock = heroAvatar.children.find((node) => /poker-seat-turn-clock/.test(node.className));

  assert.ok(heroClock);
  assert.match(heroClock.className, /poker-seat-turn-clock--warning/);
});

test('poker v2 keeps the dealer chip fixed while action moves between players', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 5,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' },
          { userId: 'villain-2', seat: 3, displayName: 'Villain 2' }
        ]
      },
      public: {
        hand: { handId: 'hand-4', status: 'PREFLOP', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 3, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] },
        actionConstraints: { toCall: 1 }
      },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const initialLeft = harness.elements.pokerDealerChip.style.left;
  const initialTop = harness.elements.pokerDealerChip.style.top;

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 6,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' },
          { userId: 'villain-2', seat: 3, displayName: 'Villain 2' }
        ]
      },
      public: {
        hand: { handId: 'hand-4', status: 'PREFLOP', dealerSeatNo: 2 },
        turn: { userId: 'villain-2', deadlineAt: Date.now() + 5000 },
        pot: { total: 3, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        actionConstraints: { toCall: 0 }
      },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerDealerChip.style.left, initialLeft);
  assert.equal(harness.elements.pokerDealerChip.style.top, initialTop);
});

test('poker v2 shows winner badges and reveals showdown winner cards during settled state', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 7,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' },
          { userId: 'villain-2', seat: 3, displayName: 'Villain 2' }
        ]
      },
      public: {
        hand: { handId: 'hand-6', status: 'SETTLED', dealerSeatNo: 2 },
        turn: { userId: null, seat: null, startedAt: null, deadlineAt: null },
        board: { cards: ['2H', '3H', '4H', '9C', 'KD'] },
        pot: { total: 0, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        showdown: {
          handId: 'hand-6',
          winners: ['villain-1', 'user-1'],
          reason: 'computed',
          revealedWinners: [
            { userId: 'villain-1', holeCards: ['AS', 'AD'] },
            { userId: 'user-1', holeCards: ['KH', 'KD'] }
          ]
        },
        handSettlement: {
          handId: 'hand-6',
          settledAt: '2026-04-11T10:00:00.000Z'
        }
      },
      private: { holeCards: [{ r: 'K', s: 'H' }, { r: 'K', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const villainSeat = findSeatByLabel(harness, 'Villain 1');
  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  const villainBadge = findSeatChild(villainSeat, 'poker-seat-winner-badge');
  const heroBadge = findSeatChild(heroSeat, 'poker-seat-winner-badge');
  const villainCards = findSeatChild(villainSeat, 'poker-seat-cards');
  const villainBadgeLabel = findSeatChild(villainBadge, 'poker-seat-winner-label');
  const villainBadgeCards = findSeatChild(villainBadge, 'poker-seat-winner-cards');

  assert.ok(villainBadge);
  assert.equal(findSeatChild(villainBadge, 'poker-seat-winner-title').textContent, 'Winner');
  assert.ok(heroBadge);
  assert.ok(villainBadgeLabel);
  assert.equal(villainBadgeLabel.textContent.length > 0, true);
  assert.equal(villainBadgeCards.children.length, 5);
  assert.equal(villainCards.children.length, 2);
  assert.equal(villainCards.children[0].className.includes('poker-card--back'), false);
  assert.equal(villainCards.children[1].className.includes('poker-card--back'), false);
});

test('poker v2 clears the previous reveal immediately when the next hand starts', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 9,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        hand: { handId: 'hand-8', status: 'SETTLED', dealerSeatNo: 2 },
        turn: { userId: null, seat: null, startedAt: null, deadlineAt: null },
        board: { cards: ['2H', '3H', '4H', '9C', 'KD'] },
        pot: { total: 0, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        showdown: {
          handId: 'hand-8',
          winners: ['villain-1'],
          reason: 'computed',
          revealedWinners: [
            { userId: 'villain-1', holeCards: ['AS', 'AD'] }
          ]
        },
        handSettlement: {
          handId: 'hand-8',
          settledAt: '2026-04-11T10:00:00.000Z'
        }
      },
      private: { holeCards: [{ r: 'K', s: 'H' }, { r: 'K', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 10,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        hand: { handId: 'hand-9', status: 'PREFLOP', dealerSeatNo: 1 },
        turn: { userId: 'user-1', seat: 1, startedAt: Date.now(), deadlineAt: Date.now() + 20_000 },
        pot: { total: 3, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] },
        actionConstraints: { toCall: 1 }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'J', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const villainSeat = findSeatByLabel(harness, 'Villain 1');
  assert.equal(findSeatChild(villainSeat, 'poker-seat-winner-badge'), undefined);
  const villainCards = findSeatChild(villainSeat, 'poker-seat-cards');
  assert.ok(villainCards);
  assert.equal(villainCards.children.length, 2);
  assert.equal(villainCards.children[0].className.includes('poker-card--back'), true);
  assert.equal(villainCards.children[1].className.includes('poker-card--back'), true);
  assert.equal(harness.elements.pokerCommunityCards.children.length, 0);
  assert.equal(harness.elements.pokerHeroCards.children.length, 2);
});

test('poker v2 does not compute hero best hand from sticky winner reveal board after the next hand starts', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 11,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        hand: { handId: 'hand-10', status: 'SETTLED', dealerSeatNo: 2 },
        turn: { userId: null, seat: null, startedAt: null, deadlineAt: null },
        board: { cards: ['2H', '3H', '4H', '9C', 'KD'] },
        pot: { total: 0, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        showdown: {
          handId: 'hand-10',
          winners: ['villain-1'],
          reason: 'computed',
          revealedWinners: [
            { userId: 'villain-1', holeCards: ['AS', 'AD'] }
          ]
        },
        handSettlement: {
          handId: 'hand-10',
          settledAt: '2026-04-11T10:00:00.000Z'
        }
      },
      private: { holeCards: [{ r: 'K', s: 'H' }, { r: 'K', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 12,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        hand: { handId: 'hand-11', status: 'PREFLOP', dealerSeatNo: 1 },
        turn: { userId: 'user-1', seat: 1, startedAt: Date.now(), deadlineAt: Date.now() + 20_000 },
        pot: { total: 3, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] },
        actionConstraints: { toCall: 1 }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'J', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  const bestHand = findSeatChild(heroSeat, 'poker-seat-best-hand');

  assert.equal(harness.elements.pokerCommunityCards.children.length, 0, 'new hand should clear the previous board immediately');
  assert.equal(bestHand, undefined, 'hero best hand should not use sticky reveal board from the previous hand');
});

test('poker v2 keeps winner cards hidden when the hand ends without showdown comparison', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 8,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        hand: { handId: 'hand-7', status: 'SETTLED', dealerSeatNo: 1 },
        turn: { userId: null, seat: null, startedAt: null, deadlineAt: null },
        pot: { total: 0, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        showdown: {
          handId: 'hand-7',
          winners: ['villain-1'],
          reason: 'all_folded'
        },
        handSettlement: {
          handId: 'hand-7',
          settledAt: '2026-04-11T10:00:01.000Z'
        }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'J', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const villainSeat = findSeatByLabel(harness, 'Villain 1');
  const villainBadge = findSeatChild(villainSeat, 'poker-seat-winner-badge');
  const villainCards = findSeatChild(villainSeat, 'poker-seat-cards');

  assert.ok(villainBadge);
  assert.equal(findSeatChild(villainBadge, 'poker-seat-winner-title').textContent, 'Winner');
  assert.equal(findSeatChild(villainBadge, 'poker-seat-winner-label'), undefined);
  assert.equal(findSeatChild(villainBadge, 'poker-seat-winner-cards'), undefined);
  assert.equal(villainCards.children[0].className, 'poker-card poker-card--back');
  assert.equal(villainCards.children[1].className, 'poker-card poker-card--back');
});

test('poker v2 falls back to demo mode when tableId is missing', async () => {
  const harness = createHarness({ search: '' });
  harness.fireDomContentLoaded();
  await harness.flush();

  assert.equal(harness.getCreateOptions(), null, 'demo mode should not bootstrap WS');
  assert.equal(harness.elements.pokerV2DemoPill.hidden, false);
  assert.equal(harness.elements.pokerSeatLayer.children.length, 6);
  assert.match(harness.elements.pokerV2LiveStatus.textContent, /Demo mode/);
});

test('poker v2 closes menu on link click and outside click', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerMenuToggle.click();
  assert.equal(harness.elements.pokerMenuToggle.attributes['aria-expanded'], 'true');
  assert.equal(harness.elements.pokerMenuPanel.hasAttribute('hidden'), false);

  harness.elements.pokerClassicLink.click();
  assert.equal(harness.elements.pokerMenuToggle.attributes['aria-expanded'], 'false');
  assert.equal(harness.elements.pokerMenuPanel.hasAttribute('hidden'), true);

  harness.elements.pokerMenuToggle.click();
  harness.fireDocumentEvent('click', { target: makeElement('outside') });
  assert.equal(harness.elements.pokerMenuPanel.hasAttribute('hidden'), true);
});

test('poker v2 waits for auth before enabling join and starts auth watch when signed out', async () => {
  const harness = createHarness({ token: null });
  harness.fireDomContentLoaded();
  await harness.flush();

  assert.equal(harness.getCreateOptions(), null, 'signed-out bootstrap should not start ws immediately');
  assert.match(harness.elements.pokerV2LiveStatus.textContent, /Sign in to join this table/);
  assert.equal(harness.elements.pokerV2JoinBtn.hidden, false);
  assert.equal(harness.elements.pokerV2JoinBtn.disabled, true);
  assert.equal(harness.getIntervalCount(), 1, 'signed-out mode should start auth polling for later login');
});
