import {classifyRaiseReaction, classifySettlementReaction, classifyAmbientReaction} from '../../ws-server/poker/handlers/reaction.mjs';
import {createOfflineGame, HUMAN, STORAGE_KEY} from './offline-game.mjs';
const game=createOfflineGame({storage:window.localStorage});
let listener, timer, busy=false, reactionListener, lastBotReaction=0;
const botSeats=[{userId:'bot-offline-1',seatNo:2},{userId:'bot-offline-2',seatNo:3}];
function botReaction(before){
  if(!reactionListener || Date.now()-lastBotReaction<4000) return;
  const s=game.read().session?.state;if(!s)return;
  const candidate=s.phase==='SETTLED' && before.phase!=='SETTLED'
    ? classifySettlementReaction({state:s,botSeats})
    : s.currentBet>before.currentBet ? classifyRaiseReaction({actorUserId:before.turnUserId,actorSeatNo:before.turnUserId===HUMAN?1:before.turnUserId==='bot-offline-1'?2:3,street:s.phase,botSeats})
    : classifyAmbientReaction({botSeats});
  if(candidate){lastBotReaction=Date.now();reactionListener({payload:{...candidate,seatNo:candidate.botSeatNo}});}
}
function publish(){ if(listener && game.read().session) listener(game.snapshot()); updateWallet(); }
function fail(error){
  const node=document.getElementById('offlineError'); if(node) node.textContent=error.message;
}
function updateWallet(){
  const data=game.read();
  document.querySelectorAll('[data-practice-balance]').forEach(el=>{el.textContent=data.wallet.toLocaleString()+' Practice Chips';});
  const resume=document.getElementById('offlineResume');if(resume) resume.hidden=!data.session;
  const controls=document.getElementById('offlineSessionControls');
  if(controls){
    const settled=data.session?.state.phase==='SETTLED';
    document.getElementById('offlineNext').disabled=!settled || data.session.state.stacks[HUMAN]<2;
    document.getElementById('offlineRebuy').disabled=!settled;
  }
}
function scheduleBots(){
  clearTimeout(timer);
  const s=game.read().session;
  if(document.hidden||!s||!s.state.turnUserId||s.state.turnUserId===HUMAN) return;
  timer=setTimeout(()=>{
    run(()=>{const before=game.read().session.state;game.botStep();publish();botReaction(before);}).catch(fail);
  },350);
}
async function run(fn){
  if(busy) throw new Error('Offline operation already in progress');
  busy=true;
  try{
    if(!navigator.locks) throw new Error('This browser cannot safely save Offline play');
    await navigator.locks.request(STORAGE_KEY,async()=>{await fn();publish();scheduleBots();});
  }finally{busy=false;}
}
window.PokerOffline={
  human:HUMAN, read:game.read,
  start(fn,reactions){listener=fn;reactionListener=reactions;publish();scheduleBots();},
  act(action){return run(()=>{const before=game.read().session.state;game.act(action);publish();botReaction(before);});},
  leave(){clearTimeout(timer);return run(()=>game.leave());},
  rebuy(){return run(()=>game.rebuy());},
  reaction(key){if(reactionListener) reactionListener({payload:{seatNo:1,reactionKey:key}});},
  inspect(){return game.read();}
};
function init(){
  if(window.location.pathname==='/poker/offline/play.html'){
    // Existing native bridge only; no Auth/config/WS bootstrap on this entrypoint.
    const plugins=window.Capacitor?.Plugins;
    if(plugins?.App) plugins.App.addListener('backButton',()=>document.getElementById('pokerLobbyLink')?.click());
    if(plugins?.SystemBars) Promise.resolve(plugins.SystemBars.hide()).catch(()=>{});
  }
  try{updateWallet();}catch(error){fail(error);}
  const action=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',()=>run(fn).catch(fail));};
  action('offlinePlay',async()=>{
    const buyIn=Number(document.querySelector('[name="offlineBuyIn"]:checked')?.value||100);
    if(game.read().session){
      if(!window.confirm('Settle and leave the current Offline session before starting a new game?')) return;
      game.leave();
    }
    await game.newGame(buyIn);window.location.assign('/poker/offline/play.html');
  });
  const resume=document.getElementById('offlineResume');if(resume)resume.addEventListener('click',()=>window.location.assign('/poker/offline/play.html'));
  action('offlineRefill',()=>game.refill());
  action('offlineNext',()=>game.nextHand());
  action('offlineRebuy',()=>game.rebuy());
  action('offlineLeave',()=>{game.leave();window.location.assign('/poker/');});
  action('offlineReset',()=>{
    if(window.confirm('Reset only local Practice Chips and offline session? Online CH is unaffected.')){
      clearTimeout(timer);window.localStorage.removeItem(STORAGE_KEY);window.location.assign('/poker/');
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else scheduleBots();});
  window.addEventListener('storage',event=>{
    if(event.key===STORAGE_KEY){clearTimeout(timer);try{publish();scheduleBots();}catch(error){fail(error);}}
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
