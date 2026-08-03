import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const pokerV2Css = fs.readFileSync(path.join(process.cwd(), 'poker', 'poker-v2.css'), 'utf8');

test('poker v2 CSS respects the hidden state of the guest account badge', () => {
  assert.match(pokerV2Css, /\.poker-live-pill\[hidden\]\s*\{\s*display\s*:\s*none\s*;?\s*\}/);
});

function makeElement(id){
  const sceneRect = { left: 0, top: 0, width: 320, height: 640, right: 320, bottom: 640 };
  const style = {
    setProperty(name, value){ this[name] = String(value); },
    getPropertyValue(name){ return this[name] || ''; },
    removeProperty(name){ delete this[name]; }
  };
  function hasClass(node, className){
    return String(node && node.className || '').split(/\s+/).includes(className);
  }
  function parsePercent(value, fallback){
    const parsed = Number.parseFloat(String(value || ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const element = {
    id,
    hidden: false,
    disabled: false,
    checked: false,
    textContent: '',
    value: '',
    type: '',
    className: '',
    dataset: {},
    style: style,
    children: [],
    parentNode: null,
    attributes: {},
    _listeners: {},
    appendChild(child){ child.parentNode = this; this.children.push(child); return child; },
    removeChild(child){ this.children = this.children.filter((it) => it !== child); },
    contains(target){
      if (target === this) return true;
      return this.children.includes(target);
    },
    addEventListener(type, fn){ this._listeners[type] = this._listeners[type] || []; this._listeners[type].push(fn); },
    getBoundingClientRect(){
      if (this._rect) return this._rect;
      if (hasClass(this, 'poker-seat-avatar') && this.parentNode){
        const seat = this.parentNode;
        const size = hasClass(seat, 'poker-seat--hero') ? 96 : 76;
        const centerX = sceneRect.width * parsePercent(seat.style.left, 50) / 100;
        const centerY = sceneRect.height * parsePercent(seat.style.top, 50) / 100;
        return {
          left: centerX - size / 2,
          top: centerY - size / 2,
          width: size,
          height: size,
          right: centerX + size / 2,
          bottom: centerY + size / 2
        };
      }
      return sceneRect;
    },
    setAttribute(name, value){ this.attributes[name] = String(value); },
    removeAttribute(name){ delete this.attributes[name]; },
    hasAttribute(name){ return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    click(){
      if (this.disabled) return;
      if (this.type === 'checkbox') this.checked = !this.checked;
      const handlers = this._listeners.click || [];
      handlers.forEach((fn) => fn({ preventDefault(){}, stopPropagation(){}, target: this }));
      if (this.type === 'checkbox') {
        const changeHandlers = this._listeners.change || [];
        changeHandlers.forEach((fn) => fn({ preventDefault(){}, stopPropagation(){}, target: this }));
      }
    }
  };
  element.classList = {
    add(...classNames){
      const current = String(element.className || '').split(/\s+/).filter(Boolean);
      classNames.forEach((className) => {
        if (className && !current.includes(className)) current.push(className);
      });
      element.className = current.join(' ');
    },
    remove(...classNames){
      const removeSet = new Set(classNames.filter(Boolean));
      element.className = String(element.className || '').split(/\s+/).filter((className) => className && !removeSet.has(className)).join(' ');
    },
    contains(className){
      return String(element.className || '').split(/\s+/).includes(className);
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
    'xpBadge',
    'pokerMenuToggle', 'pokerMenuPanel', 'pokerLobbyLink',
    'pokerSeatLayer', 'pokerSeatChipLayer', 'pokerChipFxLayer', 'pokerPotPill', 'pokerPotChipStack', 'pokerCommunityCards', 'pokerDealerChip',
    'pokerHeroCards', 'pokerV2LiveStatus', 'pokerV2TableMeta', 'pokerV2TurnText',
    'pokerV2StackText', 'pokerV2ErrorText', 'pokerV2GuestPanel', 'pokerV2GuestBadge', 'pokerV2SignInBtn', 'pokerV2SeatNo',
    'pokerV2BuyIn', 'pokerV2JoinBtn', 'pokerV2StartBtn', 'pokerV2LeaveBtn', 'pokerV2LeaveConfirmModal', 'pokerV2LeaveConfirmYes', 'pokerV2LeaveConfirmCancel',
    'pokerV2ReactionBtn', 'pokerV2ReactionMenu', 'pokerV2ReactionHint',
    'pokerV2RebuyPanel', 'pokerV2RebuyTitle', 'pokerV2RebuyCopy', 'pokerV2RebuyBalance', 'pokerV2RebuyBtn', 'pokerV2RebuyLobbyBtn', 'pokerV2RebuyWatchBtn', 'pokerV2RebuyAccountLink',
    'pokerV2ClosedTableModal', 'pokerV2ClosedTableTitle', 'pokerV2ClosedTableCountdown',
    'pokerV2DemoPill', 'pokerV2FoldBtn', 'pokerV2PrimaryBtn', 'pokerV2AmountBtn',
    'pokerV2AllInBtn', 'pokerV2FoldPreactionWrap', 'pokerV2FoldPreaction', 'pokerV2FoldPreactionText',
    'pokerV2PrimaryPreactionWrap', 'pokerV2PrimaryPreaction', 'pokerV2PrimaryPreactionText',
    'pokerV2AmountPreactionWrap', 'pokerV2AmountPreaction', 'pokerV2AmountPreactionText',
    'pokerV2AllInPreactionWrap', 'pokerV2AllInPreaction', 'pokerV2AllInPreactionText',
    'pokerV2AmountInput', 'pokerV2AmountInputWrap', 'pokerV2AmountValue',
    'pokerTableScreen', 'pokerCenterLayer', 'pokerBootSplash'
  ].forEach((id) => {
    elements[id] = makeElement(id);
  });
  elements.pokerLobbyLink.href = '/poker/';
  elements.xpBadge.href = '/xp.html';
  elements.pokerV2SeatNo.value = '1';
  elements.pokerV2BuyIn.value = '100';
  elements.pokerV2AmountInput.value = '20';
  elements.pokerV2FoldPreaction.type = 'checkbox';
  elements.pokerV2PrimaryPreaction.type = 'checkbox';
  elements.pokerV2AmountPreaction.type = 'checkbox';
  elements.pokerV2AllInPreaction.type = 'checkbox';
  elements.pokerV2LeaveConfirmModal.hidden = true;
  elements.pokerV2ClosedTableModal.hidden = true;
  elements.pokerV2RebuyPanel.hidden = true;
  elements.pokerMenuPanel.setAttribute('hidden', 'hidden');

  const documentEvents = {};
  const logs = [];
  const joinPayloads = [];
  const joinRequestIds = [];
  let snapshotRequestCount = 0;
  const actPayloads = [];
  const startPayloads = [];
  const leavePayloads = [];
  const rebuyPayloads = [];
  const reactionPayloads = [];
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
    sendJoin(payload, requestId){
      joinPayloads.push(payload);
      joinRequestIds.push(requestId || null);
      if (typeof options.sendJoin === 'function') return options.sendJoin(payload, { attempt: joinPayloads.length, requestId: requestId || null });
      return Promise.resolve({ ok: true, seatNo: payload.seatNo || payload.preferredSeatNo || 1 });
    },
    sendAct(payload){ actPayloads.push(payload); return Promise.resolve({ ok: true }); },
    sendStartHand(payload){ startPayloads.push(payload); return Promise.resolve({ ok: true }); },
    sendRebuy(payload){
      rebuyPayloads.push(payload);
      if (typeof options.sendRebuy === 'function') return options.sendRebuy(payload, { attempt: rebuyPayloads.length });
      return Promise.resolve({ ok: true });
    },
    sendLeave(payload){
      leavePayloads.push(payload);
      if (typeof options.sendLeave === 'function') return options.sendLeave(payload, { attempt: leavePayloads.length });
      return Promise.resolve({ ok: true });
    },
    sendReaction(reactionKey){
      reactionPayloads.push(reactionKey);
      if (typeof options.sendReaction === 'function') return options.sendReaction(reactionKey, { attempt: reactionPayloads.length });
      return Promise.resolve({ ok: true });
    },
    requestGameplaySnapshot(){
      snapshotRequestCount += 1;
      if (typeof options.requestGameplaySnapshot === 'function') return options.requestGameplaySnapshot({ attempt: snapshotRequestCount });
      return null;
    }
  };
  if (typeof options.sendLeaveQueued === 'function' || options.enableQueuedLeave === true) {
    wsClient.sendLeaveQueued = function(payload, requestId){
      leavePayloads.push(payload);
      if (typeof options.sendLeaveQueued === 'function') {
        return options.sendLeaveQueued(payload, { attempt: leavePayloads.length, requestId });
      }
      return requestId || ('leave_queued_' + leavePayloads.length);
    };
  }

  const intervalTimers = [];
  const timeoutTimers = [];
  const sessionStorageEntries = new Map();
  let nextTimeoutId = 1;
  let nowMs = Number.isFinite(options.nowMs) ? options.nowMs : 1_700_000_000_000;
  const FakeDate = class extends Date {
    constructor(...args){
      if (args.length) super(...args);
      else super(nowMs);
    }
    static now(){ return nowMs; }
  };
  FakeDate.parse = Date.parse;
  FakeDate.UTC = Date.UTC;
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
      matchMedia(){ return { matches: options.reducedMotion === true }; },
      setInterval(fn){
        intervalTimers.push(fn);
        return intervalTimers.length;
      },
      clearInterval(){},
      clearTimeout(id){
        const timer = timeoutTimers.find((entry) => entry.id === id);
        if (timer) timer.cleared = true;
      },
      setTimeout(fn, delay){
        const timer = { id: nextTimeoutId++, fn, at: nowMs + Math.max(0, Number(delay) || 0), cleared: false };
        timeoutTimers.push(timer);
        return timer.id;
      }
    },
    sessionStorage: {
      getItem(key){ return sessionStorageEntries.has(String(key)) ? sessionStorageEntries.get(String(key)) : null; },
      setItem(key, value){ sessionStorageEntries.set(String(key), String(value)); },
      removeItem(key){ sessionStorageEntries.delete(String(key)); },
      clear(){ sessionStorageEntries.clear(); }
    },
    document: {
      readyState: 'loading',
      addEventListener(type, fn){ documentEvents[type] = documentEvents[type] || []; documentEvents[type].push(fn); },
      getElementById(id){ return elements[id] || null; },
      querySelector(selector){
        if (selector === '.poker-scene') return elements.pokerTableScreen || null;
        if (selector === '.poker-center-layer') return elements.pokerCenterLayer || null;
        return null;
      },
      createElement(tag){ return makeElement(tag); }
    },
    URLSearchParams,
    Date: FakeDate,
    atob(value){ return Buffer.from(String(value), 'base64').toString('binary'); },
    Buffer,
    console
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.sessionStorage = sandbox.sessionStorage;
  if (Object.prototype.hasOwnProperty.call(options, 'authUser')) {
    sandbox.window.SupabaseAuth = {
      getCurrentUser: async () => options.authUser,
      onAuthChange(){ return function(){}; }
    };
  }

  if (options.guestSession) {
    sandbox.sessionStorage.setItem('poker:guestSession', JSON.stringify(options.guestSession));
  }

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

  function advanceTime(ms){
    nowMs += Math.max(0, Number(ms) || 0);
    const due = timeoutTimers
      .filter((timer) => !timer.cleared && timer.at <= nowMs)
      .sort((left, right) => left.at - right.at);
    due.forEach((timer) => {
      timer.cleared = true;
      timer.fn();
    });
  }

  return {
    elements,
    logs,
    windowLocation: sandbox.window.location,
    joinPayloads,
    joinRequestIds,
    actPayloads,
    startPayloads,
    leavePayloads,
    rebuyPayloads,
    reactionPayloads,
    getSnapshotRequestCount(){ return snapshotRequestCount; },
    fireDomContentLoaded,
    fireDocumentEvent,
    flush,
    advanceTime,
    getCreateOptions(){ return createOptions; },
    getIntervalCount(){ return intervalTimers.length; },
    getSessionStorage(key){ return sandbox.sessionStorage.getItem(key); }
  };
}

function confirmLeave(harness){
  harness.elements.pokerV2LeaveBtn.click();
  harness.elements.pokerV2LeaveConfirmYes.click();
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

function findChildByClass(node, className){
  return (node.children || []).find((child) => String(child.className || '').split(/\s+/).includes(className));
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
  assert.equal(JSON.stringify(harness.joinPayloads[0]), JSON.stringify({ tableId: 'table-1', buyIn: 240, autoSeat: true, preferredSeatNo: 3 }));
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

  assert.equal(harness.elements.pokerLobbyLink.href, '/poker/');
  assert.equal(harness.elements.pokerSeatLayer.children.length, 6, 'v2 should render all seats for the table');
  assert.equal(harness.elements.pokerCommunityCards.children.length, 4, 'v2 should render live board cards');
  assert.equal(harness.elements.pokerHeroCards.children.length, 2, 'v2 should render live hole cards');
  assert.match(harness.elements.pokerHeroCards.className, /poker-hero-cards--docked/, 'v2 should dock hero hole cards to the hero avatar');
  assert.equal(harness.elements.pokerPotPill.textContent, 'Pot 42');
  assert.equal(harness.elements.pokerV2PrimaryBtn.hidden, false, 'v2 should surface the primary turn action');
  assert.equal(harness.elements.pokerV2PrimaryBtn.textContent, 'Check', 'v2 should keep check compact when there is nothing to call');
  assert.equal(harness.elements.pokerV2AmountBtn.hidden, false, 'v2 should surface bet/raise when legal');
  assert.equal(harness.elements.pokerV2JoinBtn.disabled, true, 'join should stay disabled once the user is seated');
  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  assert.ok(heroSeat, 'v2 should render a dedicated hero seat');
  assert.equal(heroSeat.style.left, '34%', 'hero seat should be shifted left to avoid the action rail');
  assert.equal(heroSeat.style.top, '91%', 'hero seat should stay near the bottom edge');
  assert.equal(harness.elements.pokerHeroCards.style.left, '42.3%', 'hero hole cards should shift left by half a card height toward the avatar');
  assert.ok(parseFloat(harness.elements.pokerHeroCards.style.top) >= 100, 'hero hole cards should sit lower by roughly half a card height, even if they partially overlap the avatar or scene edge');
  assert.equal(harness.elements.pokerHeroCards.style.bottom, 'auto', 'hero hole cards should not fall back to the global bottom anchor when the hero seat is present');
  const seatCards = heroSeat.children.find((node) => node.className === 'poker-seat-cards');
  assert.equal(seatCards, undefined, 'hero seat should not duplicate the bottom hole cards');
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
  confirmLeave(harness);
  await harness.flush();

  assert.equal(harness.startPayloads.length, 1);
  assert.equal(JSON.stringify(harness.startPayloads[0]), JSON.stringify({ tableId: 'table-1' }));
  assert.equal(harness.leavePayloads.length, 1);
  assert.equal(JSON.stringify(harness.leavePayloads[0]), JSON.stringify({ tableId: 'table-1' }));
  assert.equal(harness.windowLocation.href, '/poker/');
});

test('poker v2 disables reactions for four seconds after an accepted reaction', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: { hand: { handId: null, status: 'LOBBY' }, pot: { total: 0 } },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerV2ReactionBtn.hidden, false);
  assert.equal(harness.elements.pokerV2ReactionBtn.disabled, false);
  harness.elements.pokerV2ReactionBtn.click();
  const wowOption = harness.elements.pokerV2ReactionMenu.children.find((child) => child.dataset.reactionKey === 'wow');
  assert.ok(wowOption);
  wowOption.click();
  await harness.flush();

  assert.deepEqual(harness.reactionPayloads, ['wow']);
  assert.equal(harness.elements.pokerV2ReactionBtn.disabled, true);
  assert.equal(harness.elements.pokerV2ReactionHint.hidden, false);
  assert.equal(harness.elements.pokerV2ReactionHint.textContent, 'You can react once every 4 seconds');

  harness.advanceTime(3_999);
  await harness.flush();
  assert.equal(harness.elements.pokerV2ReactionBtn.disabled, true);
  harness.advanceTime(1);
  await harness.flush();
  assert.equal(harness.elements.pokerV2ReactionBtn.disabled, false);
  assert.equal(harness.elements.pokerV2ReactionHint.hidden, true);
});

test('poker v2 removes a reaction bubble when the seat owner changes', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        hand: { handId: null, status: 'LOBBY' },
        pot: { total: 0 },
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }]
      },
      you: { seat: 1 }
    }
  });
  await harness.flush();
  ws.onReaction({ payload: { seatNo: 1, reactionKey: 'wow' } });
  await harness.flush();
  assert.ok(harness.elements.pokerSeatLayer.children.some((seat) => findSeatChild(seat, 'poker-seat-reaction-bubble')));

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-2', seat: 1 }] },
      public: {
        hand: { handId: null, status: 'LOBBY' },
        pot: { total: 0 },
        seats: [{ userId: 'user-2', seatNo: 1, status: 'ACTIVE' }]
      },
      you: { seat: null }
    }
  });
  await harness.flush();
  assert.equal(harness.elements.pokerSeatLayer.children.some((seat) => findSeatChild(seat, 'poker-seat-reaction-bubble')), false);
});

