import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableManager } from './table-manager.mjs';
import { adaptPersistedBootstrap } from '../bootstrap/persisted-bootstrap-adapter.mjs';
import { buildBootstrappedPokerState } from '../engine/poker-engine.mjs';
import { buildStateSnapshotPayload } from '../read-model/state-snapshot.mjs';

for (const allIn of [false,true]) test(`full persisted Leave reload retains private accounting/cards (all-in=${allIn})`,()=>{
  const tableId='full_leave_restore',ids=['human','bot_a','bot_b'];
  const coreState={version:7,roomId:tableId,members:ids.map((userId,i)=>({userId,seat:i+1})),publicStacks:{human:100,bot_a:100,bot_b:100}};
  const initial=buildBootstrappedPokerState({tableId,coreState,dealerSeatNo:1,startingStacks:coreState.publicStacks,handVersion:7});
  const {deck,holeCardsByUserId,...persisted}=initial;
  if(allIn){persisted.stacks.human=0;persisted.allInByUserId={human:true};persisted.pendingDetachByUserId={human:true};}
  else persisted.leftTableByUserId={human:true};
  const restored=adaptPersistedBootstrap({tableId,
    tableRow:{id:tableId,status:'OPEN',max_players:3,buy_in:100,is_single_player:false},
    seatRows:ids.map((user_id,i)=>({user_id,seat_no:i+1,status:'ACTIVE',is_bot:i>0,stack:persisted.stacks[user_id]})),
    stateRow:{version:8,state:{...persisted,tableId}}});
  assert.equal(restored.ok,true);
  const manager=createTableManager({defaultBuyIn:100,maxSeats:3});
  assert.equal(manager.restoreTableFromPersisted(tableId,restored.table).ok,true);
  assert.deepEqual(manager.persistedPokerState(tableId).handStartStacksByUserId,{human:100,bot_a:100,bot_b:100});
  assert.deepEqual(manager.privatePokerStateForAudit(tableId).holeCardsByUserId,holeCardsByUserId);
  for(const userId of ['human','bot_a','observer'])
    assert.equal(JSON.stringify(buildStateSnapshotPayload({tableSnapshot:manager.tableSnapshot(tableId,userId),userId})).includes('handStartStacksByUserId'),false);
});
