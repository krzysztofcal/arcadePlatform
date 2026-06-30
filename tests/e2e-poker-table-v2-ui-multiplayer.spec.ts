import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

// UI-level fake WS harness: this spec exercises poker/table-v2.html and poker-v2.js
// with isolated browser contexts, but replaces poker-ws-client.js with an in-memory
// test transport. It is not a real WS protocol or bot-strategy E2E test.

type Player = {
  name: string;
  userId: string;
  token: string;
  context: BrowserContext;
  page: Page;
};

type Seat = {
  seatNo: number;
  userId: string;
  displayName: string;
  status: string;
};

function base64Url(input: string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function makeToken(userId: string) {
  return `${base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64Url(JSON.stringify({ sub: userId }))}.sig`;
}

function pokerWsClientShim() {
  return `
(function(){
  function player(){
    return window.__POKER_E2E_PLAYER__ || { userId: 'unknown-user', name: 'Unknown' };
  }
  function command(op, payload){
    if (typeof window.__pokerE2eCommand !== 'function') return Promise.reject(new Error('missing_e2e_binding'));
    var p = player();
    return window.__pokerE2eCommand(Object.assign({ op: op, userId: p.userId, name: p.name }, payload || {}));
  }
  window.__pokerE2eEmitSnapshot = function(payload){
    window.__POKER_E2E_LAST_SNAPSHOT__ = payload;
    if (window.__POKER_E2E_CLIENT__ && typeof window.__POKER_E2E_CLIENT__.onSnapshot === 'function') {
      window.__POKER_E2E_CLIENT__.onSnapshot({ kind: 'stateSnapshot', payload: payload });
    }
  };
  window.PokerWsClient = {
    create: function(opts){
      var ready = false;
      var client = {
        onSnapshot: opts && opts.onSnapshot,
        start: function(){
          command('register', { tableId: opts && opts.tableId }).then(function(res){
            ready = true;
            if (opts && typeof opts.onStatus === 'function') opts.onStatus('auth_ok', { roomId: opts.tableId });
            if (res && res.snapshot) window.__pokerE2eEmitSnapshot(res.snapshot);
          }).catch(function(err){
            if (opts && typeof opts.onProtocolError === 'function') opts.onProtocolError({ code: err && err.message ? err.message : 'register_failed' });
          });
        },
        destroy: function(){ ready = false; },
        isReady: function(){ return ready; },
        sendJoin: function(payload){ return command('join', payload); },
        sendAct: function(payload){ return command('act', payload); },
        sendLeave: function(payload){ return command('leave', payload); },
        sendLeaveQueued: function(payload){ command('leave', payload).catch(function(){}); return 'leave_queued'; },
        sendStartHand: function(payload){ return command('start_hand', payload); },
        requestGameplaySnapshot: function(){ return command('snapshot', {}).then(function(res){ if (res && res.snapshot) window.__pokerE2eEmitSnapshot(res.snapshot); return res; }); },
        requestResync: function(){ return command('snapshot', {}).then(function(res){ if (res && res.snapshot) window.__pokerE2eEmitSnapshot(res.snapshot); return res; }); }
      };
      window.__POKER_E2E_CLIENT__ = client;
      return client;
    }
  };
})();`;
}

class PokerE2eRoom {
  readonly tableId = `e2e-table-${Date.now().toString(36)}`;
  readonly maxSeats = 6;
  private players = new Map<string, { page: Page | null; name: string; joined: boolean }>();
  private seats: Seat[] = [];
  private stacks: Record<string, number> = {};
  private potTotal = 0;
  private phase = 'LOBBY';
  private handId: string | null = null;
  private turnUserId: string | null = null;
  private lastActionByUserId: Record<string, string> = {};

  setPage(userId: string, name: string, page: Page) {
    this.players.set(userId, { page, name, joined: false });
  }

  async handle(source: { page: Page }, payload: any) {
    const userId = String(payload?.userId || '');
    const name = String(payload?.name || userId || 'Player');
    const existing = this.players.get(userId) || { page: source.page, name, joined: false };
    existing.page = source.page;
    existing.name = name;
    this.players.set(userId, existing);

    if (payload?.op === 'register' || payload?.op === 'snapshot') {
      return { ok: true, snapshot: this.snapshotFor(userId) };
    }
    if (payload?.op === 'join') {
      this.join(userId, name);
      await this.broadcast();
      return { ok: true, seatNo: this.seats.find((seat) => seat.userId === userId)?.seatNo };
    }
    if (payload?.op === 'act') {
      this.act(userId, payload);
      await this.broadcast();
      return { ok: true };
    }
    if (payload?.op === 'leave') {
      this.leave(userId);
      await this.broadcast();
      return { ok: true };
    }
    if (payload?.op === 'start_hand') {
      this.startHandIfReady();
      await this.broadcast();
      return { ok: true };
    }
    return { ok: true };
  }

  private join(userId: string, name: string) {
    if (this.seats.some((seat) => seat.userId === userId)) return;
    const occupied = new Set(this.seats.map((seat) => seat.seatNo));
    let seatNo = 1;
    while (occupied.has(seatNo)) seatNo += 1;
    this.seats.push({ seatNo, userId, displayName: name, status: 'ACTIVE' });
    this.seats.sort((left, right) => left.seatNo - right.seatNo);
    this.stacks[userId] = 100;
    const player = this.players.get(userId);
    if (player) player.joined = true;
    this.startHandIfReady();
  }

  private leave(userId: string) {
    this.seats = this.seats.filter((seat) => seat.userId !== userId);
    delete this.stacks[userId];
    delete this.lastActionByUserId[userId];
    const player = this.players.get(userId);
    if (player) player.joined = false;
    if (this.turnUserId === userId) this.turnUserId = this.seats[0]?.userId || null;
    if (this.seats.length < 2) {
      this.phase = 'LOBBY';
      this.handId = null;
      this.turnUserId = null;
      this.potTotal = 0;
      this.lastActionByUserId = {};
    }
  }

  private startHandIfReady() {
    if (this.seats.length < 2 || this.handId) return;
    this.phase = 'PREFLOP';
    this.handId = `${this.tableId}-hand-1`;
    this.turnUserId = this.seats[0].userId;
    this.potTotal = 0;
  }

  private act(userId: string, payload: any) {
    if (userId !== this.turnUserId || !this.handId) throw new Error('not_users_turn');
    const action = String(payload?.action || '').toUpperCase();
    if (!['CHECK', 'CALL', 'BET', 'FOLD'].includes(action)) throw new Error('action_not_allowed');
    if (action === 'BET') {
      const amount = Math.max(1, Math.trunc(Number(payload?.amount) || 1));
      this.potTotal += amount;
      this.stacks[userId] = Math.max(0, (this.stacks[userId] || 0) - amount);
      this.lastActionByUserId[userId] = 'raise';
    } else {
      this.lastActionByUserId[userId] = action.toLowerCase();
    }
    const index = this.seats.findIndex((seat) => seat.userId === userId);
    const nextSeat = this.seats[(index + 1) % this.seats.length];
    this.turnUserId = nextSeat?.userId || null;
  }

  private snapshotFor(viewerUserId: string) {
    const legalActions = viewerUserId === this.turnUserId && this.handId ? ['FOLD', 'CHECK', 'BET'] : [];
    return {
      tableId: this.tableId,
      table: {
        tableId: this.tableId,
        status: 'OPEN',
        maxSeats: this.maxSeats,
        members: this.seats.map((seat) => ({
          seat: seat.seatNo,
          seatNo: seat.seatNo,
          userId: seat.userId,
          displayName: seat.displayName,
          status: seat.status,
          isBot: false,
        })),
      },
      public: {
        hand: this.handId ? { handId: this.handId, status: this.phase, dealerSeatNo: 1 } : { status: this.phase },
        turn: this.turnUserId ? { userId: this.turnUserId, startedAt: Date.now(), deadlineAt: Date.now() + 30_000 } : { userId: null },
        pot: { total: this.potTotal, sidePots: [] },
        legalActions: { actions: legalActions },
        actionConstraints: { toCall: 0, maxBetAmount: 20 },
        lastBettingRoundActionByUserId: this.lastActionByUserId,
      },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'D' }] },
      you: {
        seat: this.seats.find((seat) => seat.userId === viewerUserId)?.seatNo ?? null,
      },
    };
  }

  private async broadcast() {
    await Promise.all(
      Array.from(this.players.entries()).map(async ([userId, player]) => {
        if (!player.page || player.page.isClosed()) return;
        await player.page.evaluate((snapshot) => {
          (window as any).__pokerE2eEmitSnapshot?.(snapshot);
        }, this.snapshotFor(userId));
      })
    );
  }
}