test('poker v2 applies local cooldown after a server reaction rate limit', async () => {
  const harness = createHarness({
    sendReaction: () => {
      const error = new Error('reaction_rate_limited');
      error.code = 'reaction_rate_limited';
      return Promise.reject(error);
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: { hand: { handId: null, status: 'LOBBY' }, pot: { total: 0 } },
      you: { seat: 1 }
    }
  });
  await harness.flush();
  harness.elements.pokerV2ReactionBtn.click();
  const wowOption = harness.elements.pokerV2ReactionMenu.children.find((child) => child.dataset.reactionKey === 'wow');
  wowOption.click();
  await harness.flush();

  assert.equal(harness.elements.pokerV2ReactionBtn.disabled, true);
  assert.equal(harness.elements.pokerV2ReactionHint.hidden, false);
  harness.advanceTime(4_000);
  await harness.flush();
  assert.equal(harness.elements.pokerV2ReactionBtn.disabled, false);
});

test('poker v2 shows one reserved next-hand join without cards, actions, or folded styling', async () => {
  const unresolvedJoin = new Promise(() => {});
  const harness = createHarness({
    sendJoin: () => unresolvedJoin
  });
  harness.fireDomContentLoaded();
  await harness.flush();
  const ws = harness.getCreateOptions();
  await waitFor(() => harness.elements.pokerV2JoinBtn.disabled === false);

  harness.elements.pokerV2JoinBtn.click();
  harness.elements.pokerV2JoinBtn.click();
  await harness.flush();

  assert.equal(harness.joinPayloads.length, 1);
  assert.equal(harness.elements.pokerV2JoinBtn.disabled, true);
  assert.equal(harness.elements.pokerV2JoinBtn.textContent, 'Reserving seat…');
  assert.equal(harness.elements.pokerV2JoinBtn.attributes['aria-busy'], 'true');
  assert.ok(harness.getSessionStorage('poker:pendingJoin:user-1:table-1'));

  ws.onStatus('join_pending', { requestId: harness.joinRequestIds[0], reason: 'soft_timeout' });
  assert.equal(harness.elements.pokerV2JoinBtn.textContent, 'Checking reservation…');
  assert.equal(harness.elements.pokerV2ErrorText.hidden, true);

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 8,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [{ userId: 'user-1', seat: 4, status: 'WAITING_NEXT_HAND' }]
      },
      public: {
        hand: { handId: 'hand-live', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'bot-1' },
        board: [],
        pot: { total: 15, sidePots: [] },
        legalActions: { seat: null, actions: [] }
      },
      private: {
        playerState: { status: 'WAITING_NEXT_HAND', stack: 100, canRebuy: false },
        holeCards: []
      },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  assert.ok(heroSeat);
  assert.match(heroSeat.className, /poker-seat--waiting-next-hand/);
  assert.doesNotMatch(heroSeat.className, /poker-seat--folded/);
  assert.equal(findSeatChild(heroSeat, 'poker-seat-status').textContent, 'NEXT HAND');
  assert.equal(findSeatChild(heroSeat, 'poker-seat-cards'), undefined);
  assert.equal(harness.elements.pokerHeroCards.hidden, true);
  assert.equal(harness.elements.pokerV2FoldBtn.hidden, true);
  assert.equal(harness.elements.pokerV2JoinBtn.textContent, 'Joining next hand');
  assert.equal(harness.getSessionStorage('poker:pendingJoin:user-1:table-1'), null);
});

