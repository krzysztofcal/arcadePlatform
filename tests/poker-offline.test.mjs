import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineGame, STORAGE_KEY } from '../poker/offline/offline-game.mjs';
function store() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,v) }; }
function game(storage) { return createOfflineGame({ storage, prepare: async()=>{}, random:()=>0.2 }); }
function finish(g) {
  for(let n=0;n<300 && g.read().session.state.phase!=='SETTLED';n++) {
    const s=g.read().session.state;
    if(s.turnUserId==='offline-human') {
      const a=g.legal(); g.act({type:a.actions.includes('CHECK')?'CHECK':a.actions.includes('CALL')?'CALL':'FOLD'});
    } else g.botStep();
  }
  assert.equal(g.read().session.state.phase,'SETTLED');
}
test('local session conserves chips, rejects illegal action, resumes and cashes out once',async()=>{
 const storage=store(), g=game(storage); assert.equal(g.read().wallet,5000);
 await g.newGame(100); const tableId=g.read().session.tableId;
 assert.equal(g.read().wallet,4900);
 const before=storage.getItem(STORAGE_KEY); assert.throws(()=>g.act({type:'RAISE',amount:0})); assert.equal(storage.getItem(STORAGE_KEY),before);
 finish(g); let s=g.read().session.state;
 assert.equal(Object.values(s.stacks).reduce((a,b)=>a+b,0),300); assert.equal(s.potTotal,0);
 assert.equal(Object.keys(s.handStartStacksByUserId).length,3);
 const resumed=game(storage); assert.equal(resumed.read().session.tableId,tableId);
 await resumed.nextHand(); assert.notEqual(resumed.read().session.state.handId,s.handId);
 const cash=resumed.leave(); assert.equal(cash.wallet,4900+cash.cashout);
 assert.deepEqual(resumed.leave(),{wallet:cash.wallet,cashout:0}); assert.equal(resumed.read().session,null);
 assert.equal(storage.getItem('chips'),null); assert.equal(storage.getItem('supabase.auth.token'),null);
 await resumed.newGame(500); assert.notEqual(resumed.read().session.tableId,tableId);
});
test('atomic failed write and stale async deal cannot debit wallet or overwrite another session',async()=>{
 const storage=store(), g=game(storage); const original=storage.setItem;
 storage.setItem=()=>{throw new Error('quota');}; await assert.rejects(g.newGame(100),/quota/); assert.equal(g.read().wallet,5000);
 storage.setItem=original;
 await g.newGame(100); await assert.rejects(g.newGame(500),/session/);
 assert.equal(g.read().wallet,4900); g.leave();
 let release; const paused=createOfflineGame({storage,prepare:()=>new Promise(r=>release=r)});
 const pending=paused.newGame(100); await g.newGame(500); release(); await assert.rejects(pending,/changed/);
 assert.equal(g.read().wallet,paused.read().wallet);
});
test('version/corruption fails closed; refill and rebuy remain local and do not destroy active stake',async()=>{
 const storage=store(),g=game(storage); await g.newGame(1000); const id=g.read().session.tableId;
 g.refill(); assert.equal(g.read().wallet,5000); assert.equal(g.read().session.tableId,id);
 assert.throws(()=>g.rebuy(),/settled/); finish(g);
 const before=g.read();g.rebuy();const after=g.read();
 assert.equal(after.wallet+after.session.state.stacks['offline-human'],before.wallet+before.session.state.stacks['offline-human']);
 storage.setItem(STORAGE_KEY,'{"schema":99}');assert.throws(()=>g.read(),/storage/);
});
test('all-in payouts conserve the original local stake and public projection keeps private audit data hidden',async()=>{
 const storage=store(),g=game(storage);await g.newGame(100);
 const snapshot=JSON.stringify(g.snapshot());assert.equal(snapshot.includes('handStartStacksByUserId'),false);
 assert.equal(snapshot.includes('handSeed'),false);assert.equal(snapshot.includes('"deck"'),false);
 g.act({type:'RAISE',amount:100});finish(g);
 const s=g.read().session.state;
 assert.equal(Object.values(s.stacks).reduce((a,b)=>a+b,0),300);
 assert.equal(Object.values(s.handSettlement.payouts).reduce((a,b)=>a+b,0),Object.values(s.contributionsByUserId).reduce((a,b)=>a+b,0));
 const before=g.read().wallet;const stack=s.stacks['offline-human'];g.leave();assert.equal(g.read().wallet,before+stack);
});
