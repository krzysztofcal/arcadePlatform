import { buildBootstrappedPokerState, buildNextHandStateFromSettled } from '../../ws-server/poker/engine/poker-engine.mjs';
import { applyAction } from '../../ws-server/poker/shared/poker-action-reducer.mjs';
import { computeSharedLegalActions } from '../../ws-server/poker/shared/poker-primitives.mjs';
import { chooseBotActionProfiled, enrichBotLegalActions, clampRandom } from '../../ws-server/poker/shared/poker-bot-strategy.mjs';
import { projectRoomCoreSnapshot } from '../../ws-server/poker/read-model/room-core-snapshot.mjs';
import { stampTurnDeadline, decideTurnTimeout } from '../../ws-server/poker/shared/poker-turn-timeout.mjs';
import { computeTargetBotCount } from '../../shared/poker-domain/bots.mjs';
import { prepareSeed } from './browser-crypto.mjs';

export const STORAGE_KEY = 'arcade.poker.offline.v1';
export const HUMAN = 'offline-human';
const legacyMembers = [HUMAN, 'bot-offline-1', 'bot-offline-2'].map((userId,i)=>({userId,seat:i+1}));
const clone = value => JSON.parse(JSON.stringify(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
function core(session) {
  const members=session.members,ids=members.map(m=>m.userId);
  return {version:session.hand, roomId:session.tableId, members,
    seats:Object.fromEntries(members.map(m=>[m.userId,m.seat])),
    seatDetailsByUserId:Object.fromEntries(ids.map(id=>[id,{isBot:id!==HUMAN,botProfile:'NORMAL'}])),pokerState:session.state};
}
// A single localStorage record is the transaction: wallet and session never split.
// Each mutation rereads it synchronously; async deals use revision compare-and-set.
// Failed writes leave the previously committed snapshot intact. No online imports.
export function createOfflineGame({storage, prepare=prepareSeed, random=Math.random, uuid=()=>crypto.randomUUID(), now=Date.now}={}) {
  function read() {
    const raw=storage.getItem(STORAGE_KEY);
    if(raw===null) return {schema:1,revision:0,wallet:5000,session:null};
    let data;
    try {data=JSON.parse(raw);} catch {throw new Error('Offline storage is corrupt; reset local offline data to continue');}
    if(data?.schema!==1 || !integer(data.wallet) || !integer(data.revision)) throw new Error('Unsupported offline storage');
    if(data.session) {
      const s=data.session;
      // Existing v1 sessions predate the persisted roster and always have two bots.
      if(!s.members)s.members=legacyMembers.map(m=>({...m}));
      if(!Array.isArray(s.members)||s.members.length<3||s.members.length>6||!s.members.every((m,i)=>m?.seat===i+1&&m.userId===(i===0?HUMAN:'bot-offline-'+i)))throw new Error('Invalid offline storage roster');
      const ids=s.members.map(m=>m.userId);
      if(typeof s.tableId!=='string'||!s.tableId.startsWith('offline-')||!integer(s.hand)||s.hand<1||![100,500,1000].includes(s.buyIn)||!s.state||s.state.roomId!==s.tableId||typeof s.state.handId!=='string'||!integer(s.state.potTotal)||!ids.every(id=>integer(s.state.stacks?.[id]))||Object.keys(s.state.stacks).length!==ids.length) throw new Error('Invalid offline storage session');
      if(s.clock && (typeof s.clock.paused!=='boolean'||!integer(s.clock.durationMs)||s.clock.durationMs<1||s.clock.durationMs>20000||!integer(s.clock.remainingMs)||s.clock.remainingMs>s.clock.durationMs||!integer(s.clock.dueAt)))throw new Error('Invalid offline storage clock');
      if(s.clock && ((s.clock.botDueAt!=null&&!integer(s.clock.botDueAt))||(s.clock.botRemainingMs!=null&&(!integer(s.clock.botRemainingMs)||s.clock.botRemainingMs>2000))))throw new Error('Invalid offline storage bot timer');
    }
    return data;
  }
  function refillWallet(data) {
    if(data.wallet>=100) return false;
    data.wallet=Math.max(5000,data.wallet);return true;
  }
  function save(data, revision) {
    if(read().revision!==revision) throw new Error('Offline session changed in another tab; resume it');
    // Refill is part of this same wallet/session commit, never a second write.
    refillWallet(data);
    data.revision=revision+1; storage.setItem(STORAGE_KEY,JSON.stringify(data));
    return clone(data);
  }
  function mutate(fn) { const data=read(), revision=data.revision; const result=fn(data); save(data,revision); return result; }
  function session(data) {if(!data.session) throw new Error('No offline session');return data.session;}
  function legalFor(s,id) {return computeSharedLegalActions({statePublic:s.state,userId:id});}
  function token(data) {const s=data.session;return s ? {tableId:s.tableId,handId:s.state.handId,userId:s.state.turnUserId,revision:data.revision} : null;}
  function matches(expected,data) {const current=token(data);return !expected || !!current && ['tableId','handId','userId','revision'].every(key=>expected[key]===current[key]);}
  function stampClock(s) {
    const durationMs=s.state.phase==='SETTLED'?3000:20000;
    const botDelay=s.state.phase!=='SETTLED'&&s.state.turnUserId!==HUMAN?1000+Math.floor(clampRandom(random)*1001):null;
    s.state=stampTurnDeadline(s.state,now(),durationMs);
    s.clock={paused:false,durationMs,remainingMs:durationMs,dueAt:now()+durationMs,botDueAt:botDelay===null?null:now()+botDelay,botRemainingMs:botDelay};
  }
  function apply(s,id,action,source=id===HUMAN?'human':'bot') {
    if(s.state.turnUserId!==id) throw new Error('Not your turn');
    const result=applyAction({pokerState:s.state,userId:id,action:action.type,amount:action.amount,nowIso:new Date(now()).toISOString()});
    if(!result.ok) throw new Error(result.reason); s.state=result.state;
    s.lastAction={userId:id,type:action.type,source,at:now()};stampClock(s);
  }
  function bot(s) {
    const id=s.state.turnUserId;
    if(!id || id===HUMAN) return false;
    const action=chooseBotActionProfiled(enrichBotLegalActions(legalFor(s,id)),{userId:id,profile:'NORMAL',state:s.state,random});
    if(!action) throw new Error('No legal bot decision'); apply(s,id,action); return true;
  }
  const api = {
    read,
    timerToken() {return token(read());},
    pendingTimer() {
      const data=read(),s=data.session;
      if(!s || !s.clock || s.clock.paused || (s.state.phase==='SETTLED' && s.state.stacks[HUMAN]<2)) return null;
      const dueAt=s.clock.botDueAt==null?s.clock.dueAt:Math.min(s.clock.dueAt,s.clock.botDueAt);
      return {token:token(data),delayMs:Math.max(0,dueAt-now())};
    },
    pause() {
      const data=read(),s=data.session;if(!s||s.clock?.paused) return false;
      const revision=data.revision;
      if(!s.clock) stampClock(s);
      s.clock.remainingMs=Math.max(1000,Math.min(s.clock.durationMs,s.clock.dueAt-now()));
      if(s.clock.botDueAt!=null)s.clock.botRemainingMs=Math.max(0,s.clock.botDueAt-now());
      s.clock.paused=true;
      s.state={...s.state,turnStartedAt:null,turnDeadlineAt:null};save(data,revision);return true;
    },
    resume(restart=false) {
      const data=read(),s=data.session;if(!s || (s.clock && !s.clock.paused && !restart)) return false;
      const revision=data.revision;
      if(!s.clock || (s.state.phase!=='SETTLED'&&s.clock.durationMs!==20000)) stampClock(s);
      const duration=s.clock.durationMs,remaining=Math.max(1000,Math.min(duration,s.clock.remainingMs));
      s.state=stampTurnDeadline(s.state,now()-(duration-remaining),duration);
      const botRemaining=s.clock.botRemainingMs??null;
      s.clock={paused:false,durationMs:duration,remainingMs:remaining,dueAt:now()+remaining,botDueAt:botRemaining===null?null:now()+botRemaining,botRemainingMs:botRemaining};save(data,revision);return true;
    },
    async tick(expected) {
      const data=read(),s=data.session;
      if(!s || !expected || !matches(expected,data) || !s.clock || s.clock.paused) return false;
      if(s.state.phase==='SETTLED') {if(now()<s.clock.dueAt||s.state.stacks[HUMAN]<2)return false;return api.nextHand(expected);}
      const decision=decideTurnTimeout({pokerState:s.state,nowMs:now(),turnMs:20000});
      if(decision.due) apply(s,decision.actorUserId,decision.action,'timeout');
      else if(s.state.turnUserId!==HUMAN&&s.clock.botDueAt!=null&&now()>=s.clock.botDueAt) {if(!bot(s))return false;}
      else return false;
      save(data,data.revision);return true;
    },
    async newGame(buyIn) {
      if(![100,500,1000].includes(buyIn)) throw new Error('Invalid Offline Chips buy-in');
      const data=read(),revision=data.revision;
      if(data.session) throw new Error('Leave the current session before New Game');
      refillWallet(data);
      if(data.wallet<buyIn) throw new Error('Not enough Offline Chips for this buy-in');
      const count=computeTargetBotCount({maxPlayers:6,humanCount:1,minBots:2,maxBots:5,random});
      const members=Array.from({length:count+1},(_,i)=>({userId:i===0?HUMAN:'bot-offline-'+i,seat:i+1}));
      const ids=members.map(m=>m.userId);
      const s={tableId:'offline-'+uuid(),buyIn,hand:1,members,state:null};
      await prepare(`ws_seed_${s.tableId}_1_${members.length}`);
      s.state=buildBootstrappedPokerState({tableId:s.tableId,coreState:core(s),startingStacks:Object.fromEntries(ids.map(id=>[id,buyIn]))});
      if(!s.state) throw new Error('Offline deal failed'); stampClock(s); data.wallet-=buyIn;data.session=s;save(data,revision);
    },
    async nextHand(expected) {
      const data=read(),revision=data.revision; if(!matches(expected,data))return false;const s=session(data);
      if(s.state.phase!=='SETTLED') throw new Error('Hand is not settled');
      if(s.state.stacks[HUMAN]<2) throw new Error('Rebuy or Leave to continue');
      // Local bots get a fresh practice stack only when broke, never from the wallet.
      for(const {userId:id} of s.members.slice(1)) if(s.state.stacks[id]<2) s.state.stacks[id]=s.buyIn;
      s.hand++;
      await prepare(`ws_seed_${s.tableId}_${s.hand}_${s.members.length}`);
      if(expected && !matches(expected,read())) return false;
      const next=buildNextHandStateFromSettled({tableId:s.tableId,coreState:core(s),settledState:s.state,nextVersion:s.hand});
      if(!next) throw new Error('Offline rollover failed');s.state=next;stampClock(s);save(data,revision);return true;
    },
    legal() {return legalFor(session(read()),HUMAN);},
    act(action,expected) {
      const data=read();if(!matches(expected,data))return false;const s=session(data);
      if(action.handId && action.handId!==s.state.handId)return false;
      apply(s,HUMAN,action);save(data,data.revision);return true;
    },
    botStep() {return mutate(data=>bot(session(data)));},
    leave() {
      const data=read(); if(!data.session) {
        if(refillWallet(data)) save(data,data.revision);
        return {wallet:data.wallet,cashout:0};
      }
      const revision=data.revision,s=data.session;
      // Resolve the existing hand with canonical rules before refunding only the human stack.
      for(let n=0;s.state.phase!=='SETTLED'&&n<300;n++) {
        if(s.state.turnUserId===HUMAN) apply(s,HUMAN,{type:'FOLD'}); else if(!bot(s)) throw new Error('Offline hand cannot finish');
      }
      if(s.state.phase!=='SETTLED') throw new Error('Offline hand did not settle');
      const cashout=s.state.stacks[HUMAN];data.wallet+=cashout;data.session=null;save(data,revision);
      return {wallet:data.wallet,cashout};
    },
    rebuy() {return mutate(data=>{
      const s=session(data);if(s.state.phase!=='SETTLED') throw new Error('Rebuy requires settled hand');
      refillWallet(data);
      const amount=Math.max(0,s.buyIn-s.state.stacks[HUMAN]);
      if(data.wallet<amount) throw new Error('Not enough Offline Chips for Rebuy');
      data.wallet-=amount;s.state.stacks[HUMAN]+=amount;stampClock(s);
    });},
    refill() {const data=read();if(!refillWallet(data))return false;save(data,data.revision);return true;},
    snapshot() {
      const data=read(),s=session(data),members=s.members;
      return {...projectRoomCoreSnapshot({tableId:s.tableId,roomId:s.tableId,coreState:core(s),members,userId:HUMAN,youSeat:1}),
        tableId:s.tableId,stateVersion:data.revision,youSeat:1,table:{status:'OPEN',maxSeats:members.length,buyIn:s.buyIn}};
    }
  };
  return api;
}