test('poker v2 guest mode shows restrictions panel, hides XP badge, and still auto-joins', async () => {
  const guestPayload = Buffer.from(JSON.stringify({ sub: 'guest_user_1' })).toString('base64url');
  const guestToken = `aaa.${guestPayload}.zzz`;
  const harness = createHarness({
    search: '?tableId=guest_table_1&guest=1&autoJoin=1',
    token: null,
    guestSession: {
      token: guestToken,
      tableId: 'guest_table_1',
      guestId: 'guest_user_1',
      nickname: 'Guest1234',
      expiresAt: Date.now() + 3_600_000,
      createPending: true
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  assert.ok(ws, 'guest mode should still bootstrap a WS client');
  assert.equal(ws.guestToken, guestToken);
  assert.equal(harness.elements.xpBadge.hidden, true, 'guest mode should hide the XP badge');
  assert.equal(harness.elements.pokerV2GuestBadge.hidden, false, 'guest mode should show the guest badge');
  assert.equal(harness.elements.pokerV2GuestPanel.hidden, false, 'guest mode should show the restrictions panel');

  await waitFor(() => harness.joinPayloads.length === 1);
  assert.equal(JSON.stringify(harness.joinPayloads[0]), JSON.stringify({
    tableId: 'guest_table_1',
    buyIn: 100,
    autoSeat: true,
    preferredSeatNo: 1,
    guestJoinIntent: 'create'
  }));
  const storedGuestSession = JSON.parse(harness.getSessionStorage('poker:guestSession'));
  assert.equal(storedGuestSession.createPending, false, 'create intent must be consumed before the join resolves');
});

test('poker v2 treats a historical guest session as resume-only and redirects on table_closed', async () => {
  const guestPayload = Buffer.from(JSON.stringify({ sub: 'guest_user_resume' })).toString('base64url');
  const guestToken = `aaa.${guestPayload}.zzz`;
  const harness = createHarness({
    search: '?tableId=guest_table_resume&guest=1&autoJoin=1',
    token: null,
    guestSession: {
      token: guestToken,
      tableId: 'guest_table_resume',
      guestId: 'guest_user_resume',
      nickname: 'Guest4321',
      expiresAt: Date.now() + 3_600_000
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  await waitFor(() => harness.joinPayloads.length === 1);
  assert.equal(harness.joinPayloads[0].guestJoinIntent, 'resume');

  const ws = harness.getCreateOptions();
  ws.onStatus('command_result', { reason: 'table_closed' });
  await harness.flush();
  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, false);
  assert.equal(harness.elements.pokerV2ClosedTableCountdown.textContent, 'Returning to lobby in 5 seconds…');

  for (let i = 0; i < 5; i += 1){
    harness.advanceTime(1000);
    await harness.flush();
  }
  assert.equal(harness.windowLocation.href, '/poker/');
  assert.equal(harness.joinPayloads.length, 1, 'closed guest table must not trigger another auto-join');
});

test('poker v2 authenticated user takes precedence over a matching guest session', async () => {
  const guestPayload = Buffer.from(JSON.stringify({ sub: 'guest_user_1' })).toString('base64url');
  const guestToken = `aaa.${guestPayload}.zzz`;
  const harness = createHarness({
    search: '?tableId=guest_table_1&guest=1&autoJoin=1',
    guestSession: {
      token: guestToken,
      tableId: 'guest_table_1',
      guestId: 'guest_user_1',
      nickname: 'Guest1234',
      expiresAt: Date.now() + 3_600_000
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  assert.ok(ws, 'authenticated user flow should bootstrap a WS client');
  assert.equal(ws.guestToken, null);
  assert.equal(harness.elements.xpBadge.hidden, false, 'authenticated user mode should keep the XP badge visible');
  assert.equal(harness.elements.pokerV2GuestBadge.hidden, true, 'authenticated user mode should not show the guest badge');
  assert.equal(harness.elements.pokerV2GuestPanel.hidden, true, 'authenticated user mode should not show the restrictions panel');
});

test('poker v2 never labels a resolved authenticated user as a guest while its token is pending', async () => {
  const guestPayload = Buffer.from(JSON.stringify({ sub: 'guest_user_1' })).toString('base64url');
  const guestToken = `aaa.${guestPayload}.zzz`;
  const harness = createHarness({
    search: '?tableId=guest_table_1&guest=1&autoJoin=1',
    token: null,
    authUser: { id: 'registered-user-1', email: 'player@example.com' },
    guestSession: {
      token: guestToken,
      tableId: 'guest_table_1',
      guestId: 'guest_user_1',
      nickname: 'Guest1234',
      expiresAt: Date.now() + 3_600_000
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();
  await harness.flush();

  assert.equal(harness.elements.pokerV2GuestBadge.hidden, true);
  assert.equal(harness.elements.pokerV2GuestPanel.hidden, true);
  assert.equal(harness.elements.xpBadge.hidden, false);
  assert.equal(harness.getCreateOptions(), null, 'room should wait for the authenticated token instead of opening a guest socket');
});

test('poker v2 ignores stale guest query when there is no matching guest session', async () => {
  const harness = createHarness({
    search: '?tableId=table-1&guest=1&autoJoin=1'
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  assert.ok(ws, 'registered user flow should still bootstrap a WS client');
  assert.equal(ws.guestToken, null);
  assert.equal(harness.elements.xpBadge.hidden, false, 'registered user mode should keep the XP badge visible');
  assert.equal(harness.elements.pokerV2GuestBadge.hidden, true, 'registered user mode should not show the guest badge');
  assert.equal(harness.elements.pokerV2GuestPanel.hidden, true, 'registered user mode should not show the restrictions panel');
});

test('poker v2 ignores a guest session for a different table', async () => {
  const guestPayload = Buffer.from(JSON.stringify({ sub: 'guest_user_old' })).toString('base64url');
  const guestToken = `aaa.${guestPayload}.zzz`;
  const harness = createHarness({
    search: '?tableId=table-1&guest=1&autoJoin=1',
    guestSession: {
      token: guestToken,
      tableId: 'guest_table_old',
      guestId: 'guest_user_old',
      nickname: 'GuestOld',
      expiresAt: Date.now() + 3_600_000
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  assert.ok(ws, 'registered user flow should still bootstrap when stale guest storage exists');
  assert.equal(ws.guestToken, null);
  assert.equal(harness.elements.xpBadge.hidden, false);
  assert.equal(harness.elements.pokerV2GuestBadge.hidden, true);
  assert.equal(harness.elements.pokerV2GuestPanel.hidden, true);
});

test('poker v2 shows a closed-table countdown, cancels on recovery, and redirects after five seconds', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: { hand: { handId: 'hand-1', status: 'TURN' }, pot: { total: 10 } },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 3,
      table: { tableId: 'table-1', status: 'CLOSED', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: { hand: { handId: 'hand-1', status: 'SETTLED' }, pot: { total: 10 } },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, false);
  assert.equal(harness.elements.pokerV2ClosedTableTitle.textContent, 'This table has ended. Returning to lobby in 5 seconds…');
  assert.equal(harness.elements.pokerV2ClosedTableCountdown.textContent, 'Returning to lobby in 5 seconds…');

  harness.advanceTime(1000);
  await harness.flush();
  assert.equal(harness.elements.pokerV2ClosedTableCountdown.textContent, 'Returning to lobby in 4…');

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 4,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: { hand: { handId: 'hand-2', status: 'PREFLOP' }, pot: { total: 0 } },
      you: { seat: 1 }
    }
  });
  await harness.flush();
  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, true, 'valid live state should cancel the redirect');

  ws.onProtocolError({ code: 'TABLE_NOT_FOUND' });
  await harness.flush();
  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, false, 'explicit closed/unavailable protocol errors should start the redirect');
  for (let i = 0; i < 5; i += 1){
    harness.advanceTime(1000);
    await harness.flush();
  }
  assert.equal(harness.windowLocation.href, '/poker/');
});

test('poker v2 clears the closed-table redirect when live mode is torn down', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onProtocolError({ code: 'table_closed' });
  await harness.flush();
  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, false);

  ws.onProtocolError({ code: 'missing_access_token' });
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();

  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, true);
  assert.equal(harness.windowLocation.href, '');
});

test('poker v2 keeps closed-table redirect active across ambiguous HAND_DONE snapshots without status', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onProtocolError({ code: 'table_closed' });
  await harness.flush();
  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, false);

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 5,
      table: { tableId: 'table-1', maxSeats: 6, members: [] },
      public: {
        hand: { handId: 'hand-closed', status: 'HAND_DONE' },
        pot: { total: 0 },
        seats: []
      },
      you: { seat: null }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerV2ClosedTableModal.hidden, false);
  assert.equal(harness.elements.pokerV2ClosedTableCountdown.textContent, 'Returning to lobby in 5 seconds…');
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

test('poker v2 falls back to base hero card layout when the hero seat is temporarily unavailable', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
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
        hand: { handId: 'hand-hero', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        board: ['As', 'Kd', '3h'],
        pot: { total: 42, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CHECK', 'BET'] },
        actionConstraints: { toCall: 0, maxBetAmount: 120 }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.match(harness.elements.pokerHeroCards.className, /poker-hero-cards--docked/, 'hero cards should dock when the hero seat is available');
  assert.equal(harness.elements.pokerHeroCards.style.bottom, 'auto');

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 3,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        seats: [
          { userId: 'villain-1', seatNo: 2, status: 'ACTIVE' }
        ],
        hand: { handId: 'hand-hero', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', deadlineAt: Date.now() + 5000 },
        board: ['As', 'Kd', '3h'],
        pot: { total: 42, sidePots: [] },
        legalActions: { seat: null, actions: [] },
        actionConstraints: { toCall: null, maxBetAmount: null }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }] },
      you: null
    }
  });
  await harness.flush();

  assert.doesNotMatch(harness.elements.pokerHeroCards.className, /poker-hero-cards--docked/, 'hero cards should drop the docked variant when the hero seat is unavailable');
  assert.equal(harness.elements.pokerHeroCards.style.left, undefined, 'hero cards should clear docked left positioning on fallback');
  assert.equal(harness.elements.pokerHeroCards.style.top, undefined, 'hero cards should clear docked top positioning on fallback');
  assert.equal(harness.elements.pokerHeroCards.style.bottom, undefined, 'hero cards should return to base CSS bottom anchoring on fallback');
});

test('poker v2 renders chip atlas stack variants from pot amount breakdown', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  const snapshot = (potTotal, stateVersion) => ({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        hand: { handId: 'hand-chip-visuals', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: potTotal, sidePots: [] },
        legalActions: { seat: 1, actions: ['CHECK'] },
        actionConstraints: { toCall: 0 }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }] },
      you: { seat: 1 }
    }
  });

  ws.onSnapshot(snapshot(1, 10));
  await harness.flush();

  let visual = harness.elements.pokerPotChipStack.children[0];
  assert.equal(visual.attributes['data-amount'], '1');
  assert.equal(visual.attributes['data-chip-count'], '1');
  assert.equal(visual.attributes['data-stack-count'], '1');
  assert.equal(visual.children[0].src, 'assets/chips/chip-white-1.png');

  ws.onSnapshot(snapshot(124, 11));
  await harness.flush();

  visual = harness.elements.pokerPotChipStack.children[0];
  assert.equal(visual.attributes['data-amount'], '124');
  assert.equal(visual.attributes['data-chip-count'], '7');
  assert.equal(visual.attributes['data-stack-count'], '3');
  assert.deepEqual(
    visual.children.map((child) => child.src),
    [
      'assets/chips/chip-white-4.png',
      'assets/chips/chip-blue-2.png',
      'assets/chips/chip-black-1.png'
    ]
  );
});

test('poker v2 prefers committed chip maps for seat bet stacks', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 12,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        hand: { handId: 'hand-seat-chip-visuals', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        stacks: { 'user-1': 124 },
        betThisRoundByUserId: { 'user-1': 4 },
        committedByUserId: { 'user-1': 9 },
        pot: { total: 9, sidePots: [] },
        legalActions: { seat: 1, actions: ['CHECK'] },
        actionConstraints: { toCall: 0 }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const betStack = harness.elements.pokerSeatChipLayer.children[0];
  const stack = harness.elements.pokerSeatChipLayer.children[1];
  assert.equal(betStack.attributes['data-amount'], '9');
  assert.equal(betStack.attributes['data-chip-count'], '5');
  assert.equal(betStack.children[0].src, 'assets/chips/chip-white-4.png');
  assert.equal(betStack.children[1].src, 'assets/chips/chip-red-1.png');
  assert.equal(stack.attributes['data-amount'], '124');
});

test('poker v2 keeps side-seat chip stacks beside avatars instead of the community-card lane', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 13,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'user-1', seat: 1 },
          { userId: 'bot-2', seat: 2 },
          { userId: 'bot-3', seat: 3 },
          { userId: 'bot-4', seat: 4 },
          { userId: 'bot-5', seat: 5 },
          { userId: 'bot-6', seat: 6 }
        ]
      },
      public: {
        hand: { handId: 'hand-side-chip-position', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        stacks: { 'bot-6': 124 },
        committedByUserId: { 'bot-6': 9 },
        pot: { total: 9, sidePots: [] },
        legalActions: { seat: 1, actions: ['CHECK'] },
        actionConstraints: { toCall: 0 }
      },
      private: { holeCards: [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const betStack = harness.elements.pokerSeatChipLayer.children[0];
  const seatStack = harness.elements.pokerSeatChipLayer.children[1];
  const centerLane = { left: 33, right: 67, top: 31, bottom: 57 };
  const isInsideCenterLane = (point) => (
    point.x >= centerLane.left
    && point.x <= centerLane.right
    && point.y >= centerLane.top
    && point.y <= centerLane.bottom
  );
  const parsePoint = (stack) => ({
    x: Number.parseFloat(stack.style.left),
    y: Number.parseFloat(stack.style.top)
  });
  const betPoint = parsePoint(betStack);
  const stackPoint = parsePoint(seatStack);

  assert.ok(betPoint.x >= 10 && betPoint.x <= 90);
  assert.ok(betPoint.y >= 12 && betPoint.y <= 88);
  assert.ok(stackPoint.x >= 10 && stackPoint.x <= 90);
  assert.ok(stackPoint.y >= 12 && stackPoint.y <= 88);
  assert.ok(!isInsideCenterLane(betPoint));
  assert.ok(!isInsideCenterLane(stackPoint));
  assert.ok(betPoint.x < 80);
  assert.ok(stackPoint.x < 80);
  assert.ok(Math.abs(betPoint.x - 80) <= 30);
  assert.ok(Math.abs(stackPoint.x - 80) <= 30);
  assert.notEqual(betPoint.y, stackPoint.y);
});

test('poker v2 keeps fold available even when live legalActions omit fold', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 30,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        hand: { handId: 'hand-fold-always', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 48, sidePots: [] },
        legalActions: { seat: 1, actions: ['CHECK', 'BET'] },
        actionConstraints: { toCall: 0, maxBetAmount: 120 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerV2FoldBtn.hidden, false);
  harness.elements.pokerV2FoldBtn.click();
  await harness.flush();

  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-fold-always', action: 'FOLD' }));
});

test('poker v2 renders authoritative out-of-chips state with stable disabled actions and explicit rebuy', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();
  const ws = harness.getCreateOptions();
  const snapshot = (playerState) => ({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 40,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }, { userId: 'bot-1', seat: 2 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: playerState.status }, { userId: 'bot-1', seatNo: 2, status: 'ACTIVE', isBot: true }],
        stacks: { 'user-1': playerState.stack, 'bot-1': 98 },
        hand: { handId: 'bot-hand', status: 'PREFLOP', dealerSeatNo: 2 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 3, sidePots: [] },
        legalActions: { seat: 1, actions: [] }
      },
      private: { userId: 'user-1', seat: 1, holeCards: [], playerState },
      you: { seat: 1 }
    }
  });
  ws.onSnapshot(snapshot({ status: 'OUT_OF_CHIPS', stack: 0, canRebuy: false }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2RebuyPanel.hidden, true, 'non-actionable out-of-chips state must not offer rebuy before rollover');

  ws.onSnapshot(snapshot({ status: 'OUT_OF_CHIPS', stack: 0, canRebuy: true }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2TurnText.textContent, 'Out of chips · Sitting out');
  assert.equal(harness.elements.pokerV2RebuyPanel.hidden, false);
  assert.equal(harness.elements.pokerV2RebuyBtn.disabled, false);
  for (const id of ['pokerV2FoldBtn', 'pokerV2PrimaryBtn', 'pokerV2AmountBtn', 'pokerV2AllInBtn']) {
    assert.equal(harness.elements[id].hidden, false);
    assert.equal(harness.elements[id].disabled, true);
  }
  harness.elements.pokerV2RebuyBtn.click();
  await harness.flush();
  assert.equal(JSON.stringify(harness.rebuyPayloads), JSON.stringify([{ tableId: 'table-1', amount: 100 }]));
  assert.equal(harness.elements.pokerV2RebuyPanel.hidden, true, 'accepted rebuy must close the prompt immediately');

  ws.onSnapshot(snapshot({ status: 'WAITING_NEXT_HAND', stack: 100, canRebuy: false }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2TurnText.textContent, 'Funded · Joining next hand');
  assert.equal(harness.elements.pokerV2RebuyPanel.hidden, true, 'waiting snapshot must not reopen an accepted rebuy prompt');
  assert.equal(harness.elements.pokerV2RebuyBtn.hidden, true);
});

test('poker v2 keeps action buttons stable while exposing single-select preactions off-turn', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 31,
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
        hand: { handId: 'hand-stable-controls-off-turn', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 18, sidePots: [] },
        stacks: { 'user-1': 100, 'villain-1': 80 },
        legalActions: { seat: 1, actions: [] },
        actionConstraints: { toCall: 6, minRaiseTo: 18, maxRaiseTo: 120 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const buttons = [
    harness.elements.pokerV2FoldBtn,
    harness.elements.pokerV2PrimaryBtn,
    harness.elements.pokerV2AmountBtn,
    harness.elements.pokerV2AllInBtn
  ];
  buttons.forEach((button) => {
    assert.equal(button.hidden, true);
    assert.equal(button.disabled, true);
  });
  assert.equal(harness.elements.pokerV2PrimaryBtn.textContent, 'Call (6)');
  assert.equal(harness.elements.pokerV2AmountBtn.textContent, 'Raise');
  assert.equal(harness.elements.pokerV2FoldPreactionWrap.hidden, false);
  assert.equal(harness.elements.pokerV2PrimaryPreactionWrap.hidden, false);
  assert.equal(harness.elements.pokerV2AmountPreactionWrap.hidden, false);
  assert.equal(harness.elements.pokerV2AllInPreactionWrap.hidden, false);
  assert.equal(harness.elements.pokerV2PrimaryPreactionText.textContent, 'Call (6)');
  assert.equal(harness.elements.pokerV2AmountPreactionText.textContent, 'Raise (20)');
  assert.equal(harness.elements.pokerV2AllInPreaction.disabled, false);

  harness.elements.pokerV2PrimaryPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2PrimaryPreaction.checked, true);
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, false);

  harness.elements.pokerV2AmountPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2PrimaryPreaction.checked, false);
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, true);
  assert.equal(harness.actPayloads.length, 0);
});