async function createRealPlayer(browser: Browser, room: PokerE2eRoom, name: string, index: number): Promise<Player> {
  const userId = `e2e-real-player-${index}-${Date.now().toString(36)}`;
  const token = makeToken(userId);
  const context = await browser.newContext();

  await context.route('**/poker/poker-ws-client.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: pokerWsClientShim() });
  });
  await context.route('**/*supabase-js*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.supabase = window.supabase || {};' });
  });
  await context.exposeBinding('__pokerE2eCommand', (source, payload) => room.handle(source, payload));
  await context.addInitScript(({ userId, name, token }) => {
    (window as any).__POKER_E2E_PLAYER__ = { userId, name };
    try {
      localStorage.setItem('poker-e2e-user', userId);
      sessionStorage.setItem('poker-e2e-user', userId);
    } catch {}
    const session = {
      access_token: token,
      user: { id: userId, email: `${userId}@example.test`, user_metadata: { name } },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    (window as any).supabase = {
      createClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          },
        };
      },
    };
    (window as any).SupabaseAuthBridge = { getAccessToken: async () => token };
    (window as any).SupabaseAuth = {
      onAuthChange(callback: any) {
        if (typeof callback === 'function') setTimeout(() => callback('SIGNED_IN', session.user, session), 0);
        return () => {};
      },
    };
  }, { userId, name, token });

  const page = await context.newPage();
  room.setPage(userId, name, page);
  return { name, userId, token, context, page };
}

