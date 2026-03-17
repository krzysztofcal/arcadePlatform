import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function makeElement(id){
  return {
    id,
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '0',
    className: '',
    classList: {
      add(){},
      remove(){},
      contains(){ return false; }
    },
    disabled: false,
    dataset: {},
    style: {},
    children: [],
    parentNode: null,
    appendChild(child){ this.children.push(child); return child; },
    removeChild(child){ this.children = this.children.filter((it) => it !== child); },
    setAttribute(){},
    removeAttribute(){},
    _listeners: {},
    addEventListener(type, fn){ this._listeners[type] = this._listeners[type] || []; this._listeners[type].push(fn); },
    removeEventListener(type, fn){ if (!this._listeners[type]) return; this._listeners[type] = this._listeners[type].filter((h) => h !== fn); },
    querySelector(){ return null; },
    focus(){},
    blur(){},
    click(){
      var handlers = this._listeners.click || [];
      handlers.forEach((fn) => fn({ preventDefault(){}, stopPropagation(){}, target: this }));
    },
  };
}

export function createPokerTableHarness(options = {}){
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, 'poker/poker.js'), 'utf8');
  const tableId = options.tableId || 'table-1';
  const fetchState = {
    getCalls: 0,
    heartbeatCalls: 0,
    joinCalls: 0,
    joinBodies: [],
    startHandCalls: 0,
    actCalls: 0,
    responses: options.responses || [
      {
        tableId,
        status: 'OPEN',
        maxPlayers: 6,
        seats: [],
        legalActions: [],
        actionConstraints: {},
        state: { version: 1, state: { phase: 'PREFLOP', pot: 10, community: [] } },
      },
    ],
  };

  const elementIds = [
    'pokerError', 'pokerAuthMsg', 'pokerTableContent', 'pokerTableId', 'pokerStakes', 'pokerStatus', 'pokerSeatsGrid', 'pokerTurnTimer',
    'pokerJoin', 'pokerLeave', 'pokerJoinStatus', 'pokerLeaveStatus', 'pokerSeatNo', 'pokerBuyIn', 'pokerYourStack', 'pokerPot', 'pokerPhase',
    'pokerVersion', 'pokerMyCards', 'pokerMyCardsStatus', 'pokerJsonToggle', 'pokerJsonBox', 'pokerSignIn', 'pokerStartHandBtn',
    'pokerStartHandStatus', 'pokerActionsRow', 'pokerActAmountWrap', 'pokerActAmount', 'pokerActCheckBtn', 'pokerActCallBtn', 'pokerActFoldBtn',
    'pokerActBetBtn', 'pokerActRaiseBtn', 'pokerActStatus', 'pokerCopyLogBtn', 'pokerCopyLogStatus', 'pokerDevActionsPanel', 'pokerBoard',
    'pokerPhaseLabel', 'showdownPanel', 'showdownWinners', 'showdownPots', 'showdownTotalRow', 'showdownTotal', 'showdownMeta'
  ];
  const elements = {};
  elementIds.forEach((id) => { elements[id] = makeElement(id); });
  elements.pokerActAmountWrap.parentNode = { insertBefore(){} };
  elements.pokerSeatNo.value = '0';
  elements.pokerBuyIn.value = '100';

  const windowEvents = {};
  const documentEvents = {};
  let timeoutSeq = 1;
  const timeouts = new Map();
  const clearTimeoutCalls = [];
  const wsCreates = [];
  const wsDestroys = [];
  const logs = [];

  const wsFactory = options.wsFactory || function wsFactoryDefault(createOptions){
    const client = {
      start(){},
      destroy(){ wsDestroys.push(createOptions); },
    };
    wsCreates.push({ options: createOptions, client });
    return client;
  };

  const sandbox = {
    window: {
      location: { pathname: '/poker/table.html', search: typeof options.search === 'string' ? options.search : ('?tableId=' + encodeURIComponent(tableId)), href: '' },
      addEventListener(type, fn){ windowEvents[type] = windowEvents[type] || []; windowEvents[type].push(fn); },
      removeEventListener(){},
      KLog: { log: (kind, data) => logs.push({ kind, data: data || {} }) },
      __RUNNING_POKER_UI_TESTS__: false,
      SupabaseAuthBridge: { getAccessToken: async () => 'aaa.' + Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64') + '.zzz' },
      PokerWsClient: options.disableWsClient ? null : { create: (createOptions) => wsFactory(createOptions) },
      PokerRealtime: { subscribeToTableActions: () => ({ stop(){} }) },
    },
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      body: makeElement('body'),
      addEventListener(type, fn){ documentEvents[type] = documentEvents[type] || []; documentEvents[type].push(fn); },
      removeEventListener(){},
      getElementById(id){ return elements[id] || null; },
      createElement(tag){ return makeElement(tag); },
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    URLSearchParams,
    Date,
    Math,
    Buffer,
    setTimeout(fn){ const id = timeoutSeq++; timeouts.set(id, fn); return id; },
    clearTimeout(id){ clearTimeoutCalls.push(id); timeouts.delete(id); },
    setInterval(){ return 999; },
    clearInterval(){},
    fetch: async (url, opts) => {
      const text = String(url || '');
      if (text.includes('/poker-get-table')){
        fetchState.getCalls += 1;
        const index = Math.min(fetchState.getCalls - 1, fetchState.responses.length - 1);
        return { ok: true, json: async () => fetchState.responses[index] };
      }
      if (text.includes('/poker-heartbeat')){
        fetchState.heartbeatCalls += 1;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (text.includes('/poker-join')){
        fetchState.joinCalls += 1;
        const bodyRaw = opts && opts.body;
        if (typeof bodyRaw === 'string') {
          try { fetchState.joinBodies.push(JSON.parse(bodyRaw)); } catch (_err) { fetchState.joinBodies.push(null); }
        } else {
          fetchState.joinBodies.push(null);
        }
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (text.includes('/poker-start-hand')){
        fetchState.startHandCalls += 1;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (text.includes('/poker-act')){
        fetchState.actCalls += 1;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (text.includes('/ws-mint-token')){
        return { ok: true, json: async () => ({ ok: true, token: 'mint' }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    },
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
  };

  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.fetch = sandbox.fetch;
  sandbox.window.atob = sandbox.atob;
  sandbox.window.btoa = sandbox.btoa;
  sandbox.window.navigator = { userAgent: 'node' };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'poker/poker.js' });

  function fireDomContentLoaded(){
    const handlers = documentEvents.DOMContentLoaded || [];
    handlers.forEach((fn) => fn());
  }

  function fireWindowEvent(type){
    const handlers = windowEvents[type] || [];
    handlers.forEach((fn) => fn());
  }

  function fireDocumentEvent(type){
    const handlers = documentEvents[type] || [];
    handlers.forEach((fn) => fn());
  }

  async function flush(){
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    elements,
    fetchState,
    wsCreates,
    wsDestroys,
    logs,
    clearTimeoutCalls,
    getScheduledTimeoutCount(){ return timeouts.size; },
    fireDomContentLoaded,
    fireWindowEvent,
    fireDocumentEvent,
    setVisibility(state){ sandbox.document.visibilityState = state; },
    flush,
  };
}
