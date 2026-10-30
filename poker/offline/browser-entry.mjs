import {classifyRaiseReaction, classifySettlementReaction, classifyAmbientReaction} from '../../ws-server/poker/handlers/reaction.mjs';
import {createOfflineGame, HUMAN, STORAGE_KEY} from './offline-game.mjs';
const game=createOfflineGame({storage:window.localStorage});
let listener, timer, active=false, epoch=0, reactionListener, lastBotReaction=0, renderedToken, clearPreactions, viewReady=false;
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
  const recovery=document.getElementById('offlineRecoveryReset');
  if(recovery)recovery.hidden=error.code!=='OFFLINE_STORAGE_INVALID';
  const node=document.getElementById('offlineError')||document.getElementById('pokerV2ErrorText');
  if(node){node.textContent=error.message;node.hidden=false;}
}
function updateWallet(){
  const data=game.read(),settled=data.session?.state.phase==='SETTLED';
  const recovery=document.getElementById('offlineRecoveryReset');
  if(recovery&&!recovery.hidden){recovery.hidden=true;const error=document.getElementById('offlineError');if(error)error.textContent='';}
  document.querySelectorAll('[data-offline-balance]').forEach(el=>{el.textContent=data.wallet.toLocaleString()+' Offline Chips';});
  const resume=document.getElementById('offlineResume');if(resume) resume.hidden=!data.session;
  const shell=document.getElementById('offlineResumeShell');if(shell)shell.hidden=!data.session;
  const play=document.getElementById('offlinePlay');if(play)play.textContent=data.session?'NEW GAME':'PLAY NOW';
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
async function activate(afterBack=false){
  if(active||!viewReady||!listener||document.hidden||(backNavigation&&!afterBack))return;
  const generation=++epoch;
  await run(()=>{if(generation!==epoch||document.hidden)return;game.resume(true);active=true;});
}
async function park(){
  epoch++;active=false;clearTimeout(timer);if(clearPreactions)clearPreactions();
  if(listener){
    try{await run(()=>game.pause());}
    catch(error){if(!document.hidden){active=true;schedule();}throw error;}
  }
}
let resolveConfirmation,backNavigation;
function cancelDialog(){
  if(backNavigation&&!backNavigation.navigating)backNavigation.cancelled=true;
  const dialog=document.getElementById('offlineConfirm');
  if(dialog?.open){dialog.close('cancel');return true;}
  if(backNavigation&&!backNavigation.navigating)return true;
  const leave=document.getElementById('pokerV2LeaveConfirmModal');
  if(leave&&!leave.hidden){document.getElementById('pokerV2LeaveConfirmCancel').click();return true;}
  return false;
}
function ask(title,message,labels={}){
  const dialog=document.getElementById('offlineConfirm');
  if(!dialog)return Promise.reject(new Error('Offline confirmation unavailable'));
  document.getElementById('offlineConfirmTitle').textContent=title;
  document.getElementById('offlineConfirmCopy').textContent=message;
  document.getElementById('offlineConfirmCancel').textContent=labels.cancel||'Cancel';
  document.getElementById('offlineConfirmYes').textContent=labels.confirm||'Confirm';
  return new Promise(resolve=>{resolveConfirmation=resolve;dialog.showModal();document.getElementById('offlineConfirmCancel').focus();});
}
async function backToLobby(){
  if(backNavigation){
    if(!backNavigation.navigating){backNavigation.cancelled=true;cancelDialog();}
    return backNavigation.promise;
  }
  if(cancelDialog())return;
  const request={cancelled:false,navigating:false,promise:null};
  backNavigation=request;
  request.promise=(async()=>{
    await park();
    const confirmed=!request.cancelled&&await ask(
      'Return to lobby?',
      'Your Offline game will be saved. You can continue later using Resume.',
      {cancel:'Keep playing',confirm:'Return to lobby'}
    );
    if(confirmed&&!request.cancelled){
      request.navigating=true;
      try{window.location.assign('/poker/index.html');}
      catch(error){request.navigating=false;await activate(true);throw error;}
    }else await activate(true);
  })().finally(()=>{if(!request.navigating)backNavigation=null;});
  return request.promise;
}
async function restorePage(event){
  if(!event.persisted)return;
  if(backNavigation?.navigating)backNavigation=null;
  await activate();
}
async function startView(fn,reactions,onPause,ready){
  listener=fn;reactionListener=reactions;clearPreactions=onPause;active=false;viewReady=false;
  await run(()=>{
    const session=game.read().session;
    if(session&&!session.clock?.paused){game.resume(true);game.pause();}
  });
  await ready();
  viewReady=true;
  await activate();
}
window.PokerOffline={
  human:HUMAN,read:game.read,backToLobby,cancelDialog,isActive:()=>active,
  start(fn,reactions,onPause,ready){return startView(fn,reactions,onPause,ready).catch(error=>{fail(error);window.location.replace('/poker/index.html');});},
  act(action){const expected=renderedToken,generation=epoch;return run(()=>active&&expected&&generation===epoch?game.act(action,expected):false);},
  leave(){
    epoch++;clearTimeout(timer);if(clearPreactions)clearPreactions();
    return run(()=>{const result=game.leave();active=false;return result;}).catch(error=>{schedule();throw error;});
  },
  rebuy(){return run(()=>game.rebuy());},
  reaction(key,targetSeatNo){if(reactionListener)reactionListener({payload:{seatNo:1,reactionKey:key,...(targetSeatNo?{targetSeatNo}:{})}});},
  inspect(){return game.read();}
};
async function resetOfflineProgress(){
  if(!navigator.locks)throw new Error('This browser cannot safely save Offline play');
  return navigator.locks.request(STORAGE_KEY,async()=>{
    if(!await ask('Reset Offline Progress','Discard only this device’s Offline Chips and Offline session? Online CH is unaffected.'))return;
    epoch++;active=false;clearTimeout(timer);if(clearPreactions)clearPreactions();
    window.localStorage.removeItem(STORAGE_KEY);
    window.location.assign('/poker/index.html');
  });
}
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
  run(()=>game.refill()).catch(fail);
  const action=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',()=>run(fn).catch(fail));};
  document.querySelectorAll('[data-offline-buy-in]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('[data-offline-buy-in]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
  }));
  action('offlinePlay',async()=>{
    const buyIn=Number(document.querySelector('[data-offline-buy-in][aria-pressed="true"]')?.dataset.offlineBuyIn||100);
    if(game.read().session){
      if(!await ask('New Offline game','Settle and leave the current offline session before starting a new game?'))return;
      game.leave();
    }
    await game.newGame(buyIn);game.pause();window.location.assign('/poker/offline/play.html');
  });
  const resume=document.getElementById('offlineResume');if(resume)resume.addEventListener('click',()=>window.location.assign('/poker/offline/play.html'));
  action('offlineRebuy',()=>game.rebuy());
  ['offlineReset','offlineRecoveryReset'].forEach(id=>{
    const button=document.getElementById(id);
    if(button)button.addEventListener('click',()=>resetOfflineProgress().catch(fail));
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)cancelDialog();
    (document.hidden?park():activate()).catch(fail);
  });
  window.addEventListener('pagehide',()=>{park().catch(fail);});
  window.addEventListener('pageshow',event=>{restorePage(event).catch(fail);});
  window.addEventListener('storage',event=>{
    if(event.key===STORAGE_KEY){clearTimeout(timer);try{publish();schedule();}catch(error){fail(error);}}
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
