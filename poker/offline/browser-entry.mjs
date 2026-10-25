import {classifyRaiseReaction, classifySettlementReaction, classifyAmbientReaction} from '../../ws-server/poker/handlers/reaction.mjs';
import {createOfflineGame, HUMAN, STORAGE_KEY} from './offline-game.mjs';
const game=createOfflineGame({storage:window.localStorage});
let listener, timer, active=false, epoch=0, reactionListener, lastBotReaction=0, renderedToken;
function botReaction(before){
  if(!reactionListener || Date.now()-lastBotReaction<4000) return;
  const session=game.read().session,s=session?.state;if(!s)return;
  const botSeats=session.members.filter(m=>m.userId!==HUMAN).map(m=>({userId:m.userId,seatNo:m.seat}));
  const candidate=s.phase==='SETTLED' && before.phase!=='SETTLED'
    ? classifySettlementReaction({state:s,botSeats})
    : s.currentBet>before.currentBet ? classifyRaiseReaction({actorUserId:before.turnUserId,actorSeatNo:session.members.find(m=>m.userId===before.turnUserId)?.seat,street:s.phase,botSeats})
    : classifyAmbientReaction({botSeats});
  if(candidate){lastBotReaction=Date.now();reactionListener({payload:{...candidate,seatNo:candidate.botSeatNo}});}
}
function publish(){
  if(listener && game.read().session){
    const token=game.timerToken(),snapshot=game.snapshot();
    renderedToken=token.revision===snapshot.stateVersion?token:null;
    listener(snapshot);
  }
  updateWallet();
}
function fail(error){
  const node=document.getElementById('offlineError')||document.getElementById('pokerV2ErrorText');
  if(node){node.textContent=error.message;node.hidden=false;}
}
function updateWallet(){
  const data=game.read(),settled=data.session?.state.phase==='SETTLED';
  document.querySelectorAll('[data-practice-balance]').forEach(el=>{el.textContent=data.wallet.toLocaleString()+' Practice Chips';});
  const resume=document.getElementById('offlineResume');if(resume) resume.hidden=!data.session;
  const rebuy=document.getElementById('offlineRebuy');if(rebuy)rebuy.disabled=!settled;
}
function schedule(){
  clearTimeout(timer);
  if(!active||document.hidden||!listener)return;
  const pending=game.pendingTimer();if(!pending)return;
  timer=setTimeout(()=>run(()=>active&&!document.hidden?game.tick(pending.token):false).catch(fail),pending.delayMs);
}
async function run(fn){
  if(!navigator.locks)throw new Error('This browser cannot safely save Offline play');
  return navigator.locks.request(STORAGE_KEY,async()=>{
    const before=game.read().session?.state,lastAction=game.read().session?.lastAction;
    const result=await fn();publish();
    if(before && JSON.stringify(lastAction)!==JSON.stringify(game.read().session?.lastAction))botReaction(before);
    schedule();return result;
  });
}
async function activate(){
  if(active||!listener||document.hidden)return;
  const generation=++epoch;
  await run(()=>{if(generation!==epoch||document.hidden)return;game.resume(true);active=true;});
}
async function park(){
  epoch++;active=false;clearTimeout(timer);
  if(listener){
    try{await run(()=>game.pause());}
    catch(error){if(!document.hidden){active=true;schedule();}throw error;}
  }
}
let resolveConfirmation;
function cancelDialog(){
  const dialog=document.getElementById('offlineConfirm');
  if(dialog?.open){dialog.close('cancel');return true;}
  const leave=document.getElementById('pokerV2LeaveConfirmModal');
  if(leave&&!leave.hidden){document.getElementById('pokerV2LeaveConfirmCancel').click();return true;}
  return false;
}
function ask(title,message){
  const dialog=document.getElementById('offlineConfirm');
  if(!dialog)return Promise.reject(new Error('Practice confirmation unavailable'));
  document.getElementById('offlineConfirmTitle').textContent=title;
  document.getElementById('offlineConfirmCopy').textContent=message;
  return new Promise(resolve=>{resolveConfirmation=resolve;dialog.showModal();document.getElementById('offlineConfirmCancel').focus();});
}
async function backToLobby(){
  if(cancelDialog())return;
  await park();window.location.assign('/poker/');
}
window.PokerOffline={
  human:HUMAN,read:game.read,backToLobby,cancelDialog,
  start(fn,reactions){listener=fn;reactionListener=reactions;activate().catch(fail);},
  act(action){const expected=renderedToken;return run(()=>active&&expected?game.act(action,expected):false);},
  leave(){
    clearTimeout(timer);
    return run(()=>{const result=game.leave();active=false;epoch++;return result;}).catch(error=>{schedule();throw error;});
  },
  rebuy(){return run(()=>game.rebuy());},
  reaction(key,targetSeatNo){if(reactionListener)reactionListener({payload:{seatNo:1,reactionKey:key,...(targetSeatNo?{targetSeatNo}:{})}});},
  inspect(){return game.read();}
};
function init(){
  const dialog=document.getElementById('offlineConfirm');
  if(dialog){
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close('cancel');});
    dialog.addEventListener('close',()=>{const resolve=resolveConfirmation;resolveConfirmation=null;if(resolve)resolve(dialog.returnValue==='confirm');});
    document.getElementById('offlineConfirmYes').addEventListener('click',()=>dialog.close('confirm'));
    document.getElementById('offlineConfirmCancel').addEventListener('click',()=>dialog.close('cancel'));
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&cancelDialog())event.preventDefault();});
  const plugins=window.Capacitor?.Plugins;
  if(window.location.pathname==='/poker/offline/play.html'){
    if(plugins?.App){
      plugins.App.addListener('backButton',()=>backToLobby().catch(fail));
      plugins.App.addListener('appStateChange',event=>(event.isActive?activate():park()).catch(fail));
    }
    if(plugins?.SystemBars)Promise.resolve(plugins.SystemBars.hide()).catch(()=>{});
  }
  try{updateWallet();}catch(error){fail(error);}
  const action=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',()=>run(fn).catch(fail));};
  action('offlinePlay',async()=>{
    const buyIn=Number(document.querySelector('[name="offlineBuyIn"]:checked')?.value||100);
    if(game.read().session){
      if(!await ask('New Offline game','Settle and leave the current practice session before starting a new game?'))return;
      game.leave();
    }
    await game.newGame(buyIn);window.location.assign('/poker/offline/play.html');
  });
  const resume=document.getElementById('offlineResume');if(resume)resume.addEventListener('click',()=>window.location.assign('/poker/offline/play.html'));
  document.querySelectorAll('[data-offline-refill]').forEach(el=>el.addEventListener('click',()=>run(()=>game.refill()).catch(fail)));
  action('offlineRefill',()=>game.refill());
  action('offlineRebuy',()=>game.rebuy());
  action('offlineReset',async()=>{
    if(await ask('Reset Practice Chips','Discard only this device’s Practice Chips and Offline session? Online CH is unaffected.')){
      clearTimeout(timer);window.localStorage.removeItem(STORAGE_KEY);window.location.assign('/poker/');
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)cancelDialog();
    (document.hidden?park():activate()).catch(fail);
  });
  window.addEventListener('pagehide',()=>{park().catch(fail);});
  window.addEventListener('storage',event=>{
    if(event.key===STORAGE_KEY){clearTimeout(timer);try{publish();schedule();}catch(error){fail(error);}}
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