test('poker v2 auto-executes a queued preaction without moving the live action buttons', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 32,
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
        hand: { handId: 'hand-preaction-call', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 18, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        actionConstraints: { toCall: 6, minRaiseTo: 18, maxRaiseTo: 120 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  harness.elements.pokerV2PrimaryPreaction.click();
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 33,
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
        hand: { handId: 'hand-preaction-call', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 24, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL', 'RAISE'] },
        actionConstraints: { toCall: 6, minRaiseTo: 18, maxRaiseTo: 120 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-preaction-call', action: 'CALL' }));
  assert.equal(harness.elements.pokerV2FoldPreactionWrap.hidden, true);
  assert.equal(harness.elements.pokerV2PrimaryPreactionWrap.hidden, true);
  assert.equal(harness.elements.pokerV2AmountPreactionWrap.hidden, true);
  assert.equal(harness.elements.pokerV2AllInPreactionWrap.hidden, true);
  assert.equal(harness.elements.pokerV2FoldBtn.hidden, false);
  assert.equal(harness.elements.pokerV2PrimaryBtn.hidden, false);
  assert.equal(harness.elements.pokerV2AmountBtn.hidden, false);
  assert.equal(harness.elements.pokerV2AllInBtn.hidden, false);
});

test('poker v2 queues all-in intent from projected actions and resolves it from live turn constraints', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 34,
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
        hand: { handId: 'hand-preaction-all-in', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 18, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD'] },
        actionConstraints: { toCall: 6, minRaiseTo: 18, maxRaiseTo: 100, maxBetAmount: null },
        projectedLegalActions: { seat: 1, actions: ['FOLD', 'CALL', 'RAISE'] },
        stacks: { 'user-1': 100, 'villain-1': 80 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerV2AllInPreaction.disabled, false);
  harness.elements.pokerV2AllInPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2AllInPreaction.checked, true);

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 35,
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
        hand: { handId: 'hand-preaction-all-in', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 24, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL', 'RAISE'] },
        actionConstraints: { toCall: 6, minRaiseTo: 18, maxRaiseTo: 100, maxBetAmount: null },
        stacks: { 'user-1': 100, 'villain-1': 80 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-preaction-all-in', action: 'RAISE', amount: 100 }));
});

test('poker v2 clears queued all-in intent when the live turn has no legal all-in realization', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 36,
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
        hand: { handId: 'hand-preaction-all-in-invalid', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 18, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD'] },
        actionConstraints: { toCall: 6, minRaiseTo: 18, maxRaiseTo: 100, maxBetAmount: null },
        projectedLegalActions: { seat: 1, actions: ['FOLD', 'CALL', 'RAISE'] },
        stacks: { 'user-1': 100, 'villain-1': 80 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  harness.elements.pokerV2AllInPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2AllInPreaction.checked, true);

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 37,
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
        hand: { handId: 'hand-preaction-all-in-invalid', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 18, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CHECK'] },
        actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        stacks: { 'user-1': 100, 'villain-1': 80 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.actPayloads.length, 0);
  assert.equal(harness.elements.pokerV2AllInPreaction.checked, false);
  assert.equal(harness.elements.pokerV2AllInBtn.hidden, false);
  assert.equal(harness.elements.pokerV2AllInBtn.disabled, true);
});

test('poker v2 enables only legal actions without removing or moving the other buttons', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 32,
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
        hand: { handId: 'hand-stable-controls-transition', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 18, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        actionConstraints: { toCall: 0, maxBetAmount: 120 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const buttonsBeforeTurn = [
    harness.elements.pokerV2FoldBtn,
    harness.elements.pokerV2PrimaryBtn,
    harness.elements.pokerV2AmountBtn,
    harness.elements.pokerV2AllInBtn
  ];
  buttonsBeforeTurn.forEach((button) => {
    assert.equal(button.hidden, true);
    assert.equal(button.disabled, true);
  });
  [
    harness.elements.pokerV2FoldPreactionWrap,
    harness.elements.pokerV2PrimaryPreactionWrap,
    harness.elements.pokerV2AmountPreactionWrap,
    harness.elements.pokerV2AllInPreactionWrap
  ].forEach((preaction) => {
    assert.equal(preaction.hidden, false);
  });

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 33,
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
        hand: { handId: 'hand-stable-controls-transition', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 24, sidePots: [] },
        legalActions: { seat: 1, actions: ['CHECK'] },
        actionConstraints: { toCall: 0 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerV2FoldBtn.hidden, false);
  assert.equal(harness.elements.pokerV2FoldBtn.disabled, false);
  assert.equal(harness.elements.pokerV2PrimaryBtn.hidden, false);
  assert.equal(harness.elements.pokerV2PrimaryBtn.disabled, false);
  assert.equal(harness.elements.pokerV2PrimaryBtn.textContent, 'Check');
  assert.equal(harness.elements.pokerV2AmountBtn.hidden, false);
  assert.equal(harness.elements.pokerV2AmountBtn.disabled, true);
  assert.equal(harness.elements.pokerV2AllInBtn.hidden, false);
  assert.equal(harness.elements.pokerV2AllInBtn.disabled, true);
  assert.equal(harness.actPayloads.length, 0);
});

test('poker v2 sends authoritative maxRaiseTo for all-in even when the active opponent stack is smaller', async () => {
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
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' },
          { userId: 'villain-2', seat: 3, displayName: 'Villain 2' }
        ]
      },
      public: {
        seats: [
          { userId: 'user-1', seatNo: 1, status: 'ACTIVE' },
          { userId: 'villain-1', seatNo: 2, status: 'ACTIVE' },
          { userId: 'villain-2', seatNo: 3, status: 'FOLDED' }
        ],
        hand: { handId: 'hand-all-in', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 48, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL', 'RAISE'] },
        actionConstraints: { toCall: 10, minRaiseTo: 20, maxRaiseTo: 100, maxBetAmount: null },
        stacks: { 'user-1': 100, 'villain-1': 35, 'villain-2': 250 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  harness.elements.pokerV2AllInBtn.click();
  await harness.flush();

  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-all-in', action: 'RAISE', amount: 100 }));
});

test('poker v2 auto-joins from query params after live auth', async () => {
  const harness = createHarness({ search: '?tableId=table-1&seatNo=4&autoJoin=1' });
  harness.fireDomContentLoaded();
  await harness.flush();
  await waitFor(() => harness.joinPayloads.length === 1);

  assert.equal(JSON.stringify(harness.joinPayloads[0]), JSON.stringify({ tableId: 'table-1', buyIn: 100, autoSeat: true, preferredSeatNo: 4 }));
});

test('poker v2 retries Play now auto-join after a transient authoritative join failure', async () => {
  const harness = createHarness({
    search: '?tableId=table-1&seatNo=4&autoJoin=1',
    sendJoin(payload, context){
      if (context.attempt === 1) {
        const error = new Error('authoritative_join_rehydrate_failed');
        error.code = 'TABLE_BOOTSTRAP_FAILED';
        return Promise.reject(error);
      }
      return Promise.resolve({ ok: true, seatNo: payload.preferredSeatNo });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();
  await waitFor(() => harness.joinPayloads.length === 1);

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 0,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [] },
      public: {
        hand: { handId: null, status: 'INIT', dealerSeatNo: null },
        turn: { userId: null, deadlineAt: null },
        pot: { total: 0, sidePots: [] },
        legalActions: { seat: null, actions: [] },
        actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        stacks: {}
      },
      you: { seat: null }
    }
  });
  await harness.flush();

  assert.equal(harness.joinPayloads.length, 1);
  assert.equal(harness.elements.pokerV2ErrorText.textContent, 'authoritative_join_rehydrate_failed');
  assert.equal(harness.elements.pokerV2ErrorText.hidden, false);

  harness.advanceTime(250);
  await harness.flush();

  assert.equal(harness.joinPayloads.length, 2);
  assert.equal(JSON.stringify(harness.joinPayloads[1]), JSON.stringify({ tableId: 'table-1', buyIn: 100, autoSeat: true, preferredSeatNo: 4 }));
  assert.equal(harness.logs.some((entry) => entry.kind === 'poker_auto_join_failed' && entry.data.retryScheduled === true), true);
});

test('poker v2 renders insufficient funds as controlled non-retryable buy-in copy', async () => {
  const harness = createHarness({
    search: '?tableId=table-1&seatNo=4&autoJoin=1',
    sendJoin(){
      const error = new Error('insufficient_funds');
      error.code = 'insufficient_funds';
      return Promise.reject(error);
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();
  await waitFor(() => harness.joinPayloads.length === 1);

  assert.equal(harness.elements.pokerV2ErrorText.textContent, 'You need at least 100 CH to join a table.');
  assert.equal(harness.elements.pokerV2ErrorText.hidden, false);
  harness.advanceTime(5000);
  await harness.flush();
  assert.equal(harness.joinPayloads.length, 1, 'insufficient funds must not schedule auto-join retry');
});

test('poker v2 safely rejoins the same authoritative seat after a socket reconnect', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 40,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true },
          { userId: 'user-1', seat: 4, displayName: 'Hero' }
        ]
      },
      public: {
        hand: { handId: 'hand-before-reconnect', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  ws.onStatus('reconnecting', { attempt: 1 });
  ws.onStatus('auth_ok', { roomId: 'table-1' });
  await harness.flush();

  // auth_ok alone must not open the reconnect gate or trigger rejoin;
  // the gate opens only after a fresh authoritative snapshot is merged.
  assert.equal(harness.joinPayloads.length, 0);

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 41,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true },
          { userId: 'user-1', seat: 4, displayName: 'Hero' }
        ]
      },
      public: {
        hand: { handId: 'hand-after-reconnect', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  assert.equal(harness.joinPayloads.length, 1);
  assert.equal(JSON.stringify(harness.joinPayloads[0]), JSON.stringify({
    tableId: 'table-1',
    autoSeat: true,
    preferredSeatNo: 4
  }));
  assert.equal(Object.prototype.hasOwnProperty.call(harness.joinPayloads[0], 'buyIn'), false);
});

test('poker v2 retries the same reconnect seat after a transient join failure', async () => {
  const harness = createHarness({
    sendJoin(payload, context){
      if (context.attempt === 1) return Promise.reject(new Error('timeout'));
      return Promise.resolve({ ok: true, seatNo: payload.preferredSeatNo });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 40,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true },
          { userId: 'user-1', seat: 4, displayName: 'Hero' }
        ]
      },
      public: {
        hand: { handId: 'hand-reconnect-retry', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  ws.onStatus('reconnecting', { attempt: 1 });
  ws.onStatus('auth_ok', { roomId: 'table-1' });
  await harness.flush();
  // auth_ok alone must not open the reconnect gate or trigger a reconnect rejoin.
  assert.equal(harness.joinPayloads.length, 0);

  // Fresh authoritative snapshot opens the reconnect gate and triggers the first rejoin.
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 41,
      table: {
        tableId: 'table-1',
        status: 'OPEN',
        maxSeats: 6,
        members: [
          { userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true },
          { userId: 'user-1', seat: 4, displayName: 'Hero' }
        ]
      },
      public: {
        hand: { handId: 'hand-reconnect-retry-2', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();
  assert.equal(harness.joinPayloads.length, 1, 'reconnect rejoin attempt after snapshot opens gate');

  ws.onStatus('auth_ok', { roomId: 'table-1' });
  await harness.flush();

  assert.equal(harness.joinPayloads.length, 2);
  harness.joinPayloads.forEach((payload) => {
    assert.equal(JSON.stringify(payload), JSON.stringify({
      tableId: 'table-1',
      autoSeat: true,
      preferredSeatNo: 4
    }));
  });
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
  const nowMs = 1_700_000_100_000;
  const harness = createHarness({ nowMs });
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
  assert.equal(activeClock.style['--turn-hue'], '60');
  assert.equal(heroClock, undefined, 'inactive seats should not show the turn clock overlay');
});

test('poker v2 turns the live clock red when five seconds remain', async () => {
  const nowMs = 1_700_000_200_000;
  const harness = createHarness({ nowMs });
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
  assert.equal(heroClock.style['--turn-hue'], '27');
});

test('poker v2 renders last-action badges and dims folded seats', async () => {
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
        members: [
          { userId: 'user-1', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' },
          { userId: 'villain-2', seat: 3, displayName: 'Villain 2', status: 'FOLDED' }
        ]
      },
      public: {
        hand: { handId: 'hand-5', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', startedAt: Date.now() - 15_500, deadlineAt: Date.now() + 4_500 },
        pot: { total: 4, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] },
        actionConstraints: { toCall: 2, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        lastBettingRoundActionByUserId: { 'user-1': 'call', 'villain-1': 'raise', 'villain-2': 'fold' }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  const villainRaiseSeat = findSeatByLabel(harness, 'Villain 1');
  const foldedSeat = findSeatByLabel(harness, 'Villain 2');
  const heroBadge = (heroSeat.children || []).find((node) => /poker-seat-action-badge/.test(node.className));
  const villainBadge = (villainRaiseSeat.children || []).find((node) => /poker-seat-action-badge/.test(node.className));
  const foldedBadge = (foldedSeat.children || []).find((node) => /poker-seat-action-badge/.test(node.className));

  assert.ok(heroBadge);
  assert.equal(heroBadge.textContent, 'Call');
  assert.match(heroBadge.className, /poker-seat-action-badge--call/);
  assert.ok(villainBadge);
  assert.equal(villainBadge.textContent, 'Raise');
  assert.match(villainBadge.className, /poker-seat-action-badge--raise/);
  assert.ok(foldedBadge);
  assert.equal(foldedBadge.textContent, 'Fold');
  assert.match(foldedBadge.className, /poker-seat-action-badge--fold/);
  assert.match(foldedSeat.className, /poker-seat--folded/);
});

test('poker v2 renders the hero last-action badge when hero seat is resolved from youSeat fallback', async () => {
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
        members: [
          { userId: 'viewer-seat-row', seat: 1, displayName: 'Hero' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' }
        ]
      },
      public: {
        hand: { handId: 'hand-5b', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', startedAt: Date.now() - 15_500, deadlineAt: Date.now() + 4_500 },
        pot: { total: 4, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] },
        actionConstraints: { toCall: 2, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        lastBettingRoundActionByUserId: { 'user-1': 'call', 'villain-1': 'raise' }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  const heroBadge = (heroSeat.children || []).find((node) => /poker-seat-action-badge/.test(node.className));
  const heroName = (heroSeat.children || []).find((node) => node.className === 'poker-seat-name');

  assert.ok(heroSeat);
  assert.ok(heroBadge);
  assert.equal(heroBadge.textContent, 'Call');
  assert.match(heroBadge.className, /poker-seat-action-badge--call/);
  assert.equal(heroName.textContent, 'You');
});

test('poker v2 dims hero hole cards when the current player folds', async () => {
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
          { userId: 'user-1', seat: 1, displayName: 'Hero', status: 'FOLDED' },
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1', status: 'ACTIVE' }
        ]
      },
      public: {
        seats: [
          { userId: 'user-1', seatNo: 1, status: 'FOLDED' },
          { userId: 'villain-1', seatNo: 2, status: 'ACTIVE' }
        ],
        hand: { handId: 'hand-7', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', startedAt: Date.now() - 2_000, deadlineAt: Date.now() + 18_000 },
        pot: { total: 6, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        lastBettingRoundActionByUserId: { 'user-1': 'fold' }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  assert.match(heroSeat.className, /poker-seat--folded/);
  assert.match(harness.elements.pokerHeroCards.className, /poker-hero-cards--folded/);
});

test('poker v2 prefers authoritative folded seat status over table member fallback rows', async () => {
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
        seats: [
          { userId: 'user-1', seatNo: 1, status: 'FOLDED' },
          { userId: 'villain-1', seatNo: 2, status: 'ACTIVE' }
        ],
        hand: { handId: 'hand-8', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'villain-1', startedAt: Date.now() - 2_000, deadlineAt: Date.now() + 18_000 },
        pot: { total: 6, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        lastBettingRoundActionByUserId: { 'user-1': 'fold' }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  assert.match(heroSeat.className, /poker-seat--folded/);
  assert.match(harness.elements.pokerHeroCards.className, /poker-hero-cards--folded/);
});

test('poker v2 does not dim a seat from fold badge alone without folded status', async () => {
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
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1', status: 'ACTIVE' }
        ]
      },
      public: {
        hand: { handId: 'hand-6', status: 'TURN', dealerSeatNo: 2 },
        turn: { userId: 'user-1', startedAt: Date.now() - 2_000, deadlineAt: Date.now() + 18_000 },
        pot: { total: 6, sidePots: [] },
        legalActions: { seat: 1, actions: ['CHECK'] },
        actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        lastBettingRoundActionByUserId: { 'villain-1': 'fold' }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const villainSeat = findSeatByLabel(harness, 'Villain 1');
  const villainBadge = (villainSeat.children || []).find((node) => /poker-seat-action-badge/.test(node.className));

  assert.ok(villainBadge);
  assert.equal(villainBadge.textContent, 'Fold');
  assert.doesNotMatch(villainSeat.className, /poker-seat--folded/);
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

test('poker v2 preserves showdown hand summaries and revealed cards for legacy settled state', async () => {
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
          revealedShowdownParticipants: [
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
  const villainBadge = findSeatChild(villainSeat, 'poker-seat-settlement-badge');
  const villainCards = findSeatChild(villainSeat, 'poker-seat-cards');
  const villainBadgeLabel = findSeatChild(villainBadge, 'poker-seat-settlement-hand-label');
  const villainBadgeCards = findSeatChild(villainBadge, 'poker-seat-settlement-hand-cards');

  assert.ok(villainBadge);
  assert.ok(villainBadgeLabel);
  assert.equal(villainBadgeLabel.textContent.length > 0, true);
  assert.equal(villainBadgeCards.children.length, 5);
  assert.equal(villainCards.children.length, 2);
  assert.equal(villainCards.children[0].className.includes('poker-card--back'), false);
  assert.equal(villainCards.children[1].className.includes('poker-card--back'), false);
  const losingSeat = findSeatByLabel(harness, 'Villain 2');
  const losingCards = findSeatChild(losingSeat, 'poker-seat-cards');
  assert.ok(losingCards);
  assert.equal(losingCards.children.length, 2);
  assert.equal(losingCards.children[0].className.includes('poker-card--back'), true);
  assert.equal(losingCards.children[1].className.includes('poker-card--back'), true);
});

test('poker v2 reveals showdown cards for compared losing players without winner badge', async () => {
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
          { userId: 'villain-1', seat: 2, displayName: 'Villain 1' },
          { userId: 'villain-2', seat: 3, displayName: 'Villain 2' }
        ]
      },
      public: {
        hand: { handId: 'hand-7', status: 'SETTLED', dealerSeatNo: 2 },
        turn: { userId: null, seat: null, startedAt: null, deadlineAt: null },
        board: { cards: ['2H', '3H', '4H', '9C', 'KD'] },
        pot: { total: 0, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        showdown: {
          handId: 'hand-7',
          winners: ['villain-1'],
          reason: 'computed',
          revealedShowdownParticipants: [
            { userId: 'villain-1', holeCards: ['AS', 'AD'] },
            { userId: 'villain-2', holeCards: ['QS', 'QD'] }
          ]
        },
        handSettlement: {
          handId: 'hand-7',
          settledAt: '2026-04-11T10:00:00.000Z'
        }
      },
      private: { holeCards: [{ r: 'K', s: 'H' }, { r: 'K', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const losingSeat = findSeatByLabel(harness, 'Villain 2');
  const losingCards = findSeatChild(losingSeat, 'poker-seat-cards');
  assert.ok(losingCards);
  assert.equal(losingCards.children.length, 2);
  assert.equal(losingCards.children[0].className.includes('poker-card--back'), false);
  assert.equal(losingCards.children[1].className.includes('poker-card--back'), false);
  assert.equal(findSeatChild(losingSeat, 'poker-seat-settlement-badge'), undefined);
});

test('poker v2 keeps the previous reveal visible for the full local window before switching to the next hand', async () => {
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
          revealedShowdownParticipants: [
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
  assert.ok(findSeatChild(villainSeat, 'poker-seat-settlement-badge'));
  const villainCards = findSeatChild(villainSeat, 'poker-seat-cards');
  assert.ok(villainCards);
  assert.equal(villainCards.children.length, 2);
  assert.equal(villainCards.children[0].className.includes('poker-card--back'), false);
  assert.equal(villainCards.children[1].className.includes('poker-card--back'), false);
  assert.equal(harness.elements.pokerCommunityCards.children.length, 5);
  assert.equal(harness.elements.pokerHeroCards.children.length, 2);

  harness.advanceTime(4000);
  await harness.flush();

  const switchedVillainSeat = findSeatByLabel(harness, 'Villain 1');
  assert.equal(findSeatChild(switchedVillainSeat, 'poker-seat-settlement-badge'), undefined);
  const switchedVillainCards = findSeatChild(switchedVillainSeat, 'poker-seat-cards');
  assert.ok(switchedVillainCards);
  assert.equal(switchedVillainCards.children.length, 2);
  assert.equal(switchedVillainCards.children[0].className.includes('poker-card--back'), true);
  assert.equal(switchedVillainCards.children[1].className.includes('poker-card--back'), true);
  assert.equal(harness.elements.pokerCommunityCards.children.length, 0);
  assert.equal(harness.elements.pokerHeroCards.children.length, 2);
});

test('poker v2 does not switch away from the settled reveal scene before the local window ends', async () => {
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
          revealedShowdownParticipants: [
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

  assert.equal(harness.elements.pokerCommunityCards.children.length, 5, 'reveal board should stay visible until the local reveal window ends');
  const villainSeat = findSeatByLabel(harness, 'Villain 1');
  assert.ok(findSeatChild(villainSeat, 'poker-seat-settlement-badge'));
  const villainCards = findSeatChild(villainSeat, 'poker-seat-cards');
  assert.ok(villainCards);
  assert.equal(villainCards.children[0].className.includes('poker-card--back'), false);
  assert.equal(villainCards.children[1].className.includes('poker-card--back'), false);
});

test('poker v2 keeps showdown participant cards hidden when the hand ends without showdown comparison', async () => {
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
  const villainBadge = findSeatChild(villainSeat, 'poker-seat-settlement-badge');
  const villainCards = findSeatChild(villainSeat, 'poker-seat-cards');

  assert.equal(villainBadge, undefined, 'an all-folded legacy settlement must not invent an award badge');
  assert.equal(villainCards.children[0].className, 'poker-card poker-card--back');
  assert.equal(villainCards.children[1].className, 'poker-card poker-card--back');
});

test('poker v2 renders exact main, side, and returned awards and preserves them across omitted patch fields', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();
  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    initial: true,
    payload: {
      tableId: 'table-1',
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [
        { userId: 'user-1', seat: 1, displayName: 'Player A' },
        { userId: 'player-b', seat: 2, displayName: 'Player B' },
        { userId: 'player-c', seat: 3, displayName: 'Player C' }
      ] },
      public: {
        hand: { handId: 'hand-awards', status: 'SETTLED', dealerSeatNo: 1 },
        board: { cards: ['2H', '3H', '4H', '9C', 'KD'] },
        pot: { total: 0 },
        showdown: {
          handId: 'hand-awards',
          reason: 'computed',
          winners: ['user-1', 'player-b', 'player-c'],
          potAwardedTotal: 295,
          potsAwarded: [
            { amount: 288, winners: ['user-1'], eligibleUserIds: ['user-1', 'player-b', 'player-c'] },
            { amount: 6, winners: ['player-b'], eligibleUserIds: ['player-b', 'player-c'] },
            { amount: 1, winners: ['player-c'], eligibleUserIds: ['player-c'] }
          ]
        },
        handSettlement: { handId: 'hand-awards', settledAt: new Date(Date.now()).toISOString(), payouts: { 'user-1': 288, 'player-b': 6, 'player-c': 1 } }
      },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  const summary = findChildByClass(harness.elements.pokerCenterLayer, 'poker-settlement-summary');
  assert.ok(summary);
  assert.equal(summary.hidden, false);
  assert.deepEqual(summary.children.map((row) => row.children[0].textContent), ['Main pot 288', 'Side pot 1 6', 'Returned 1']);
  const heroSeat = harness.elements.pokerSeatLayer.children.find((node) => /poker-seat--hero/.test(node.className));
  const playerBSeat = findSeatByLabel(harness, 'Player B');
  const playerCSeat = findSeatByLabel(harness, 'Player C');
  assert.equal(findChildByClass(findSeatChild(heroSeat, 'poker-seat-settlement-badge'), 'poker-seat-settlement-award').textContent, '+288 Main pot');
  assert.equal(findChildByClass(findSeatChild(playerBSeat, 'poker-seat-settlement-badge'), 'poker-seat-settlement-award').textContent, '+6 Side pot 1');
  assert.equal(findChildByClass(findSeatChild(playerCSeat, 'poker-seat-settlement-badge'), 'poker-seat-settlement-award--return').textContent, '+1 Returned');
  assert.equal(/poker-seat--pot-winner/.test(playerCSeat.className), false, 'a return must not style the seat as a pot winner');
  assert.equal(harness.elements.pokerChipFxLayer.children.length, 0, 'initial settled snapshots stay static');

  ws.onSnapshot({ kind: 'statePatch', payload: { tableId: 'table-1', public: { pot: { total: 0 } } } });
  await harness.flush();
  assert.equal(summary.hidden, false);
  assert.equal(summary.children.length, 3, 'omitted settlement fields must preserve the presentation');

  ws.onSnapshot({ kind: 'statePatch', payload: { tableId: 'table-1', public: { showdown: null } } });
  await harness.flush();
  assert.equal(summary.hidden, true, 'an explicit clear must remove the presentation');
});

test('poker v2 animates a live per-pot settlement once and skips it for resync or reduced motion', async () => {
  async function settle(reducedMotion, statusBeforeSettlement){
    const harness = createHarness({ reducedMotion });
    harness.fireDomContentLoaded();
    await harness.flush();
    const ws = harness.getCreateOptions();
    ws.onSnapshot({
      kind: 'stateSnapshot',
      initial: true,
      payload: {
        tableId: 'table-1',
        table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [
          { userId: 'user-1', seat: 1, displayName: 'Player A' },
          { userId: 'player-b', seat: 2, displayName: 'Player B' }
        ] },
        public: { hand: { handId: 'hand-animation', status: 'RIVER' }, pot: { total: 20 }, stacks: { 'user-1': 90, 'player-b': 90 } },
        you: { seat: 1 }
      }
    });
    await harness.flush();
    const settlementPayload = {
      tableId: 'table-1',
      public: {
        hand: { handId: 'hand-animation', status: 'SETTLED' },
        pot: { total: 0 },
        showdown: { handId: 'hand-animation', reason: 'computed', winners: ['user-1', 'player-b'], potAwardedTotal: 20, potsAwarded: [{ amount: 18, winners: ['user-1'], eligibleUserIds: ['user-1', 'player-b'] }, { amount: 2, winners: ['player-b'], eligibleUserIds: ['player-b'] }] },
        handSettlement: { handId: 'hand-animation', settledAt: new Date(Date.now()).toISOString(), payouts: { 'user-1': 18, 'player-b': 2 } }
      }
    };
    if (statusBeforeSettlement){
      ws.onStatus(statusBeforeSettlement, {});
      ws.onSnapshot({ kind: 'statePatch', payload: { tableId: 'table-1', public: { pot: { total: 20 } } } });
      await harness.flush();
    }
    ws.onSnapshot({
      kind: 'stateSnapshot',
      payload: settlementPayload
    });
    await harness.flush();
    harness.advanceTime(0);
    await harness.flush();
    return { harness, settlementPayload };
  }

  const animatedResult = await settle(false);
  const animated = animatedResult.harness;
  assert.equal(animated.elements.pokerChipFxLayer.children.length > 0, true);
  assert.equal(animated.elements.pokerChipFxLayer.children.every((node) => node.classList.contains('poker-chip-fly--settlement')), true);
  assert.equal(animated.elements.pokerChipFxLayer.children.every((node) => node.style.animationDuration === '780ms'), true);
  const flyCount = animated.elements.pokerChipFxLayer.children.length;
  animated.getCreateOptions().onSnapshot({ kind: 'statePatch', payload: animatedResult.settlementPayload });
  await animated.flush();
  animated.advanceTime(0);
  await animated.flush();
  assert.equal(animated.elements.pokerChipFxLayer.children.length, flyCount, 'duplicate settlement patches must not replay chip flows');
  animated.getCreateOptions().onSnapshot({ kind: 'statePatch', payload: { tableId: 'table-1', public: { showdown: null } } });
  await animated.flush();
  assert.equal(animated.elements.pokerChipFxLayer.children.length, 0, 'explicit clear must remove already-running settlement chips');
  animated.advanceTime(1000);
  await animated.flush();
  assert.equal(animated.elements.pokerChipFxLayer.children.length, 0, 'cancelled later pots must not create new settlement chips');
  const disconnectResult = await settle(false);
  disconnectResult.harness.getCreateOptions().onStatus('reconnecting', {});
  await disconnectResult.harness.flush();
  assert.equal(disconnectResult.harness.elements.pokerChipFxLayer.children.length, 0, 'disconnect must remove already-running settlement chips');
  disconnectResult.harness.advanceTime(1000);
  await disconnectResult.harness.flush();
  assert.equal(disconnectResult.harness.elements.pokerChipFxLayer.children.length, 0, 'disconnect must keep later settlement pots cancelled');
  const resynced = (await settle(false, 'resync')).harness;
  const resyncedSummary = findChildByClass(resynced.elements.pokerCenterLayer, 'poker-settlement-summary');
  assert.equal(resyncedSummary.hidden, false, 'the authoritative settlement after a resync remains visible statically');
  assert.equal(resynced.elements.pokerChipFxLayer.children.length, 0, 'a resync snapshot must not replay settlement chips');
  const staticOnly = (await settle(true)).harness;
  assert.equal(staticOnly.elements.pokerChipFxLayer.children.length, 0);
});

test('poker v2 preserves a live settlement reveal received after the server timestamp window elapsed', async () => {
  const nowMs = 1_700_000_300_000;
  const harness = createHarness({ nowMs });
  harness.fireDomContentLoaded();
  await harness.flush();
  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    initial: true,
    payload: {
      tableId: 'table-1',
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [
        { userId: 'user-1', seat: 1, displayName: 'Player A' },
        { userId: 'player-b', seat: 2, displayName: 'Player B' }
      ] },
      public: { hand: { handId: 'hand-delayed-settlement', status: 'RIVER' }, pot: { total: 20 }, stacks: { 'user-1': 90, 'player-b': 90 } },
      you: { seat: 1 }
    }
  });
  await harness.flush();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      public: {
        hand: { handId: 'hand-delayed-settlement', status: 'SETTLED' },
        pot: { total: 0 },
        showdown: { handId: 'hand-delayed-settlement', reason: 'computed', winners: ['user-1'], potAwardedTotal: 20, potsAwarded: [{ amount: 20, winners: ['user-1'], eligibleUserIds: ['user-1', 'player-b'] }] },
        handSettlement: { handId: 'hand-delayed-settlement', settledAt: new Date(nowMs - 10_000).toISOString(), payouts: { 'user-1': 20 } }
      }
    }
  });
  await harness.flush();
  harness.advanceTime(0);
  await harness.flush();
  assert.equal(harness.elements.pokerChipFxLayer.children.length > 0, true, 'a delayed live stateSnapshot must still animate');

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      public: { hand: { handId: 'hand-after-delayed-settlement', status: 'PREFLOP' }, pot: { total: 3 } }
    }
  });
  await harness.flush();
  const summary = findChildByClass(harness.elements.pokerCenterLayer, 'poker-settlement-summary');
  assert.equal(summary.hidden, false, 'the next hand must wait for the local reveal window');

  harness.advanceTime(3999);
  await harness.flush();
  assert.equal(summary.hidden, false);
  harness.advanceTime(1);
  await harness.flush();
  assert.equal(summary.hidden, true, 'the queued next hand appears after the full local reveal window');
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

  harness.elements.pokerLobbyLink.click();
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

test('poker v2 retries leave once after stale session reconnect', async () => {
  const harness = createHarness({
    sendLeave(_payload, ctx){
      if (ctx.attempt === 1) {
        const err = new Error('STALE_SESSION');
        err.code = 'STALE_SESSION';
        return Promise.reject(err);
      }
      return Promise.resolve({ ok: true });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }],
        hand: { handId: 'hand-leave', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 4, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();
  await harness.flush();

  assert.equal(harness.leavePayloads.length, 1, 'first leave attempt fails with STALE_SESSION');

  // STALE_SESSION triggers a live-mode restart; fetch the CURRENT generation's
  // client and deliver a fresh authoritative snapshot to open the recovery gate.
  const currentWs = harness.getCreateOptions();
  currentWs.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }],
        hand: { handId: 'hand-leave-retry', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 4, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.leavePayloads.length, 2);
  assert.equal(harness.windowLocation.href, '/poker/');
});

test('poker v2 queued leave navigates to lobby immediately without waiting for leave ack', async () => {
  const harness = createHarness({
    sendLeaveQueued(_payload, ctx){
      return ctx.requestId || 'leave-v2-queued';
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }, { userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-immediate-leave', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-2', deadlineAt: Date.now() + 5000 },
        pot: { total: 10, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD'] },
        stacks: { 'user-1': 96, 'bot-2': 104 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  assert.equal(harness.leavePayloads.length, 1);
  assert.equal(harness.windowLocation.href, '/poker/');
});

test('poker v2 cancel leave keeps the player on the table and sends no leave payload', async () => {
  const harness = createHarness({
    sendLeaveQueued(){
      throw new Error('leave should not be queued on cancel');
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }, { userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-cancel-leave', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-2', deadlineAt: Date.now() + 5000 },
        pot: { total: 10, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD'] },
        stacks: { 'user-1': 96, 'bot-2': 104 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  harness.elements.pokerV2LeaveBtn.click();
  harness.elements.pokerV2LeaveConfirmCancel.click();
  await harness.flush();

  assert.equal(harness.elements.pokerV2LeaveConfirmModal.hidden, true);
  assert.equal(harness.leavePayloads.length, 0);
  assert.equal(harness.windowLocation.href, '');
});

test('poker v2 leaves cleanly before the first live snapshot even when the removal snapshot arrives first', async () => {
  let resolveLeave = null;
  const harness = createHarness({
    sendLeave(){
      return new Promise(function(resolve){ resolveLeave = resolve; });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  assert.equal(harness.leavePayloads.length, 1);
  assert.equal(harness.windowLocation.href, '', 'leave should stay pending until the client learns the seat is gone');

  // Fetch the CURRENT generation's client options after the leave-retry restart.
  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-2', seat: 2 }] },
      public: {
        seats: [{ userId: 'bot-2', seatNo: 2, status: 'ACTIVE' }],
        hand: { handId: 'hand-pre-snapshot-leave', status: 'SHOWDOWN', dealerSeatNo: 2 },
        pot: { total: 8, sidePots: [] },
        legalActions: { actions: [] }
      },
      private: { holeCards: [] },
      you: { seat: null }
    }
  });
  await harness.flush();

  assert.equal(harness.windowLocation.href, '/poker/');
  if (resolveLeave) resolveLeave({ ok: true });
});

test('poker v2 redirects to lobby when leave snapshot confirms the seat is gone even before leave promise resolves', async () => {
  var resolveLeave = null;
  const harness = createHarness({
    sendLeave(){
      return new Promise(function(resolve){ resolveLeave = resolve; });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }],
        hand: { handId: 'hand-leave', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 4, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [] },
      public: {
        seats: [],
        hand: { handId: 'hand-leave', status: 'LOBBY', dealerSeatNo: 1 },
        pot: { total: 0, sidePots: [] },
        legalActions: { actions: [] }
      },
      private: { holeCards: [] },
      you: { seat: null }
    }
  });
  await harness.flush();

  assert.equal(harness.windowLocation.href, '/poker/');
  if (resolveLeave) resolveLeave({ ok: true });
});

test('poker v2 call then leave returns to lobby while the remaining hand continues without the leaver', async () => {
  let resolveLeave = null;
  const harness = createHarness({
    sendLeave(){
      return new Promise(function(resolve){ resolveLeave = resolve; });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }, { userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-call-leave', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 6, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] },
        actionConstraints: { toCall: 2, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        stacks: { 'user-1': 98, 'bot-2': 102 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'Q', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  harness.elements.pokerV2PrimaryBtn.click();
  await harness.flush();
  confirmLeave(harness);
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-2', seat: 2 }] },
      public: {
        seats: [{ userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-call-leave', status: 'SHOWDOWN', dealerSeatNo: 1 },
        turn: { userId: null, deadlineAt: null },
        pot: { total: 8, sidePots: [] },
        legalActions: { actions: [] },
        stacks: { 'bot-2': 104 }
      },
      private: { holeCards: [] },
      you: { seat: null }
    }
  });
  await harness.flush();

  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-call-leave', action: 'CALL' }));
  assert.equal(harness.leavePayloads.length, 1);
  assert.equal(harness.windowLocation.href, '/poker/');
  if (resolveLeave) resolveLeave({ ok: true });
});

test('poker v2 fold then leave returns to lobby when settlement snapshot removes the player from view', async () => {
  let resolveLeave = null;
  const harness = createHarness({
    sendLeave(){
      return new Promise(function(resolve){ resolveLeave = resolve; });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }, { userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-fold-leave', status: 'RIVER', dealerSeatNo: 1 },
        turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 10, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD', 'CALL'] },
        actionConstraints: { toCall: 4, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
        stacks: { 'user-1': 96, 'bot-2': 104 }
      },
      private: { holeCards: [{ r: '9', s: 'S' }, { r: '9', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  harness.elements.pokerV2FoldBtn.click();
  await harness.flush();
  confirmLeave(harness);
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-2', seat: 2 }] },
      public: {
        seats: [{ userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-fold-leave', status: 'SETTLED', dealerSeatNo: 1 },
        turn: { userId: null, deadlineAt: null },
        pot: { total: 0, sidePots: [] },
        legalActions: { actions: [] },
        showdown: { handId: 'hand-fold-leave', winners: ['bot-2'], reason: 'computed', potsAwarded: [], potAwardedTotal: 10 },
        handSettlement: { handId: 'hand-fold-leave', settledAt: '2026-04-13T00:00:00.000Z', payouts: { 'bot-2': 10 } },
        stacks: { 'bot-2': 110 }
      },
      private: { holeCards: [] },
      you: { seat: null }
    }
  });
  await harness.flush();

  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-fold-leave', action: 'FOLD' }));
  assert.equal(harness.leavePayloads.length, 1);
  assert.equal(harness.windowLocation.href, '/poker/');
  if (resolveLeave) resolveLeave({ ok: true });
});

test('poker v2 redirects to lobby on deferred leave even if the snapshot still carries you.seat', async () => {
  let resolveLeave = null;
  const harness = createHarness({
    sendLeave(){
      return new Promise(function(resolve){ resolveLeave = resolve; });
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'user-1', seat: 1 }] },
      public: {
        seats: [{ userId: 'user-1', seatNo: 1, status: 'ACTIVE' }, { userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-retained-you-seat', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-2', deadlineAt: Date.now() + 5000 },
        pot: { total: 10, sidePots: [] },
        legalActions: { seat: 1, actions: ['FOLD'] },
        stacks: { 'user-1': 96, 'bot-2': 104 }
      },
      private: { holeCards: [{ r: '9', s: 'S' }, { r: '9', s: 'D' }] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-2', seat: 2 }] },
      public: {
        seats: [{ userId: 'bot-2', seatNo: 2, status: 'ACTIVE', isBot: true }],
        hand: { handId: 'hand-retained-you-seat', status: 'RIVER', dealerSeatNo: 1 },
        turn: { userId: 'bot-2', deadlineAt: Date.now() + 3000 },
        pot: { total: 10, sidePots: [] },
        legalActions: { seat: 1, actions: [] },
        stacks: { 'bot-2': 104 }
      },
      private: { holeCards: [] },
      you: { seat: 1 }
    }
  });
  await harness.flush();

  assert.equal(harness.windowLocation.href, '/poker/');
  if (resolveLeave) resolveLeave({ ok: true });
});

test('poker v2 snapshot recovery sends the first gameplay snapshot immediately after auth_ok with an active gate', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 40,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true }, { userId: 'user-1', seat: 4 }] },
      public: {
        hand: { handId: 'hand-recovery-immediate', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  ws.onStatus('reconnecting', { attempt: 1 });
  ws.onStatus('auth_ok', { roomId: 'table-1' });
  await harness.flush();

  // First requestGameplaySnapshot must be sent immediately — no 5s delay.
  assert.equal(harness.getSnapshotRequestCount(), 1, 'first snapshot recovery request is immediate');
  assert.equal(harness.elements.pokerV2JoinBtn.disabled, true, 'gate still blocks actions until snapshot arrives');

  // Delivering the fresh snapshot opens the gate and stops further retries.
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 41,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true }, { userId: 'user-1', seat: 4 }] },
      public: {
        hand: { handId: 'hand-recovery-immediate-2', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  harness.advanceTime(20000);
  await harness.flush();
  assert.equal(harness.getSnapshotRequestCount(), 1, 'no retry after gate already opened');
});

test('poker v2 resync runs bounded snapshot recovery: immediate request then max retries and controlled error', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 10,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true }, { userId: 'user-1', seat: 4 }] },
      public: {
        hand: { handId: 'hand-resync-bounded', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  ws.onStatus('resync', { reason: 'version_conflict' });
  await harness.flush();

  // resync must start bounded recovery: immediate request, not just one-shot.
  assert.equal(harness.getSnapshotRequestCount(), 1, 'resync sends first snapshot request immediately');
  assert.equal(harness.elements.pokerV2JoinBtn.disabled, true, 'resync gate blocks actions');

  // No snapshot arrives → up to SNAPSHOT_RECOVERY_MAX_ATTEMPTS (3) retries every 5s.
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  // attempts: 1 initial + 3 retries = 4 total requests.
  assert.equal(harness.getSnapshotRequestCount(), 4, 'bounded retries after resync');
  // The 4th timer observes the attempt cap and raises the controlled error.
  harness.advanceTime(5000);
  await harness.flush();
  assert.equal(harness.getSnapshotRequestCount(), 4, 'no request after retries exhausted');
  assert.match(harness.elements.pokerV2LiveStatus.textContent, /error|unavailable/i, 'controlled error after retries exhausted');
});

test('poker v2 late snapshot after recovery timeout restores live status and clears the timeout error', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 10,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true }, { userId: 'user-1', seat: 4 }] },
      public: {
        hand: { handId: 'hand-late-snapshot', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  // Server-initiated resync triggers bounded recovery.
  ws.onStatus('resync', { reason: 'version_conflict' });
  await harness.flush();
  assert.equal(harness.elements.pokerV2JoinBtn.disabled, true, 'resync gate blocks actions');

  // Exhaust the retries (1 immediate + 3 retries) and let the cap timer fire the timeout.
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  assert.equal(harness.getSnapshotRequestCount(), 4, 'bounded retries exhausted');
  assert.match(harness.elements.pokerV2LiveStatus.textContent, /error|unavailable/i, 'timeout raised');
  assert.match(harness.elements.pokerV2ErrorText.textContent, /Snapshot recovery timed out/);

  // A late valid authoritative snapshot arrives after the timeout.
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 11,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true }, { userId: 'user-1', seat: 4 }] },
      public: {
        hand: { handId: 'hand-late-snapshot-2', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  // Gate opens (status/error UI restored), even though the player is seated so
  // the join button stays disabled for the seated state.
  assert.match(harness.elements.pokerV2LiveStatus.textContent, /live/i, 'status back to live');
  assert.equal(harness.elements.pokerV2ErrorText.textContent.indexOf('Snapshot recovery timed out'), -1, 'timeout message cleared');
  assert.equal(harness.elements.pokerV2ErrorText.textContent.trim(), '', 'error text cleared');
});

test('poker v2 late snapshot does not clear a newer unrelated error raised after recovery timeout', async () => {
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.getCreateOptions();
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 10,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true }, { userId: 'user-1', seat: 4 }] },
      public: {
        hand: { handId: 'hand-newer-error', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  // Server-initiated resync triggers bounded recovery.
  ws.onStatus('resync', { reason: 'version_conflict' });
  await harness.flush();

  // Exhaust retries and let the cap timer raise the recovery timeout.
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  harness.advanceTime(5000);
  await harness.flush();
  assert.equal(harness.getSnapshotRequestCount(), 4, 'bounded retries exhausted');
  assert.match(harness.elements.pokerV2ErrorText.textContent, /Snapshot recovery timed out/);

  // A NEWER unrelated error arrives before the late snapshot.
  ws.onStatus('error', { code: 'newer_error' });
  await harness.flush();
  assert.match(harness.elements.pokerV2ErrorText.textContent, /newer_error/);

  // The late valid snapshot opens the gate but must NOT wipe the newer error.
  ws.onSnapshot({
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion: 11,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: [{ userId: 'bot-1', seat: 1, displayName: 'Bot 1', isBot: true }, { userId: 'user-1', seat: 4 }] },
      public: {
        hand: { handId: 'hand-newer-error-2', status: 'TURN', dealerSeatNo: 1 },
        turn: { userId: 'bot-1', deadlineAt: Date.now() + 5000 },
        pot: { total: 12, sidePots: [] },
        legalActions: { seat: 4, actions: [] },
        stacks: { 'bot-1': 100, 'user-1': 100 }
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }] },
      you: { seat: 4 }
    }
  });
  await harness.flush();

  assert.match(harness.elements.pokerV2ErrorText.textContent, /newer_error/, 'newer error preserved');
  assert.equal(harness.elements.pokerV2ErrorText.textContent.indexOf('Snapshot recovery timed out'), -1, 'old timeout message replaced by newer error');
});

function amountSnapshot({ handId, phase, board, potTotal, actions, constraints, stateVersion, turnUserId = 'user-1', bigBlind = null, stacks, projectedActions = null, youSeat = 1, members, holeCards }){
  const resolvedMembers = members === undefined ? [{ userId: 'user-1', seat: 1 }] : members;
  const resolvedPrivate = holeCards === null
    ? undefined
    : { holeCards: holeCards || [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }] };
  return {
    kind: 'stateSnapshot',
    payload: {
      tableId: 'table-1',
      stateVersion,
      table: { tableId: 'table-1', status: 'OPEN', maxSeats: 6, members: resolvedMembers },
      public: {
        hand: { handId, status: phase, dealerSeatNo: 2 },
        turn: { userId: turnUserId, deadlineAt: Date.now() + 5000 },
        board,
        pot: { total: potTotal, sidePots: [] },
        stacks: stacks || { 'user-1': 100 },
        ...(bigBlind != null ? { bigBlind } : {}),
        ...(projectedActions ? { projectedLegalActions: { seat: 1, actions: projectedActions } } : {}),
        legalActions: { seat: 1, actions },
        actionConstraints: constraints
      },
      ...(resolvedPrivate ? { private: resolvedPrivate } : {}),
      you: { seat: youSeat }
    }
  };
}

async function bootSeatedHarness(){
  const harness = createHarness();
  harness.fireDomContentLoaded();
  await harness.flush();
  const ws = harness.getCreateOptions();
  await waitFor(() => harness.elements.pokerV2JoinBtn.disabled === false);
  harness.elements.pokerV2SeatNo.value = '1';
  harness.elements.pokerV2JoinBtn.click();
  await harness.flush();
  return { harness, ws };
}

test('poker v2 amount slider reflects BET constraints (minBetAmount/maxBetAmount)', async () => {
  const { harness, ws } = await bootSeatedHarness();
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-bet-min',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 4
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountInput.min, '10', 'BET slider min should come from actionConstraints.minBetAmount');
  assert.equal(harness.elements.pokerV2AmountInput.max, '100', 'BET slider max should come from actionConstraints.maxBetAmount');
  const betValue = Number(harness.elements.pokerV2AmountInput.value);
  assert.ok(Number.isFinite(betValue) && betValue >= 10 && betValue <= 100, 'BET slider value should stay within the legal range');
});

test('poker v2 amount slider reflects RAISE constraints (minRaiseTo/maxRaiseTo)', async () => {
  const { harness, ws } = await bootSeatedHarness();
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-raise-min',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 20, maxRaiseTo: 90 },
    stateVersion: 5
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountInput.min, '20', 'RAISE slider min should come from actionConstraints.minRaiseTo');
  assert.equal(harness.elements.pokerV2AmountInput.max, '90', 'RAISE slider max should come from actionConstraints.maxRaiseTo');
  const raiseValue = Number(harness.elements.pokerV2AmountInput.value);
  assert.ok(Number.isFinite(raiseValue) && raiseValue >= 20 && raiseValue <= 90, 'RAISE slider value should stay within the legal range');
});

test('poker v2 amount button sends the selected legal boundary amount', async () => {
  const { harness, ws } = await bootSeatedHarness();

  ws.onSnapshot(amountSnapshot({
    handId: 'hand-amount-bet',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 6
  }));
  await harness.flush();

  harness.elements.pokerV2AmountInput.value = '10';
  harness.elements.pokerV2AmountBtn.click();
  await harness.flush();

  assert.equal(harness.actPayloads.length, 1);
  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-amount-bet', action: 'BET', amount: 10 }));

  ws.onSnapshot(amountSnapshot({
    handId: 'hand-amount-raise',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 20, maxRaiseTo: 90 },
    stateVersion: 7
  }));
  await harness.flush();

  harness.elements.pokerV2AmountInput.value = '90';
  harness.elements.pokerV2AmountBtn.click();
  await harness.flush();

  assert.equal(harness.actPayloads.length, 2);
  assert.equal(JSON.stringify(harness.actPayloads[1]), JSON.stringify({ handId: 'hand-amount-raise', action: 'RAISE', amount: 90 }));
});

test('poker v2 keeps the BET slider minimum across turns in the same hand', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // First BET turn: constraints carry minBetAmount=10.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-multiturn',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 8
  }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountInput.min, '10', 'first BET turn slider min should be minBetAmount');

  // The user submits a legal boundary bet.
  harness.elements.pokerV2AmountInput.value = '10';
  harness.elements.pokerV2AmountBtn.click();
  await harness.flush();
  assert.equal(harness.actPayloads.length, 1);
  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-multiturn', action: 'BET', amount: 10 }));

  // Subsequent snapshots from other players/street lead to another BET turn for
  // the same user in the same hand; the slider must keep the server minimum.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-multiturn',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 62,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 9
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountInput.min, '10', 'later BET turn must keep minBetAmount');
  const laterValue = Number(harness.elements.pokerV2AmountInput.value);
  assert.ok(Number.isFinite(laterValue) && laterValue >= 10, 'later BET turn slider value must stay within the legal range');
});

test('queued BET pre-action is cancelled when the authoritative minimum rises above it', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // Another player's turn; the projected constraints (real server path) give
  // the viewer a legal BET range of 10..100, so the slider cannot offer 1.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-queued-bet',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 10,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountInput.min, '10', 'projected BET minimum must be legal off-turn');
  assert.equal(harness.elements.pokerV2AmountPreaction.disabled, false, 'BET pre-action should be available off-turn');
  harness.elements.pokerV2AmountInput.value = '20';
  harness.elements.pokerV2AmountPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, true, 'queued BET 20 should be selected');

  // Authoritative turn arrives with a higher minimum: the queued 20 is illegal.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-queued-bet',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 30, maxBetAmount: 100 },
    stateVersion: 11
  }));
  await harness.flush();

  assert.equal(harness.actPayloads.length, 0, 'illegal queued BET must never be sent');
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, false, 'queued BET must be cancelled when the stored amount is out of range');
  assert.match(harness.elements.pokerV2ErrorText.textContent, /Pre-action cancelled: minimum bet is now 30\./, 'cancellation message must be shown');
  assert.equal(harness.elements.pokerV2AmountInput.min, '30', 'slider must sync back to the authoritative minimum');
  assert.equal(harness.elements.pokerV2AmountBtn.disabled, false, 'normal BET controls must remain active');
});

