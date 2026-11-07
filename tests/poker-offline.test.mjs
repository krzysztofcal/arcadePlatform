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
 assert.equal(g.refill(),false); assert.equal(g.read().wallet,4000); assert.equal(g.read().session.tableId,id);
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
function timedGame(storage=store()) {let time=100000;const g=createOfflineGame({storage,prepare:async()=>{},random:()=>0.2,uuid:()=>'timing-fixture-0',now:()=>time});return {g,storage,advance:ms=>time+=ms,now:()=>time};}
test('automatic settled rollover runs after three seconds once; stale callbacks cannot start another hand',async()=>{
 const {g,advance}=timedGame();await g.newGame(100);finish(g);const token=g.timerToken(),wallet=g.read().wallet;
 advance(2999);assert.equal(await g.tick(token),false);advance(1);assert.deepEqual(await Promise.all([g.tick(token),g.tick(token)]),[true,false]);
 assert.equal(g.read().session.hand,2);assert.equal(await g.tick(token),false);assert.equal(g.read().wallet,wallet);
});
test('hero timeout uses canonical FOLD or CHECK and a callback cannot act twice',async()=>{
 const {g,advance}=timedGame();await g.newGame(100);const token=g.timerToken();advance(19999);assert.equal(await g.tick(token),false);advance(1);assert.equal(await g.tick(token),true);
 assert.equal(g.read().session.state.foldedByUserId['offline-human'],true);const revision=g.read().revision;assert.equal(await g.tick(token),false);assert.equal(g.read().revision,revision);
 const t=timedGame();await t.g.newGame(100);t.g.act({type:'CALL'});
 for(let n=0;n<80;n++){const s=t.g.read().session.state;if(s.turnUserId==='offline-human'&&t.g.legal().actions.includes('CHECK'))break;if(s.turnUserId==='offline-human')t.g.act({type:'CALL'});else t.g.botStep();}
 assert.equal(t.g.legal().actions.includes('CHECK'),true);const check=t.g.timerToken();t.advance(20000);assert.equal(await t.g.tick(check),true);assert.notEqual(t.g.read().session.state.foldedByUserId['offline-human'],true);
});
test('paused clocks and v1 Resume never charge closed-app time; bots have durable 1000–2000ms delay',async()=>{
 const {g,advance,storage}=timedGame();await g.newGame(100);advance(5000);g.pause();const wallet=g.read().wallet;advance(600000);assert.equal(await g.tick(g.timerToken()),false);g.resume();assert.equal(g.pendingTimer().delayMs,15000);
 g.act({type:'CALL'});const bot=g.pendingTimer();assert.ok(bot.delayMs>=1000&&bot.delayMs<=2000);advance(bot.delayMs);assert.equal(await g.tick(bot.token),true);assert.equal(await g.tick(bot.token),false);
 const old=g.read();delete old.session.clock;old.session.state.turnDeadlineAt=null;old.session.state.turnStartedAt=null;storage.setItem(STORAGE_KEY,JSON.stringify(old));advance(600000);g.resume();assert.ok(g.pendingTimer().delayMs>0);assert.equal(g.read().wallet,wallet);
});
test('bust stops auto-deal until explicit rebuy; failed timer write preserves PC and turn',async()=>{
 const {g,storage,advance}=timedGame();await g.newGame(100);finish(g);const d=g.read();d.session.state.stacks['offline-human']=0;d.session.state.stacks['bot-offline-1']+=100;storage.setItem(STORAGE_KEY,JSON.stringify(d));assert.equal(g.pendingTimer(),null);
 g.rebuy();assert.ok(g.pendingTimer());assert.equal(g.read().wallet,4800);
 const token=g.timerToken(),before=storage.getItem(STORAGE_KEY),write=storage.setItem;storage.setItem=()=>{throw new Error('quota');};advance(3000);await assert.rejects(g.tick(token),/quota/);assert.equal(storage.getItem(STORAGE_KEY),before);assert.throws(()=>g.leave(),/quota/);assert.equal(storage.getItem(STORAGE_KEY),before);storage.setItem=write;
});
test('bot decision has a short independent delay but a full 20-second deadline; late bot uses canonical timeout once',async()=>{
 const t=timedGame();await t.g.newGame(100);t.g.act({type:'CALL'});
 const before=t.g.read().session.state,id=before.turnUserId;assert.notEqual(id,'offline-human');assert.equal(before.turnDeadlineAt-before.turnStartedAt,20000);
 const pending=t.g.pendingTimer();assert.ok(pending.delayMs>=1000&&pending.delayMs<=2000);
 t.advance(pending.delayMs);assert.ok(t.g.read().session.state.turnDeadlineAt-(100000+pending.delayMs)>=18000);assert.equal(await t.g.tick(pending.token),true);assert.equal(await t.g.tick(pending.token),false);
 const late=timedGame();await late.g.newGame(100);late.g.act({type:'CALL'});const token=late.g.timerToken();late.advance(20000);assert.equal(await late.g.tick(token),true);
 assert.equal(late.g.read().session.lastAction.source,'timeout');assert.ok(['CHECK','FOLD'].includes(late.g.read().session.lastAction.type));assert.equal(await late.g.tick(token),false);
});
for(const [roll,count] of [[0,2],[.3,3],[.6,4],[.9999,5]])test(`persistent ${count} bots: showdown, conservation, Resume, rollover and idempotent Leave`,async()=>{
 const storage=store();let first=true;const g=createOfflineGame({storage,prepare:async()=>{},random:()=>{if(first){first=false;return roll;}return .01;}});await g.newGame(100);
 const start=g.read(),roster=start.session.members;assert.equal(roster.length,count+1);assert.equal(start.wallet,4900);assert.equal(g.snapshot().table.maxSeats,count+1);
 assert.deepEqual(start.session.state.handStartStacksByUserId,Object.fromEntries(roster.map(m=>[m.userId,100])));
 finish(g);const settled=g.read().session.state;assert.equal(settled.community.length,5);assert.equal(Object.values(settled.stacks).reduce((a,b)=>a+b,0),100*(count+1));
 const resumed=createOfflineGame({storage,prepare:async()=>{},random:()=>.99});resumed.resume(true);assert.deepEqual(resumed.read().session.members,roster);assert.equal(resumed.read().session.tableId,start.session.tableId);assert.deepEqual(resumed.read().session.state.stacks,settled.stacks);
 if(settled.stacks['offline-human']>=2){await resumed.nextHand();assert.deepEqual(resumed.read().session.members,roster);}
 const wallet=resumed.read().wallet,cash=resumed.leave();assert.equal(cash.wallet,wallet+cash.cashout);assert.equal(resumed.leave().cashout,0);
});
test('legacy two-bot v1 roster and short bot clock upgrade without changing wallet, stacks, IDs or hand',async()=>{
 const t=timedGame();await t.g.newGame(100);t.g.act({type:'CALL'});const old=t.g.read();delete old.session.members;old.session.clock={durationMs:1500,remainingMs:700,dueAt:101500,paused:true};t.storage.setItem(STORAGE_KEY,JSON.stringify(old));
 t.advance(600000);t.g.resume(true);const restored=t.g.read();assert.equal(restored.wallet,old.wallet);assert.deepEqual(restored.session.state.stacks,old.session.state.stacks);assert.equal(restored.session.tableId,old.session.tableId);assert.equal(restored.session.state.handId,old.session.state.handId);assert.equal(restored.session.members.length,3);
 assert.equal(restored.session.state.turnDeadlineAt-restored.session.state.turnStartedAt,20000);assert.ok(t.g.pendingTimer().delayMs<=2000);
});
test('pause preserves independent bot-decision and 20-second turn budgets without duplicate action',async()=>{
 const t=timedGame();await t.g.newGame(100);t.g.act({type:'CALL'});const start=t.g.pendingTimer();t.advance(500);t.g.pause();const saved=t.g.read();assert.equal(saved.session.clock.remainingMs,19500);assert.equal(saved.session.clock.botRemainingMs,start.delayMs-500);
 t.advance(600000);t.g.resume();const state=t.g.read().session.state;assert.equal(state.turnDeadlineAt-state.turnStartedAt,20000);const pending=t.g.pendingTimer();assert.equal(pending.delayMs,start.delayMs-500);
 t.advance(pending.delayMs-1);assert.equal(await t.g.tick(pending.token),false);t.advance(1);assert.equal(await t.g.tick(pending.token),true);assert.equal(t.g.read().session.lastAction.source,'bot');assert.equal(await t.g.tick(pending.token),false);
});