async function openPokerTable(player: Player, tableId: string) {
  await player.page.goto(`/poker/table-v2.html?tableId=${encodeURIComponent(tableId)}`, { waitUntil: 'domcontentloaded' });
  await expect(player.page.locator('#pokerTableScreen')).toHaveAttribute('data-boot-ready', '1');
  await expect(player.page.locator('#pokerV2LiveStatus')).toHaveText('Live table connected');
}

async function joinPokerTable(player: Player) {
  await expect(player.page.locator('#pokerV2JoinBtn')).toBeEnabled();
  await player.page.locator('#pokerV2JoinBtn').click();
  await expect(player.page.locator('#pokerV2JoinBtn')).toHaveText('Joined');
}

async function readVisiblePokerState(page: Page) {
  return page.evaluate(() => {
    const text = (selector: string) => (document.querySelector(selector)?.textContent || '').trim();
    const seatNodes = Array.from(document.querySelectorAll('#pokerSeatLayer .poker-seat'));
    const occupiedSlots = seatNodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => !node.classList.contains('poker-seat--empty'));
    return {
      tableId: new URLSearchParams(window.location.search).get('tableId'),
      tableMeta: text('#pokerV2TableMeta'),
      phase: text('#pokerV2TableMeta').split('•').map((part) => part.trim())[1] || '',
      pot: Number((text('#pokerPotPill').match(/\d[\d,]*/) || ['0'])[0].replace(/,/g, '')),
      occupiedSeatCount: occupiedSlots.length,
      occupiedSlots: occupiedSlots.map(({ index }) => index),
      seatNames: occupiedSlots.map(({ node }) => (node.querySelector('.poker-seat-name')?.textContent || '').trim()),
      activeSeatCount: seatNodes.filter((node) => node.classList.contains('poker-seat--active')).length,
      turnText: text('#pokerV2TurnText'),
      visibleActions: ['#pokerV2PrimaryBtn', '#pokerV2AmountBtn', '#pokerV2FoldBtn']
        .map((selector) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          return el && !el.hidden && !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none'
            ? (el.textContent || '').trim()
            : '';
        })
        .filter(Boolean),
      storageUser: localStorage.getItem('poker-e2e-user'),
      sessionUser: sessionStorage.getItem('poker-e2e-user'),
    };
  });
}

async function expectPokerStatesToConverge(players: Player[], expectedSeats: number) {
  await expect
    .poll(async () => {
      const states = await Promise.all(players.map((player) => readVisiblePokerState(player.page)));
      const first = states[0];
      return states.every((state) => (
        state.tableId === first.tableId &&
        state.phase === first.phase &&
        state.pot === first.pot &&
        state.occupiedSeatCount === expectedSeats &&
        state.occupiedSeatCount === first.occupiedSeatCount &&
        new Set(state.occupiedSlots).size === state.occupiedSlots.length &&
        state.activeSeatCount === 1
      ));
    }, { timeout: 5_000, intervals: [100, 200, 300] })
    .toBe(true);
}