test('queued RAISE pre-action is cancelled when the authoritative minimum rises above it', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // Another player's turn facing a bet; the projected constraints (real server
  // path) give the viewer a legal RAISE range of 20..90.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-queued-raise',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 20, maxRaiseTo: 90 },
    stateVersion: 12,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountInput.min, '20', 'projected RAISE minimum must be legal off-turn');
  harness.elements.pokerV2AmountInput.value = '50';
  harness.elements.pokerV2AmountPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, true, 'queued RAISE 50 should be selected');

  // Authoritative turn arrives with a higher minimum: the queued 50 is illegal.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-queued-raise',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 80, maxRaiseTo: 90 },
    stateVersion: 13
  }));
  await harness.flush();

  assert.equal(harness.actPayloads.length, 0, 'illegal queued RAISE must never be sent');
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, false, 'queued RAISE must be cancelled when the stored amount is out of range');
  assert.match(harness.elements.pokerV2ErrorText.textContent, /Pre-action cancelled: minimum raise is now 80\./, 'cancellation message must be shown');
  assert.equal(harness.elements.pokerV2AmountInput.min, '80', 'slider must sync back to the authoritative raise minimum');
});

test('off-turn RAISE slider minimum comes from the projected snapshot constraints, never 1', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // The exact projected payload the room-core snapshot now emits for a seated
  // viewer who is not acting: real toCall/minRaiseTo/maxRaiseTo.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-raise-proj',
    phase: 'PREFLOP',
    board: [],
    potTotal: 6,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 2, minRaiseTo: 6, maxRaiseTo: 100, maxBetAmount: null, minBetAmount: null },
    bigBlind: 2,
    stateVersion: 20,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountInput.min, '6', 'off-turn RAISE min must be the real projected minimum raise-to');
  const raiseValue = Number(harness.elements.pokerV2AmountInput.value);
  assert.ok(raiseValue >= 6, 'off-turn RAISE slider value must stay within the legal range');
});