// Fundamental intent/legality rules from the single V2 renderer, without a DOM suite.
async function preactionRules(g){
 const {readFileSync}=await import('node:fs');const {parse}=await import('acorn');const vm=await import('node:vm');
 const source=readFileSync('poker/poker-v2.js','utf8'),names=new Set(['buildQueuedPreaction','readQueuedAmount','resolveQueuedPreactionExecution','syncQueuedPreactionWithPreactionState','maybeExecuteQueuedPreaction','clearQueuedPreaction','resetQueuedPreactionState']);const bodies=[];
 function visit(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&names.has(n.id?.name))bodies.push(source.slice(n.start,n.end));for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}}
 visit(parse(source,{ecmaVersion:'latest'}));assert.equal(bodies.length,names.size);
 const context=vm.createContext({state:{reconnectGate:false},els:{amountInput:{value:'20'},primaryPreaction:{dataset:{action:'CHECK'}},amountPreaction:{dataset:{action:'RAISE'}}},notifyPreactionCancelled:()=>{},getAllowedActions:()=>g.legal().actions,isUsersTurn:()=>g.read().session.state.turnUserId==='offline-human',isFoldAvailable:()=>g.legal().actions.includes('FOLD'),resolvePrimaryAction:a=>a.includes('CHECK')?'CHECK':a.includes('CALL')?'CALL':null,resolveAmountAction:()=>null,resolveAllInPlan:()=>null,resolveStack:()=>g.read().session.state.stacks['offline-human'],resolveAmountBounds:()=>null,renderControls:()=>{},handleAction:(type,amount)=>Promise.resolve(g.act({type,amount,handId:g.read().session.state.handId},g.timerToken()))});
 vm.runInContext('var queuedPreaction=null,queuedPreactionInFlight=false;'+bodies.join('\n'),context);return context;
}
test('V2 queued intent waits, executes legally once and loses the race safely against stale timer/manual tokens',async()=>{
 const t=timedGame();await t.g.newGame(100);t.g.act({type:'CALL'});const r=await preactionRules(t.g);
 assert.ok(t.g.snapshot().projectedLegalActions.actions.includes('FOLD'));r.queuedPreaction=r.buildQueuedPreaction('fold');const stored=t.storage.getItem(STORAGE_KEY);r.maybeExecuteQueuedPreaction();assert.equal(t.storage.getItem(STORAGE_KEY),stored);
 for(let n=0;n<100&&t.g.read().session.state.turnUserId!=='offline-human'&&t.g.read().session.state.phase!=='SETTLED';n++)t.g.botStep();
 assert.equal(t.g.read().session.state.turnUserId,'offline-human');const token=t.g.timerToken(),rev=t.g.read().revision;r.maybeExecuteQueuedPreaction();r.maybeExecuteQueuedPreaction();await Promise.resolve();
 assert.equal(t.g.read().revision,rev+1);assert.equal(t.g.read().session.state.foldedByUserId['offline-human'],true);assert.equal(t.g.act({type:'FOLD'},token),false);t.advance(20000);assert.equal(await t.g.tick(token),false);
});
test('V2 invalidates changed action/bet intent; pause/Resume and new-hand reset never resurrect it',async()=>{
 const t=timedGame();await t.g.newGame(100);const r=await preactionRules(t.g);
 r.queuedPreaction=r.buildQueuedPreaction('amount');assert.equal(r.resolveQueuedPreactionExecution({amountAction:'RAISE',amountBounds:{min:40,max:100}}),null);
 r.syncQueuedPreactionWithPreactionState({amountAction:'RAISE',amountBounds:{min:40,max:100}});assert.equal(r.queuedPreaction,null);
 r.queuedPreaction=r.buildQueuedPreaction('primary');assert.equal(r.resolveQueuedPreactionExecution({primaryAction:'CALL'}),null);r.syncQueuedPreactionWithPreactionState({primaryAction:'CALL'});assert.equal(r.queuedPreaction,null);
 r.queuedPreaction=r.buildQueuedPreaction('fold');r.resetQueuedPreactionState();t.g.pause();t.advance(600000);t.g.resume();const rev=t.g.read().revision;r.maybeExecuteQueuedPreaction();assert.equal(t.g.read().revision,rev);
 const oldHand=t.g.read().session.state.handId;finish(t.g);if(t.g.read().session.state.stacks['offline-human']>=2){await t.g.nextHand();assert.equal(t.g.act({type:'FOLD',handId:oldHand},t.g.timerToken()),false);}
});
async function backHarness(){
 const t=timedGame();await t.g.newGame(100);t.advance(5000);
 const{readFileSync}=await import('node:fs'),{parse}=await import('acorn'),vm=await import('node:vm');
 const source=readFileSync('poker/offline/browser-entry.mjs','utf8'),names=new Set(['backToLobby','ask','cancelDialog','restorePage']);
 const bodies=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>source.slice(n.start,n.end));
 const counts={park:0,resume:0,show:0,navigate:0,destinations:[]};let context;
 const nodes={offlineConfirmTitle:{},offlineConfirmCopy:{},offlineConfirmYes:{},offlineConfirmCancel:{focus(){}}};
 const dialog={open:false,showModal(){this.open=true;counts.show++;},close(value){this.open=false;queueMicrotask(()=>{const resolve=context.resolveConfirmation;context.resolveConfirmation=null;if(resolve)resolve(value==='confirm');});}};nodes.offlineConfirm=dialog;
 context=vm.createContext({document:{getElementById:id=>nodes[id]||null},window:{location:{assign(url){counts.navigate++;counts.destinations.push(url);}}},park:async()=>{counts.park++;t.g.pause();},activate:async()=>{counts.resume++;t.g.resume(true);}});
 vm.runInContext('var backNavigation=null,resolveConfirmation;'+bodies.join('\n'),context);
 return{...t,counts,nodes,dialog,back:()=>context.backToLobby(),restore:()=>context.restorePage({persisted:true}),flush:()=>new Promise(setImmediate)};
}
test('Back confirmation Cancel preserves budget; Confirm parks exact session for Resume with no cashout',async()=>{
 const h=await backHarness(),original=h.g.read(),first=h.back();await h.flush();assert.equal(h.dialog.open,true);assert.equal(h.g.read().session.clock.paused,true);assert.equal(h.g.read().session.clock.remainingMs,15000);
 assert.equal(h.nodes.offlineConfirmTitle.textContent,'Return to lobby?');assert.equal(h.nodes.offlineConfirmCancel.textContent,'Keep playing');assert.equal(h.nodes.offlineConfirmYes.textContent,'Return to lobby');
 h.advance(60000);h.dialog.close('cancel');await first;assert.equal(h.counts.navigate,0);assert.equal(h.counts.resume,1);assert.equal(h.g.pendingTimer().delayMs,15000);
 const second=h.back();await h.flush();const parked=h.g.read();h.advance(60000);h.dialog.close('confirm');await second;assert.equal(h.counts.navigate,1);assert.deepEqual(h.counts.destinations,['/poker/index.html']);await h.back();assert.equal(h.counts.navigate,1);assert.deepEqual(h.counts.destinations,['/poker/index.html']);assert.equal(h.counts.park,2);assert.equal(h.g.read().session.clock.paused,true);assert.equal(h.g.read().wallet,original.wallet);
 h.g.resume(true);const resumed=h.g.read();assert.equal(resumed.session.tableId,original.session.tableId);assert.equal(resumed.session.state.handId,original.session.state.handId);assert.deepEqual(resumed.session.state.stacks,original.session.state.stacks);assert.deepEqual(resumed.session.state.holeCardsByUserId,original.session.state.holeCardsByUserId);assert.deepEqual(resumed.session.members,original.session.members);assert.equal(h.g.pendingTimer().delayMs,parked.session.clock.remainingMs);
});
test('rapid Back while pausing or while modal open creates one pause/modal/resume and no financial operation',async()=>{
 for(const openFirst of[false,true]){
  const h=await backHarness(),wallet=h.g.read().wallet,first=h.back();if(openFirst)await h.flush();
  const second=h.back(),third=h.back();await Promise.all([first,second,third]);
  assert.equal(h.counts.park,1);assert.equal(h.counts.show,openFirst?1:0);assert.equal(h.counts.resume,1);assert.equal(h.counts.navigate,0);assert.equal(h.g.read().wallet,wallet);assert.ok(h.g.read().session);assert.equal(h.g.pendingTimer().delayMs,15000);
 }
});

