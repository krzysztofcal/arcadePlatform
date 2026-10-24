import { buildBootstrappedPokerState } from '../../ws-server/poker/engine/poker-engine.mjs';
import { applyAction } from '../../ws-server/poker/shared/poker-action-reducer.mjs';
import { computeSharedLegalActions } from '../../ws-server/poker/shared/poker-primitives.mjs';
import { chooseBotActionProfiled, enrichBotLegalActions } from '../../ws-server/poker/shared/poker-bot-strategy.mjs';
import { projectRoomCoreSnapshot } from '../../ws-server/poker/read-model/room-core-snapshot.mjs';
import { prepareSeed } from './browser-crypto.mjs';

// T002 spike: one hand, no persistence, wallet, admission, ledger or protocol emulator.
const human = 'offline-human';
const botIds = ['bot-offline-1', 'bot-offline-2'];
const members = [human, ...botIds].map((userId, i) => ({ userId, seat: i + 1 }));
const tableId = 'offline-' + crypto.randomUUID();
let state, version = 0, listener, started = false;
let random = Math.random;
const history = [];
function legal(userId) { return computeSharedLegalActions({ statePublic: state, userId }); }
function snapshot() {
  const coreState = {
    pokerState: state,
    seats: Object.fromEntries(members.map(m => [m.userId, m.seat])),
    seatDetailsByUserId: Object.fromEntries(members.map(m => [m.userId, { isBot: m.userId !== human, botProfile: 'NORMAL' }]))
  };
  return {
    ...projectRoomCoreSnapshot({ tableId, roomId: tableId, coreState, members, userId: human, youSeat: 1 }),
    tableId, stateVersion: version, youSeat: 1,
    table: { status: 'OPEN', maxSeats: 3, buyIn: 100 }
  };
}
function publish() { version++; if (listener) listener(snapshot()); }
function apply(userId, action) {
  if (state.turnUserId !== userId) throw new Error('Not your turn');
  const result = applyAction({ pokerState: state, userId, action: action.type, amount: action.amount, nowIso: new Date().toISOString() });
  if (!result.ok) throw new Error(result.reason);
  history.push({ userId, ...action, phase: state.phase });
  state = result.state;
  publish();
}
async function advanceBots() {
  // Bounded real bot turns, no next hand.
  for (let n = 0; state.turnUserId && state.turnUserId !== human && n < 100; n++) {
    await new Promise(resolve => setTimeout(resolve, 180));
    const userId = state.turnUserId;
    const action = chooseBotActionProfiled(enrichBotLegalActions(legal(userId)), { userId, profile: 'NORMAL', state, random });
    if (!action) throw new Error('No legal bot decision');
    apply(userId, action);
  }
}
window.PokerOfflinePoc = {
  tableId, human,
  async start(onSnapshot, options = {}) {
    if (started) throw new Error('One hand only: reload for a new game');
    started = true; listener = onSnapshot;
    // Optional local RNG injection for reproducible review, never from remote state.
    if (typeof options.random === 'function') random = options.random;
    await prepareSeed(`ws_seed_${tableId}_1_3`);
    state = buildBootstrappedPokerState({ tableId, coreState: { version: 1, members }, startingStacks: Object.fromEntries(members.map(m => [m.userId, 100])) });
    publish(); await advanceBots();
  },
  async act(action) { apply(human, action); await advanceBots(); },
  inspect() { return { tableId, state, history: history.slice(), total: state && Object.values(state.stacks).reduce((a,b) => a+b, 0) + state.potTotal }; }
};