test('off-turn BET slider minimum comes from the big blind, never 1', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // Another player's turn; constraints carry no minBetAmount, so the BET min
  // must be derived from the authoritative bigBlind (10), not a generic 1.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-bb-min',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, maxBetAmount: 100 },
    bigBlind: 10,
    stateVersion: 14,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountInput.min, '10', 'off-turn BET min must be the big blind when minBetAmount is absent');
});

test('short stack below the big blind is represented as all-in off-turn', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // 7 CH with BB=10: an ordinary opening BET is impossible; the legal bet is
  // the all-in, so the ALL IN pre-action represents it and the BET amount
  // pre-action must not offer an ordinary selectable range.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-bb-short',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, maxBetAmount: 7 },
    bigBlind: 10,
    stacks: { 'user-1': 7 },
    stateVersion: 15,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountPreaction.disabled, true, 'ordinary BET pre-action must not be offered below the big blind');
  assert.equal(harness.elements.pokerV2AllInPreaction.disabled, false, 'all-in pre-action must represent the short-stack bet');
});

test('queued RAISE 100 executes unchanged when the live range becomes 80..200', async () => {
  const { harness, ws } = await bootSeatedHarness();

  ws.onSnapshot(amountSnapshot({
    handId: 'hand-raise-ok',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 50, maxRaiseTo: 200 },
    stateVersion: 16,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  harness.elements.pokerV2AmountInput.value = '100';
  harness.elements.pokerV2AmountPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, true, 'queued RAISE 100 should be selected');

  // Turn arrives: minimum raise is now 80, but 100 is still legal.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-raise-ok',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 80, maxRaiseTo: 200 },
    stateVersion: 17
  }));
  await harness.flush();

  assert.equal(harness.actPayloads.length, 1);
  assert.equal(JSON.stringify(harness.actPayloads[0]), JSON.stringify({ handId: 'hand-raise-ok', action: 'RAISE', amount: 100 }), 'legal queued amount must execute unchanged');
});