test('confirmed Back BFCache return clears navigation latch and permits a fresh confirmation',async()=>{
 const h=await backHarness(),first=h.back();await h.flush();h.dialog.close('confirm');await first;assert.equal(h.counts.navigate,1);assert.deepEqual(h.counts.destinations,['/poker/index.html']);h.advance(60000);await h.restore();assert.equal(h.g.pendingTimer().delayMs,15000);
 const again=h.back();await h.flush();assert.equal(h.dialog.open,true);h.dialog.close('cancel');await again;assert.equal(h.counts.show,2);assert.equal(h.counts.navigate,1);assert.deepEqual(h.counts.destinations,['/poker/index.html']);assert.equal(h.g.read().wallet,4900);
});

test('Offline Leave and Reset commit once then navigate to the packaged lobby document',async()=>{
 const{readFileSync}=await import('node:fs'),{parse}=await import('acorn'),vm=await import('node:vm');
 const storage=store(),g=game(storage);await g.newGame(100);const destinations=[];
 const window={location:{assign:url=>destinations.push(url)},PokerOffline:{leave:async()=>g.leave()},localStorage:{removeItem:key=>storage.setItem(key,null)}};
 const generator=readFileSync('scripts/build-poker-offline-poc.mjs','utf8');
 const leave=generator.match(/leaveAndReturnToLobby: `([^`]+)`/)[1];
 const context=vm.createContext({window,setError:message=>assert.fail(message),game:g,STORAGE_KEY,timer:null,clearTimeout,ask:async()=>false});
 const executeLeave=vm.runInContext('(function(){'+leave+'})',context);
 await executeLeave();const wallet=g.read().wallet;assert.equal(g.read().session,null);await executeLeave();assert.equal(g.read().wallet,wallet);assert.deepEqual(destinations,['/poker/index.html','/poker/index.html']);
 await g.newGame(100);const saved=storage.getItem(STORAGE_KEY),source=readFileSync('poker/offline/browser-entry.mjs','utf8');
 const reset=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='resetOfflineProgress');assert.ok(reset);
 context.navigator={locks:{request:async(key,fn)=>fn()}};context.epoch=0;context.active=true;context.clearPreactions=null;
 const executeReset=vm.runInContext('('+source.slice(reset.start,reset.end)+')',context);
 await executeReset();assert.equal(storage.getItem(STORAGE_KEY),saved);assert.equal(destinations.length,2);
 context.ask=async()=>true;await executeReset();assert.equal(storage.getItem(STORAGE_KEY),null);assert.equal(destinations.at(-1),'/poker/index.html');
});

test('automatic refill thresholds are idempotent, read stays pure and failed writes are atomic',()=>{
 for(const wallet of[99,100,0]){
  const storage=store(),raw=JSON.stringify({schema:1,revision:7,wallet,session:null});storage.setItem(STORAGE_KEY,raw);storage.setItem('chips','online-untouched');const g=game(storage);
  assert.equal(g.read().wallet,wallet);assert.equal(storage.getItem(STORAGE_KEY),raw);
  assert.equal(g.refill(),wallet<100);assert.equal(g.read().wallet,wallet<100?5000:100);assert.equal(g.read().revision,wallet<100?8:7);
  const saved=storage.getItem(STORAGE_KEY);assert.equal(g.refill(),false);assert.equal(storage.getItem(STORAGE_KEY),saved);assert.equal(storage.getItem('chips'),'online-untouched');
 }
 const storage=store(),raw=JSON.stringify({schema:1,revision:0,wallet:0,session:null});storage.setItem(STORAGE_KEY,raw);const write=storage.setItem;storage.setItem=()=>{throw new Error('quota');};const g=game(storage);assert.throws(()=>g.refill(),/quota/);assert.equal(storage.getItem(STORAGE_KEY),raw);storage.setItem=write;g.refill();assert.equal(g.read().wallet,5000);
});
test('concurrent deals commit debit and refill once; legacy low-wallet Resume never funds the Hero stack',async()=>{
 const storage=store();storage.setItem(STORAGE_KEY,JSON.stringify({schema:1,revision:0,wallet:100,session:null}));let writes=0;const write=storage.setItem;storage.setItem=(...args)=>{writes++;write(...args);};const a=game(storage),b=game(storage);
 const results=await Promise.allSettled([a.newGame(100),b.newGame(100)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes,1);assert.equal(a.read().wallet,5000);assert.equal(a.read().session.state.stacks['offline-human'],100);
 const legacy=a.read();legacy.wallet=0;delete legacy.session.members;storage.setItem(STORAGE_KEY,JSON.stringify(legacy));const restored=game(storage),before=restored.read().session;assert.equal(restored.refill(),true);assert.deepEqual(restored.read().session,before);restored.resume();assert.deepEqual(restored.read().session.state.stacks,before.state.stacks);assert.equal(restored.read().session.state.handId,before.state.handId);assert.equal(restored.read().wallet,5000);
 const low=store();low.setItem(STORAGE_KEY,JSON.stringify({schema:1,revision:0,wallet:0,session:null}));const fresh=game(low);await fresh.newGame(100);assert.equal(fresh.read().wallet,4900);assert.equal(fresh.read().session.buyIn,100);
 const raced=store();raced.setItem(STORAGE_KEY,JSON.stringify({schema:1,revision:0,wallet:99,session:null}));let release;const delayed=createOfflineGame({storage:raced,prepare:()=>new Promise(r=>release=r)}),other=game(raced);const pending=delayed.newGame(100);assert.equal(other.refill(),true);release();await assert.rejects(pending,/changed/);assert.equal(other.read().wallet,5000);assert.equal(other.read().session,null);await other.newGame(100);assert.equal(other.read().wallet,4900);
});
test('Rebuy and Leave enforce wallet threshold without automatic Rebuy or duplicate cashout',async()=>{
 const storage=store(),g=game(storage);await g.newGame(100);finish(g);const data=g.read();data.wallet=100;data.session.state.stacks['offline-human']=0;storage.setItem(STORAGE_KEY,JSON.stringify(data));const bots={...data.session.state.stacks};delete bots['offline-human'];
 assert.equal(g.refill(),false);assert.equal(g.read().session.state.stacks['offline-human'],0);g.rebuy();assert.equal(g.read().wallet,5000);assert.equal(g.read().session.state.stacks['offline-human'],100);for(const[id,stack]of Object.entries(bots))assert.equal(g.read().session.state.stacks[id],stack);
 const empty=g.read();empty.wallet=0;empty.session.state.stacks['offline-human']=0;storage.setItem(STORAGE_KEY,JSON.stringify(empty));assert.deepEqual(g.leave(),{wallet:5000,cashout:0});const saved=storage.getItem(STORAGE_KEY);assert.deepEqual(g.leave(),{wallet:5000,cashout:0});assert.equal(storage.getItem(STORAGE_KEY),saved);
});

test('only invalid Offline storage errors expose emergency recovery',async()=>{
 const{readFileSync}=await import('node:fs'),{parse}=await import('acorn'),vm=await import('node:vm');const source=readFileSync('poker/offline/browser-entry.mjs','utf8'),node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='fail');
 const errorNode={textContent:'',hidden:true},recovery={hidden:true},context=vm.createContext({document:{getElementById:id=>id==='offlineError'?errorNode:id==='offlineRecoveryReset'?recovery:null}});vm.runInContext(source.slice(node.start,node.end),context);
 for(const raw of['{bad','{"schema":99}',JSON.stringify({schema:1,revision:0,wallet:99,session:1})]){const storage=store();storage.setItem(STORAGE_KEY,raw);const g=game(storage);let error;try{g.read();}catch(e){error=e;}assert.equal(error?.code,'OFFLINE_STORAGE_INVALID');context.fail(error);assert.equal(recovery.hidden,false);assert.ok(errorNode.textContent);assert.equal(storage.getItem(STORAGE_KEY),raw);}
 context.fail(new Error('Not enough Offline Chips for this buy-in'));assert.equal(recovery.hidden,true);context.fail(new Error('quota'));assert.equal(recovery.hidden,true);
});
test('shared locked Reset recovers invalid storage without read and only deletes the Offline key',async()=>{
 const{readFileSync}=await import('node:fs'),{parse}=await import('acorn'),vm=await import('node:vm');const source=readFileSync('poker/offline/browser-entry.mjs','utf8'),node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='resetOfflineProgress');assert.ok(node);
 for(const raw of['{bad','{"schema":99}',JSON.stringify({schema:1,revision:0,wallet:100,session:null})]){
  const data=new Map([[STORAGE_KEY,raw],['chips','unchanged-CH'],['other-app-data','keep']]),destinations=[];let locked=false,confirmed=false,reads=0,removals=0;
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>{assert.equal(locked,true);assert.equal(k,STORAGE_KEY);removals++;data.delete(k);}};
  const context=vm.createContext({STORAGE_KEY,epoch:0,active:true,timer:null,clearTimeout,clearPreactions:()=>{},game:{read(){reads++;throw new Error('must not read');}},run(){assert.fail('Reset must bypass run');},navigator:{locks:{request:async(key,fn)=>{assert.equal(key,STORAGE_KEY);locked=true;try{return await fn();}finally{locked=false;}}}},ask:async()=>{assert.equal(locked,true);return confirmed;},window:{localStorage:storage,location:{assign:url=>{assert.equal(locked,true);destinations.push(url);}}}});
  vm.runInContext(source.slice(node.start,node.end),context);await context.resetOfflineProgress();assert.equal(storage.getItem(STORAGE_KEY),raw);assert.equal(removals,0);assert.equal(reads,0);
  confirmed=true;await context.resetOfflineProgress();assert.equal(removals,1);assert.equal(reads,0);assert.equal(data.has(STORAGE_KEY),false);assert.equal(data.get('chips'),'unchanged-CH');assert.equal(data.get('other-app-data'),'keep');assert.deepEqual(destinations,['/poker/index.html']);const g=game(storage);assert.equal(g.read().wallet,5000);await g.newGame(100);assert.equal(g.read().wallet,4900);
 }
});

async function bootFunctions(names){
 const{readFileSync}=await import('node:fs'),{parse}=await import('acorn');const source=readFileSync('poker/offline/renderer.generated.js','utf8'),bodies=[];
 function visit(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&names.includes(n.id?.name))bodies.push(source.slice(n.start,n.end));for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}}
 visit(parse(source,{ecmaVersion:'latest'}));assert.equal(bodies.length,names.length);return bodies.join('\n');
}
test('Offline startup publishes paused snapshot before readiness and spends no clock budget while loading',async()=>{
 const{readFileSync}=await import('node:fs'),{parse}=await import('acorn'),vm=await import('node:vm');const source=readFileSync('poker/offline/browser-entry.mjs','utf8'),nodes=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='FunctionDeclaration'&&['startView','activate'].includes(n.id.name));assert.equal(nodes.length,2);
 const t=timedGame();await t.g.newGame(100);t.advance(5000);let context,release;const snapshots=[],ready=new Promise(r=>release=r);
 context=vm.createContext({game:t.g,document:{hidden:false},run:async fn=>{await fn();if(context.listener){snapshots.push(t.g.read().session.clock.paused);context.listener(t.g.snapshot());}},clearTimeout});
 vm.runInContext('var listener,reactionListener,clearPreactions,viewReady=false,active=false,epoch=0,backNavigation=null,timer;'+nodes.map(n=>source.slice(n.start,n.end)).join('\n'),context);
 const pending=context.startView(()=>{},()=>{},()=>{},()=>ready);await new Promise(setImmediate);assert.equal(context.active,false);assert.deepEqual(snapshots,[true]);assert.equal(t.g.pendingTimer(),null);const before=t.g.read();t.advance(60000);await context.activate();assert.deepEqual(t.g.read(),before);release();await pending;assert.equal(context.active,true);assert.equal(t.g.read().session.clock.remainingMs,20000);assert.equal(t.g.read().session.clock.dueAt-t.now(),20000);
});
test('Offline boot waits for theme and layout frames; completion remains exactly once',async()=>{
 const vm=await import('node:vm'),source=await bootFunctions(['prepareOfflineFrame','markBootReady']);let release;const theme=new Promise(r=>release=r),frames=[],attrs=new Map();let marks=0,renders=0;
 const context=vm.createContext({Promise,document:{fonts:{ready:Promise.resolve()}},window:{requestAnimationFrame:fn=>frames.push(fn),setTimeout,clearTimeout},els:{screen:{querySelectorAll:()=>[],setAttribute:(k,v)=>{attrs.set(k,v);marks++;}},bootSplash:{hidden:false}},render:()=>renders++,fitTableScene:()=>{}});vm.runInContext('var bootReady=false;'+source,context);
 const pending=context.prepareOfflineFrame(theme);await new Promise(setImmediate);assert.equal(marks,0);assert.equal(frames.length,0);release();await new Promise(setImmediate);assert.ok(renders>0);assert.equal(marks,0);assert.equal(frames.length,1);frames.shift()();assert.equal(marks,0);frames.shift()();await pending;assert.equal(marks,1);assert.equal(context.els.bootSplash.hidden,true);context.markBootReady();assert.equal(marks,1);
});
test('Offline theme readiness resolves success or bounded stable Classic fallback without late switching',async()=>{
 const vm=await import('node:vm'),source=await bootFunctions(['applyTableTheme']);
 for(const mode of['success','failure','timeout','classic']){
  const attrs=new Map(),timers=new Map(),images=[];let id=0;
  class Image {constructor(){images.push(this);}set src(url){this.url=url;this.naturalWidth=1;if(mode==='timeout'&&url.includes('/themes/'))return;queueMicrotask(()=>{if(mode==='failure'&&url.includes('/themes/'))this.onerror?.();else this.onload?.();});}decode(){return Promise.resolve();}}
  const context=vm.createContext({Promise,Image,window:{setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)},els:{screen:{removeAttribute:k=>attrs.delete(k),setAttribute:(k,v)=>attrs.set(k,v)}},TABLE_THEME_CATALOG:[{id:'classic-casino',assets:[]},{id:'midnight-sapphire',assets:['room.webp']}],tableThemeRequest:0,klog:()=>{}});vm.runInContext(source,context);
  const pending=context.applyTableTheme(mode==='classic'?'classic-casino':'midnight-sapphire');assert.equal(typeof pending?.then,'function');await new Promise(setImmediate);if(mode==='timeout')for(const fn of [...timers.values()])fn();await pending;assert.equal(attrs.get('data-table-theme'),mode==='success'?'midnight-sapphire':undefined);for(const image of images)image.onload?.();await new Promise(setImmediate);assert.equal(attrs.get('data-table-theme'),mode==='success'?'midnight-sapphire':undefined);
 }
});

async function offlineAvatarHarness(storage=store()){
 const {readFileSync}=await import('node:fs'),{parse}=await import('acorn'),vm=await import('node:vm');
 storage.removeItem=storage.removeItem||function(key){this.setItem(key,null);};
 const window={localStorage:storage,addEventListener(){},KLog:{log(){}}};window.window=window;
 const online=vm.createContext({window,document:{querySelectorAll(){return[];},dispatchEvent(){}},CustomEvent:class{},Date,JSON});
 vm.runInContext(readFileSync('js/profile-avatar-catalog.js','utf8'),online);vm.runInContext(readFileSync('js/user-ui-state.js','utf8'),online);
 const bridge=readFileSync('poker/offline/browser-entry.mjs','utf8');const reader=parse(bridge,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='avatarVariant');assert.ok(reader,'Offline must use its isolated local avatar reader');
 const isolated=vm.createContext({window:{localStorage:{getItem(key){assert.equal(key,'kcswh:offline-avatar:v1');return storage.getItem(key);},setItem(){throw Error('visual_write_forbidden');},removeItem(){throw Error('visual_write_forbidden');}},ArcadeAvatars:window.ArcadeAvatars},fetch(){throw Error('network_forbidden');},WebSocket(){throw Error('network_forbidden');},SupabaseAuth:new Proxy({},{get(){throw Error('auth_forbidden');}})});
 vm.runInContext(bridge.slice(reader.start,reader.end),isolated);
 const renderer=readFileSync('poker/offline/renderer.generated.js','utf8');let decoration;
 function visit(node){if(!node||typeof node!=='object')return;if(node.type==='IfStatement'&&renderer.slice(node.start,node.end).includes('if(payload.seats)payload.seats.forEach')&&renderer.slice(node.start,node.end).includes('offline.human'))decoration=renderer.slice(node.start,node.end);for(const v of Object.values(node)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}}
 visit(parse(renderer,{ecmaVersion:'latest'}));assert.ok(decoration);isolated.offline={human:'offline-human',avatarVariant:()=>isolated.avatarVariant()};
 const auth=readFileSync('js/auth/supabaseClient.js','utf8');let callback;
 function find(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.arguments?.[0]?.value==='profile:updated')callback=auth.slice(node.arguments[1].start,node.arguments[1].end);for(const v of Object.values(node)){if(Array.isArray(v))v.forEach(find);else if(v&&typeof v==='object')find(v);}}
 find(parse(auth,{ecmaVersion:'latest'}));assert.ok(callback);online.state={user:{id:'alice'}};online.userUiState=()=>window.UserUiState;online.renderUser=()=>{};const confirmed=vm.runInContext('('+callback+')',online);
 return {ui:window.UserUiState,confirm(profile){confirmed({detail:profile});},account(id){online.state.user=id?{id}:null;},variant:()=>isolated.avatarVariant(),decorate(payload){isolated.payload=payload;vm.runInContext(decoration,isolated);return payload;},reload(){return offlineAvatarHarness(storage);}};
}
test('confirmed Account avatar projects into Offline New Game and Resume without game writes or transport',async()=>{
 const storage=store(),h=await offlineAvatarHarness(storage);h.ui.hydrate('alice');h.confirm({displayName:'Alice',avatar:{type:'default',variant:'fox-blue'}});
 const g=game(storage);await g.newGame(100);let raw=storage.getItem(STORAGE_KEY);assert.equal(h.decorate(g.snapshot()).seats.find(s=>s.userId==='offline-human').profile.avatar.variant,'fox-blue');assert.equal(storage.getItem(STORAGE_KEY),raw);
 h.confirm({displayName:'Alice',avatar:{type:'default',variant:'panda-pink'}});assert.equal(storage.getItem(STORAGE_KEY),raw);const cold=await h.reload();assert.equal(cold.decorate(game(storage).snapshot()).seats.find(s=>s.userId==='offline-human').profile.avatar.variant,'panda-pink');assert.equal(storage.getItem(STORAGE_KEY),raw);
 // Local selection has no confirmed event: the last saved visual remains unchanged.
 assert.equal(cold.variant(),'panda-pink');g.leave();await g.newGame(100);raw=storage.getItem(STORAGE_KEY);assert.equal(cold.decorate(g.snapshot()).seats.find(s=>s.userId==='offline-human').profile.avatar.variant,'panda-pink');assert.equal(storage.getItem(STORAGE_KEY),raw);
});
test('Offline avatar is account-bound, durable without Auth, and fails safely on logout/invalid storage',async()=>{
 const storage=store(),h=await offlineAvatarHarness(storage);assert.equal(h.variant(),'comet-blue');h.ui.hydrate('alice');h.confirm({displayName:'Alice',avatar:{type:'default',variant:'fox-blue'}});assert.equal(h.variant(),'fox-blue');
 h.ui.hydrate('bob');h.account('bob');assert.equal(h.variant(),'comet-blue');h.confirm({displayName:'Bob',avatar:{type:'default',variant:'orbit-green'}});assert.equal(h.variant(),'orbit-green');assert.equal(h.ui.publish('alice','profile',{displayName:'Alice',avatar:{variant:'fox-blue'}}),null);assert.equal(h.variant(),'orbit-green');
 storage.removeItem('kcswh:user-ui:profile:v1:alice');const cold=await h.reload();cold.ui.hydrate('alice');assert.equal(cold.variant(),'fox-blue');cold.ui.clearUser('alice');cold.ui.setAnonymous();assert.equal(cold.variant(),'comet-blue');
 for(const bad of ['https://google.test/photo','not-an-avatar','{"variant":"fox-blue"}']){storage.setItem('kcswh:offline-avatar:v1',bad);assert.equal(cold.variant(),'comet-blue');}
 storage.setItem('kcswh:offline-avatar:v1','fox-blue');assert.equal((await h.reload()).variant(),'fox-blue','cold Offline reads only the visual record, no Auth bootstrap');h.confirm({displayName:'Bob',avatar:{type:'uploaded',variant:'fox-blue',url:'https://google.test/photo'}});assert.equal(h.variant(),'comet-blue');
 storage.getItem=()=>{throw Error('storage_unavailable');};assert.equal(cold.variant(),'comet-blue');
});
