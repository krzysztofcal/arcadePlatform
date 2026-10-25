import { buildBootstrappedPokerState, buildNextHandStateFromSettled } from '../../ws-server/poker/engine/poker-engine.mjs';
import { applyAction } from '../../ws-server/poker/shared/poker-action-reducer.mjs';
import { computeSharedLegalActions } from '../../ws-server/poker/shared/poker-primitives.mjs';
import { chooseBotActionProfiled, enrichBotLegalActions } from '../../ws-server/poker/shared/poker-bot-strategy.mjs';
import { projectRoomCoreSnapshot } from '../../ws-server/poker/read-model/room-core-snapshot.mjs';
import { prepareSeed } from './browser-crypto.mjs';

export const STORAGE_KEY = 'arcade.poker.offline.v1';
export const HUMAN = 'offline-human';
const ids = [HUMAN, 'bot-offline-1', 'bot-offline-2'];
const members = ids.map((userId,i)=>({userId,seat:i+1}));
const clone = value => JSON.parse(JSON.stringify(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
function core(session) {
  return {version:session.hand, roomId:session.tableId, members,
    seats:Object.fromEntries(members.map(m=>[m.userId,m.seat])),
    seatDetailsByUserId:Object.fromEntries(ids.map(id=>[id,{isBot:id!==HUMAN,botProfile:'NORMAL'}])),pokerState:session.state};
}
// A single localStorage record is the transaction: wallet and session never split.
// Each mutation rereads it synchronously; async deals use revision compare-and-set.
// Failed writes leave the previously committed snapshot intact. No online imports.
export function createOfflineGame({storage, prepare=prepareSeed, random=Math.random, uuid=()=>crypto.randomUUID()}={}) {
  function read() {
    const raw=storage.getItem(STORAGE_KEY);
    if(raw===null) return {schema:1,revision:0,wallet:5000,session:null};
    let data;
    try {data=JSON.parse(raw);} catch {throw new Error('Offline storage is corrupt; reset local practice data to continue');}
    if(data?.schema!==1 || !integer(data.wallet) || !integer(data.revision)) throw new Error('Unsupported offline storage');
    if(data.session) {
      const s=data.session;
      if(typeof s.tableId!=='string'||!s.tableId.startsWith('offline-')||!integer(s.hand)||s.hand<1||![100,500,1000].includes(s.buyIn)||!s.state||s.state.roomId!==s.tableId||typeof s.state.handId!=='string'||!integer(s.state.potTotal)||!ids.every(id=>integer(s.state.stacks?.[id]))) throw new Error('Invalid offline storage session');
    }
    return data;
  }
  function save(data, revision) {
    if(read().revision!==revision) throw new Error('Offline session changed in another tab; resume it');
    data.revision=revision+1; storage.setItem(STORAGE_KEY,JSON.stringify(data));
    return clone(data);
  }
  function mutate(fn) { const data=read(), revision=data.revision; const result=fn(data); save(data,revision); return result; }
  function session(data) {if(!data.session) throw new Error('No offline session');return data.session;}
  function legalFor(s,id) {return computeSharedLegalActions({statePublic:s.state,userId:id});}
  function apply(s,id,action) {
    if(s.state.turnUserId!==id) throw new Error('Not your turn');
    const result=applyAction({pokerState:s.state,userId:id,action:action.type,amount:action.amount,nowIso:new Date().toISOString()});
    if(!result.ok) throw new Error(result.reason); s.state=result.state;
  }
  function bot(s) {
    const id=s.state.turnUserId;
    if(!id || id===HUMAN) return false;
    const action=chooseBotActionProfiled(enrichBotLegalActions(legalFor(s,id)),{userId:id,profile:'NORMAL',state:s.state,random});
    if(!action) throw new Error('No legal bot decision'); apply(s,id,action); return true;
  }
  return {
    read,
    async newGame(buyIn) {
      if(![100,500,1000].includes(buyIn)) throw new Error('Invalid Practice Chips buy-in');
      const data=read(),revision=data.revision;
      if(data.session) throw new Error('Leave the current session before New Game');
      if(data.wallet<buyIn) throw new Error('Not enough Practice Chips; use free refill');
      const s={tableId:'offline-'+uuid(),buyIn,hand:1,state:null};
      await prepare(`ws_seed_${s.tableId}_1_3`);
      s.state=buildBootstrappedPokerState({tableId:s.tableId,coreState:core(s),startingStacks:Object.fromEntries(ids.map(id=>[id,buyIn]))});
      if(!s.state) throw new Error('Offline deal failed'); data.wallet-=buyIn;data.session=s;save(data,revision);
    },
    async nextHand() {
      const data=read(),revision=data.revision,s=session(data);
      if(s.state.phase!=='SETTLED') throw new Error('Hand is not settled');
      if(s.state.stacks[HUMAN]<2) throw new Error('Rebuy or Leave to continue');
      // Local bots get a fresh practice stack only when broke, never from the wallet.
      for(const id of ids.slice(1)) if(s.state.stacks[id]<2) s.state.stacks[id]=s.buyIn;
      s.hand++;
      await prepare(`ws_seed_${s.tableId}_${s.hand}_3`);
      const next=buildNextHandStateFromSettled({tableId:s.tableId,coreState:core(s),settledState:s.state,nextVersion:s.hand});
      if(!next) throw new Error('Offline rollover failed');s.state=next;save(data,revision);
    },
    legal() {return legalFor(session(read()),HUMAN);},
    act(action) {return mutate(data=>apply(session(data),HUMAN,action));},
    botStep() {return mutate(data=>bot(session(data)));},
    leave() {
      const data=read(); if(!data.session) return {wallet:data.wallet,cashout:0};
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
      const amount=Math.max(0,s.buyIn-s.state.stacks[HUMAN]);
      if(data.wallet<amount) throw new Error('Not enough Practice Chips; use free refill');
      data.wallet-=amount;s.state.stacks[HUMAN]+=amount;
    });},
    refill() {return mutate(data=>{data.wallet=Math.max(5000,data.wallet);});},
    snapshot() {
      const data=read(),s=session(data);
      return {...projectRoomCoreSnapshot({tableId:s.tableId,roomId:s.tableId,coreState:core(s),members,userId:HUMAN,youSeat:1}),
        tableId:s.tableId,stateVersion:data.revision,youSeat:1,table:{status:'OPEN',maxSeats:3,buyIn:s.buyIn}};
    }
  };
}