async function performFirstSafeLegalAction(player: Player) {
  await expect
    .poll(async () => (await readVisiblePokerState(player.page)).visibleActions, {
      timeout: 5_000,
      intervals: [100, 200, 300],
    })
    .toContain('Check');

  const primary = player.page.locator('#pokerV2PrimaryBtn');
  const amount = player.page.locator('#pokerV2AmountBtn');
  const fold = player.page.locator('#pokerV2FoldBtn');

  if (await primary.isVisible()) {
    const label = (await primary.innerText()).trim();
    if (label === 'Check' || /^Call\b/.test(label)) {
      await primary.click();
      return label;
    }
  }
  if (await amount.isVisible()) {
    await player.page.locator('#pokerV2AmountInput').fill('1');
    const label = (await amount.innerText()).trim();
    await amount.click();
    return label;
  }
  await fold.click();
  return 'Fold';
}

async function cleanupPlayers(players: Player[]) {
  await Promise.all(players.map(async (player) => {
    try {
      const leave = player.page.locator('#pokerV2LeaveBtn');
      if (await leave.isVisible()) {
        await leave.click();
        await player.page.locator('#pokerV2LeaveConfirmYes').click();
      }
    } catch {}
  }));
  await Promise.all(players.map((player) => player.context.close().catch(() => {})));
}

test('UI fake WS: 2 isolated browser users join one table and converge after one action', async ({ browser }) => {
  const room = new PokerE2eRoom();
  const players = [
    await createRealPlayer(browser, room, 'Player One', 1),
    await createRealPlayer(browser, room, 'Player Two', 2),
  ];

  try {
    await Promise.all(players.map((player) => openPokerTable(player, room.tableId)));

    const identities = await Promise.all(players.map((player) => readVisiblePokerState(player.page)));
    expect(identities[0].storageUser).toBe(players[0].userId);
    expect(identities[1].storageUser).toBe(players[1].userId);
    expect(identities[0].storageUser).not.toBe(identities[1].storageUser);
    expect(identities[0].sessionUser).not.toBe(identities[1].sessionUser);

    await joinPokerTable(players[0]);
    await joinPokerTable(players[1]);

    await expectPokerStatesToConverge(players, 2);

    const beforeAction = await readVisiblePokerState(players[1].page);
    expect(beforeAction.tableId).toBe(room.tableId);
    expect(beforeAction.seatNames).toContain('Player One');
    expect(beforeAction.seatNames).toContain('You');
    expect(beforeAction.occupiedSeatCount).toBe(2);

    const action = await performFirstSafeLegalAction(players[0]);
    expect(action).toBe('Check');

    await expect
      .poll(async () => readVisiblePokerState(players[1].page), {
        timeout: 5_000,
        intervals: [100, 200, 300],
      })
      .toMatchObject({ turnText: 'Your turn.', occupiedSeatCount: 2 });

    await expectPokerStatesToConverge(players, 2);
    const afterStates = await Promise.all(players.map((player) => readVisiblePokerState(player.page)));
    expect(afterStates[0].phase).toBe(afterStates[1].phase);
    expect(afterStates[0].pot).toBe(afterStates[1].pot);
    expect(afterStates[0].occupiedSeatCount).toBe(afterStates[1].occupiedSeatCount);
    expect(afterStates[0].turnText).toContain('Acting:');
    expect(afterStates[1].turnText).toBe('Your turn.');
  } finally {
    await cleanupPlayers(players);
  }
});

test('UI fake WS: 3 isolated browser users join one table and converge', async ({ browser }) => {
  const room = new PokerE2eRoom();
  const players = [
    await createRealPlayer(browser, room, 'Player One', 1),
    await createRealPlayer(browser, room, 'Player Two', 2),
    await createRealPlayer(browser, room, 'Player Three', 3),
  ];

  try {
    await Promise.all(players.map((player) => openPokerTable(player, room.tableId)));

    const identities = await Promise.all(players.map((player) => readVisiblePokerState(player.page)));
    expect(new Set(identities.map((state) => state.storageUser)).size).toBe(3);
    expect(new Set(identities.map((state) => state.sessionUser)).size).toBe(3);

    for (const player of players) {
      await joinPokerTable(player);
    }

    await expectPokerStatesToConverge(players, 3);
    const states = await Promise.all(players.map((player) => readVisiblePokerState(player.page)));
    expect(states.every((state) => state.tableId === room.tableId)).toBe(true);
    expect(states.every((state) => state.occupiedSeatCount === 3)).toBe(true);
    expect(states.every((state) => new Set(state.occupiedSlots).size === 3)).toBe(true);
    expect(new Set(states.map((state) => `${state.phase}:${state.pot}:${state.occupiedSeatCount}`)).size).toBe(1);
  } finally {
    await cleanupPlayers(players);
  }
});