test('queued RAISE 100 is cancelled with a message when the live minimum becomes 120', async () => {
  const { harness, ws } = await bootSeatedHarness();

  ws.onSnapshot(amountSnapshot({
    handId: 'hand-raise-cancel',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 50, maxRaiseTo: 200 },
    stateVersion: 18,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  harness.elements.pokerV2AmountInput.value = '100';
  harness.elements.pokerV2AmountPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, true, 'queued RAISE 100 should be selected');

  // Turn arrives: minimum raise is now 120, so the queued 100 is illegal.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-raise-cancel',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 120, maxRaiseTo: 200 },
    stateVersion: 19
  }));
  await harness.flush();

  assert.equal(harness.actPayloads.length, 0, 'cancelled queued RAISE must never be sent (no silent 100->120)');
  assert.equal(harness.elements.pokerV2AmountPreaction.checked, false, 'queued RAISE must be cancelled');
  assert.match(harness.elements.pokerV2ErrorText.textContent, /Pre-action cancelled: minimum raise is now 120\./, 'cancellation message must be shown');
});

test('off-turn RAISE stays disabled when the server projection withholds raising rights', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // Real projected room-core payload: the viewer already acted, lastRaiseSize
  // is 10, a cumulative short all-in left toCall 5, and reopening rights are
  // closed -> projectedLegalActions has no RAISE and minRaiseTo is null while
  // maxRaiseTo stays numeric.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-no-raise',
    phase: 'TURN',
    board: ['As', 'Kd', 'Qc', '3h'],
    potTotal: 60,
    actions: ['FOLD'],
    constraints: { toCall: 5, minRaiseTo: null, maxRaiseTo: 110, maxBetAmount: null, minBetAmount: null },
    projectedActions: ['FOLD', 'CALL'],
    bigBlind: 10,
    stacks: { 'user-1': 90 },
    stateVersion: 21,
    turnUserId: 'villain-1'
  }));
  await harness.flush();

  assert.equal(harness.elements.pokerV2AmountPreaction.disabled, true, 'RAISE pre-action must stay disabled without reopening rights');

  // ALL IN cannot bypass the closed raising rights: with stack (90) above
  // toCall (5) and no RAISE/BET in the projection, an all-in would be an
  // illegal raise to 90, so the pre-action must be disabled and unqueueable.
  assert.equal(harness.elements.pokerV2AllInPreaction.disabled, true, 'ALL IN pre-action must be disabled when it would be an illegal raise');
  harness.elements.pokerV2AllInPreaction.click();
  await harness.flush();
  assert.equal(harness.elements.pokerV2AllInPreaction.checked, false, 'ALL IN must not be queueable');
  assert.equal(harness.actPayloads.length, 0, 'no action may be sent from the disabled pre-actions');
});

