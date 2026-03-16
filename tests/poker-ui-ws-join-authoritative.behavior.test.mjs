import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

test('poker UI join sends WS join payload with seatNo + buyIn semantics', async () => {
  const sent = [];
  const harness = createPokerTableHarness({
    wsFactory(createOptions){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(payload, requestId){
          sent.push({ payload, requestId, tableId: createOptions.tableId });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerSeatNo.value = '4';
  harness.elements.pokerBuyIn.value = '220';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.tableId, 'table-1');
  assert.equal(sent[0].payload.seatNo, 4);
  assert.equal(sent[0].payload.buyIn, 220);
  assert.equal(harness.fetchState.joinCalls, 0);
});

test('poker UI autoJoin sends WS join payload with autoSeat + preferredSeatNo semantics', async () => {
  const sent = [];
  const harness = createPokerTableHarness({
    search: '?tableId=table-1&autoJoin=1&seatNo=2',
    wsFactory(){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(payload, requestId){
          sent.push({ payload, requestId });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.elements.pokerBuyIn.value = '300';
  harness.fireDomContentLoaded();
  await harness.flush();
  await harness.flush();

  assert.equal(sent.length >= 1, true);
  assert.equal(sent[0].payload.autoSeat, true);
  assert.equal(sent[0].payload.preferredSeatNo, 2);
  assert.equal(sent[0].payload.buyIn, 300);
  assert.equal(harness.fetchState.joinCalls, 0);
});


test('poker UI keeps join failed state on rejected WS join and does not fallback to HTTP join', async () => {
  const harness = createPokerTableHarness({
    wsFactory(){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(){
          const err = new Error('invalid_buy_in');
          err.code = 'invalid_buy_in';
          return Promise.reject(err);
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerSeatNo.value = '1';
  harness.elements.pokerBuyIn.value = '50';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(harness.fetchState.joinCalls, 0);
  assert.equal(typeof harness.elements.pokerError.textContent, 'string');
  assert.equal(harness.elements.pokerError.textContent.length > 0, true);
});