test('poker v2 shows the current slider amount on Bet/Raise buttons', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // 1. BET shows the current slider value.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-btn-amounts',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 30
  }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountBtn.textContent, 'Bet (20)', 'BET button must show the current slider value');

  // 2. The input event updates the label immediately while the slider moves.
  harness.elements.pokerV2AmountInput.value = '45';
  (harness.elements.pokerV2AmountInput._listeners.input || []).forEach((fn) => fn({ target: harness.elements.pokerV2AmountInput }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountBtn.textContent, 'Bet (45)', 'input event must update the label immediately');

  // 3. Snapshot-driven clamp synchronizes slider and label to the same value.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-btn-amounts',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 60, maxBetAmount: 100 },
    stateVersion: 31
  }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountInput.value, '60', 'slider must clamp to the new minimum');
  assert.equal(harness.elements.pokerV2AmountBtn.textContent, 'Bet (60)', 'label must follow the clamped slider value');

  // 4. Switching to RAISE shows the exact raise-to amount.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-btn-amounts',
    phase: 'TURN',
    board: ['As', 'Kd', '3h', '2c'],
    potTotal: 60,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 10, minRaiseTo: 80, maxRaiseTo: 200 },
    stateVersion: 32
  }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountInput.min, '80', 'raise slider min should come from minRaiseTo');
  assert.equal(harness.elements.pokerV2AmountBtn.textContent, 'Raise (80)', 'RAISE button must show the exact raise-to value');

  harness.elements.pokerV2AmountInput.value = '120';
  (harness.elements.pokerV2AmountInput._listeners.input || []).forEach((fn) => fn({ target: harness.elements.pokerV2AmountInput }));
  await harness.flush();
  assert.equal(harness.elements.pokerV2AmountBtn.textContent, 'Raise (120)', 'RAISE label must follow the slider');
});

test('poker v2 clears stale private hole cards when a full snapshot removes the user seat', async () => {
  const { harness, ws } = await bootSeatedHarness();

  // Seated with private cards in an active hand.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-stale-1',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 40,
    holeCards: ['3C', '7S']
  }));
  await harness.flush();
  assert.equal(harness.elements.pokerHeroCards.hidden, false, 'seated user should see the hero cards area');
  assert.equal(harness.elements.pokerHeroCards.children.length, 2);
  assert.ok(harness.elements.pokerHeroCards.children.every((child) => !/poker-card--back/.test(child.className)), 'seated user should see face-up cards');

  // Reconnect full authoritative snapshot: the user no longer has a seat and
  // the private branch is absent — stale cards must be cleared from state.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-stale-1',
    phase: 'FLOP',
    board: ['As', 'Kd', '3h'],
    potTotal: 42,
    actions: ['FOLD', 'CHECK', 'BET'],
    constraints: { toCall: 0, minBetAmount: 10, maxBetAmount: 100 },
    stateVersion: 41,
    youSeat: null,
    members: [],
    holeCards: null
  }));
  await harness.flush();
  assert.equal(harness.elements.pokerHeroCards.hidden, true, 'hero cards must be hidden without a seat');

  // A new hand where the user is seated again but has no private cards yet:
  // the stale 3C/7S must never reappear — only the standard face-down
  // placeholders are rendered.
  ws.onSnapshot(amountSnapshot({
    handId: 'hand-stale-2',
    phase: 'PREFLOP',
    board: [],
    potTotal: 3,
    actions: ['FOLD', 'CALL', 'RAISE'],
    constraints: { toCall: 2, minRaiseTo: 4, maxRaiseTo: 100 },
    stateVersion: 42,
    holeCards: null
  }));
  await harness.flush();
  assert.equal(harness.elements.pokerHeroCards.hidden, false, 'seated user keeps the hero cards area');
  assert.equal(harness.elements.pokerHeroCards.children.length, 2, 'two placeholders');
  assert.ok(harness.elements.pokerHeroCards.children.every((child) => /poker-card--back/.test(child.className)), 'placeholders must be face-down, not the stale 3C/7S cards');
});
