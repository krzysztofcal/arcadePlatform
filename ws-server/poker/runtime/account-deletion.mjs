import { createHash } from 'node:crypto';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { accountDeletionEnabled, advanceDeletion, scanDeletionRequests, lockAccountLifecycle, deleteAuthUser, deletionPokerSeatPendingSql } from '../../../shared/account-deletion.mjs';
import { retireUserForDeletion } from '../../../netlify/functions/_shared/chips-ledger.mjs';
import { blockRedisIdentity, cleanupRedisIdentity, isMemoryStore } from '../../../netlify/functions/_shared/store-upstash.mjs';
import { cleanupDeletionAvatars } from '../../../shared/account-deletion-storage.mjs';

const PRIVACY_MAPS = ['foldedByUserId','missedTurnsByUserId','contributionsByUserId','handStartStacksByUserId',
  'lastBettingRoundActionByUserId','allInByUserId','leftTableByUserId','actedThisRoundByUserId','toCallByUserId',
  'betThisRoundByUserId','sitOutByUserId','pendingAutoSitOutByUserId','pendingDetachByUserId',
  'waitingForNextHandByUserId','inactivityEjectionByUserId'];
const LIVE_PHASES = ['PREFLOP','FLOP','TURN','RIVER','SHOWDOWN'];
const privacyError = () => new Error('poker_privacy_unconfirmed');
const containsOwner = (value,userId) => JSON.stringify(value ?? null).toLowerCase().includes(userId.toLowerCase());

// No text replacement. The caller preserves the exact terminal settlement proof
// before removing its owner payout projection; unknown references fail closed.
export function projectDeletionPokerState(state,userId) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw privacyError();
  const next = structuredClone(state);
  for (const key of ['seats','handSeats']) if (Object.hasOwn(next,key)) {
    if (!Array.isArray(next[key])) throw privacyError();
    next[key] = next[key].filter(seat => String(seat?.userId || '').toLowerCase() !== userId.toLowerCase());
  }
  for (const key of PRIVACY_MAPS) if (Object.hasOwn(next,key)) {
    if (!next[key] || typeof next[key] !== 'object' || Array.isArray(next[key])) throw privacyError();
    for (const id of Object.keys(next[key])) if (id.toLowerCase() === userId.toLowerCase()) delete next[key][id];
  }
  if (next.handSettlement?.payouts && containsOwner(next.handSettlement,userId)) {
    if (state.phase!=='HAND_DONE'||state.handId!=='') throw privacyError();
    delete next.handSettlement.payouts[userId];
  }
  if (containsOwner(next,userId)) throw privacyError();
  return next;
}

const pokerReferencesSql = `select t.id from public.poker_tables t left join public.poker_state s on s.table_id=t.id
 where t.created_by=$1 or exists(select 1 from public.poker_seats p where p.table_id=t.id and p.user_id=$1)
 or strpos(lower(s.state::text),lower($1::text))>0 order by t.id`;

async function assertPrivacyWallet(tx,context,request) {
  const receipt = request?.progress?.walletRetirement;
  const [wallet] = await tx.unsafe("select * from public.chips_accounts where account_type='USER' and retired_user_id=$1;",[context.userId]);
  if (request?.request_id !== context.requestId || request.old_user_id !== context.userId || !receipt?.retiredAt
    || !wallet || wallet.id !== receipt.accountId || wallet.user_id != null || wallet.status !== 'closed' || Number(wallet.balance)!==0) throw privacyError();
  if (receipt.noBurn === true) {
    if (receipt.amount !== 0 || receipt.burnTransactionId != null) throw privacyError();
  } else {
    const [registry] = await tx.unsafe('select transaction_id from public.chips_transaction_idempotency where idempotency_key=$1;',['account-delete:'+context.requestId+':burn:v1']);
    if (!Number.isSafeInteger(receipt.amount) || receipt.amount<=0 || !registry || registry.transaction_id !== receipt.burnTransactionId) throw privacyError();
  }
}

export async function assertDeletionPokerAbsent(tx,userId) {
  if ((await tx.unsafe(pokerReferencesSql,[userId])).length) throw privacyError();
}

// SQL cannot safely bypass the runtime table queue/cache. The adapter is mandatory
// whenever there is a candidate; tests inject an explicit fixture-only adapter.
export async function cleanupDeletionPoker({context,beginSql,coordinate,resync = async()=>{},authorize = (tx)=>context.assertLease(tx),tableIds = null}) {
  await resync(context);
  const candidates = await beginSql(async tx => {
    await lockAccountLifecycle(tx,[context.userId]);
    const request = await authorize(tx);await assertPrivacyWallet(tx,context,request);
    return tx.unsafe(pokerReferencesSql,[context.userId]);
  });
  if (tableIds && candidates.some(row=>!tableIds.includes(row.id))) throw privacyError();
  if (candidates.length && typeof coordinate !== 'function') throw privacyError();
  for (const candidate of candidates.slice(0,5)) await coordinate(context,candidate.id,()=>beginSql(async tx=>{
    const [table] = await tx.unsafe('select id,status,created_by from public.poker_tables where id=$1 for update;',[candidate.id]);
    const [row] = await tx.unsafe('select version,state from public.poker_state where table_id=$1 for update;',[candidate.id]);
    await lockAccountLifecycle(tx,[context.userId]);
    const request=await authorize(tx);await assertPrivacyWallet(tx,context,request);
    const seats=await tx.unsafe('select * from public.poker_seats where table_id=$1 and user_id=$2 for update;',[candidate.id,context.userId]);
    const [escrow]=await tx.unsafe("select balance from public.chips_accounts where account_type='ESCROW' and system_key=$1;",['POKER_TABLE:'+candidate.id]);
    const pending=await tx.unsafe('select 1 from public.poker_requests where table_id=$1 and result_json is null limit 1;',[candidate.id]);
    const state=row?.state;
    if (!table || !state || !escrow || pending.length || !['OPEN','CLOSED'].includes(table.status)
      || !['INIT','HAND_DONE','SETTLED',...LIVE_PHASES].includes(state.phase)
      || seats.some(s=>s.status!=='INACTIVE'||Number(s.stack)!==0||s.leave_after_hand===true)
      || Object.hasOwn(state.stacks || {},context.userId) || state.pendingDetachByUserId?.[context.userId]===true
      || (LIVE_PHASES.includes(state.phase) && (containsOwner(state.handSeats || state.seats,context.userId)
        || Number(state.contributionsByUserId?.[context.userId] || 0)!==0))) throw privacyError();
    if (table.status==='CLOSED' && (state.phase!=='HAND_DONE' || state.handId!=='' || Number(escrow.balance)!==0)) throw privacyError();
    const amounts=map=>{if(!map||typeof map!=='object'||Array.isArray(map))throw privacyError();return Object.values(map).reduce((sum,v)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw privacyError();return sum+n;},0);};
    const expected=amounts(state.stacks)+(LIVE_PHASES.includes(state.phase)?amounts(state.contributionsByUserId):0);
    if (!Number.isSafeInteger(expected)||expected!==Number(escrow.balance)) throw Object.assign(new Error('financial_mismatch'),{code:'financial_mismatch'});
    const next=projectDeletionPokerState(state,context.userId);
    // Preserve the ORIGINAL settlement proof, unchanged, in the same durable
    // request as its immutable wallet proof before removing an owner projection.
    // This is retained financial evidence, not a fabricated settlement receipt.
    if (containsOwner(state.handSettlement,context.userId)) {
      const saved=request.progress?.pokerPrivacyFinancialReceipts?.[candidate.id];
      if(saved && JSON.stringify(saved)!==JSON.stringify(state.handSettlement))throw privacyError();
      await tx.unsafe(`update public.account_deletion_requests set progress=jsonb_set(progress,'{pokerPrivacyFinancialReceipts}',
        coalesce(progress->'pokerPrivacyFinancialReceipts','{}'::jsonb)||jsonb_build_object($2::text,$3::jsonb)) where request_id=$1;`,
        [context.requestId,candidate.id,JSON.stringify(state.handSettlement)]);
    }
    if (JSON.stringify(next)!==JSON.stringify(state)) {
      const changed=await tx.unsafe('update public.poker_state set state=$4::jsonb,version=version+1,updated_at=clock_timestamp() where table_id=$1 and version=$2 and state=$3::jsonb returning version;',
        [candidate.id,row.version,JSON.stringify(state),JSON.stringify(next)]);
      if(changed.length!==1)throw new Error('poker_privacy_conflict');
    }
    await tx.unsafe("delete from public.poker_seats where table_id=$1 and user_id=$2 and status='INACTIVE' and stack=0 returning table_id;",[candidate.id,context.userId]);
    await tx.unsafe('update public.poker_tables set created_by=null where id=$1 and created_by=$2;',[candidate.id,context.userId]);
  }));
  return beginSql(async tx=>{await lockAccountLifecycle(tx,[context.userId]);await authorize(tx);
    const remaining=await tx.unsafe(pokerReferencesSql,[context.userId]);
    return remaining.length?{waitUntil:new Date(Date.now()+1000).toISOString()}:{done:true};});
}

// A protected operator file, never an HTTP-supplied replacement manifest.
const REPAIR_MANIFEST='/opt/arcade-ws-preview/.poker-privacy-repair.json';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function pokerPrivacyStateSha256(state) {
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  return sha256(JSON.stringify(ordered(state)));
}
export function parsePokerRepairManifest(bytes,expectedSha256) {
  if(!/^[a-f0-9]{64}$/.test(expectedSha256||'')||sha256(bytes)!==expectedSha256)throw privacyError();
  const manifest=JSON.parse(bytes);
  if(manifest.version!==1||manifest.stage!=='krydukthwdvccggbyjfw'||!Array.isArray(manifest.tables)||manifest.tables.length!==2
    ||new Set(manifest.tables.map(t=>t.tableId)).size!==2||manifest.tables.some(t=>!Number.isSafeInteger(t.version)||t.version<0
      ||!['stateSha256','cleanedStateSha256'].every(k=>/^[a-f0-9]{64}$/.test(t[k]||''))))throw privacyError();
  return manifest;
}
export async function loadPokerRepairManifest(expectedSha256) {
  for(const path of ['/','/opt','/opt/arcade-ws-preview']) {
    const meta=await lstat(path);
    if(!meta.isDirectory()||meta.uid!==0||(meta.mode&0o022))throw privacyError();
  }
  const handle=await open(REPAIR_MANIFEST,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const meta=await handle.stat();
    if(!meta.isFile()||meta.uid!==0||meta.gid!==process.getgid()||meta.nlink!==1||(meta.mode&0o777)!==0o640||meta.size>16384)throw privacyError();
    const bytes=await handle.readFile();const after=await handle.stat();
    if(meta.size!==after.size||meta.mtimeMs!==after.mtimeMs||meta.ctimeMs!==after.ctimeMs)throw privacyError();
    return parsePokerRepairManifest(bytes,expectedSha256);
  } finally {await handle.close();}
}

// Existing token-protected internal maintenance API; no invented request/lease or
// feature activation. Caller MUST supply the same real WS queue/cache adapter.
export async function repairCompletedDeletionPoker({beginSql,userId,requestId,tableIds,manifest,coordinate,resync,env=process.env}) {
  if (env.SUPABASE_URL!=='https://krydukthwdvccggbyjfw.supabase.co'||env.ACCOUNT_DELETION_ENABLED!=='0') throw privacyError();
  if(manifest?.version!==1||manifest.stage!=='krydukthwdvccggbyjfw'||manifest.userId!==userId||manifest.requestId!==requestId
    ||!Array.isArray(manifest.tables)||manifest.tables.length!==2||manifest.tables.some(t=>!tableIds?.includes(t.tableId)))throw privacyError();
  if (!Array.isArray(tableIds)||tableIds.length!==2||new Set(tableIds).size!==2||typeof coordinate!=='function') throw privacyError();
  const rawBegin=beginSql;
  beginSql=fn=>rawBegin(async tx=>{await tx.unsafe("set local statement_timeout='5s';");await tx.unsafe("set local lock_timeout='5s';");return fn(tx);});
  const context={userId,requestId};
  const authorize=async tx=>{
    const [release]=await tx.unsafe("select enabled,redis_cutover->>'namespace' as namespace from public.account_deletion_release where id=true;");
    if(release?.enabled!==false||release.namespace!=='kcswh:stage:xp:v3')throw privacyError();
    const tables=await tx.unsafe('select id,status from public.poker_tables where id=any($1::uuid[]) order by id;',[tableIds]);
    if(tables.length!==2||tables.some(t=>t.status!=='CLOSED'))throw privacyError();
    const states=await tx.unsafe('select table_id,version,state from public.poker_state where table_id=any($1::uuid[]) order by table_id;',[tableIds]);
    if(states.length!==2)throw privacyError();
    for(const row of states) {
      const approved=manifest.tables.find(t=>t.tableId===row.table_id),hash=pokerPrivacyStateSha256(row.state);
      const original=Number(row.version)===approved?.version&&hash===approved.stateSha256;
      // Only the exact pre-approved projection/version is an idempotent retry.
      const cleaned=Number(row.version)===approved?.version+1&&hash===approved.cleanedStateSha256&&!containsOwner(row.state,userId);
      if(!original&&!cleaned)throw new Error('poker_privacy_manifest_drift');
    }
    const [request]=await tx.unsafe('select * from public.account_deletion_requests where request_id=$1 for update;',[requestId]);
    const [auth]=await tx.unsafe('select 1 from auth.users where id=$1;',[userId]);
    if (request?.old_user_id!==userId||request.status!=='COMPLETED'||request.phase!=='completed'||request.lease_until!=null||auth)throw privacyError();
    return request;
  };
  await resync?.(context);
  const ordered=[...tableIds].sort();
  // Hold both queues and both table/state locks: audit drift in either table
  // rolls back the entire repair, never a partially applied first table.
  return coordinate(context,ordered[0],()=>coordinate(context,ordered[1],()=>beginSql(async tx=>{
    await tx.unsafe('select id from public.poker_tables where id=any($1::uuid[]) order by id for update;',[ordered]);
    await tx.unsafe('select table_id from public.poker_state where table_id=any($1::uuid[]) order by table_id for update;',[ordered]);
    return cleanupDeletionPoker({context,beginSql:fn=>fn(tx),authorize,tableIds,
      coordinate:async(_context,_tableId,run)=>run()});
  })));

}

// The table-manager block fences queued commands and all persisted writer entry
// points until a successful canonical restore. Retry also resyncs tables whose
// SQL no longer has owner references, including a lost restore response.
export function createDeletionPokerCoordinator({enqueue,restore,block,unblock}) {
  const pending=new Map();
  const coordinate=(context,tableId,run)=>enqueue(tableId,async()=>{
    const previous=pending.get(tableId);
    if(previous&&(previous.userId!==context.userId||previous.requestId!==context.requestId))throw privacyError();
    pending.set(tableId,context);block(tableId);
    let result,error;
    try{result=await run();}catch(e){error=e;}
    let restored;try{restored=await restore(tableId);}catch{}
    if(!restored?.ok)throw new Error('poker_privacy_resync_required');
    unblock(tableId);pending.delete(tableId);
    if(error)throw error;
    return result;
  });
  return {coordinate,resync:async context=>{
    for(const [tableId,owner]of pending)if(owner.userId===context.userId&&owner.requestId===context.requestId)
      await coordinate(context,tableId,async()=>{});
  }};
}

// Existing WS tick owns scheduling. No new worker/service or browser dependency.
export function createAccountDeletionRuntime({ beginSql, leaveFromTable, disconnectUser, klog, env = process.env,
  blockIdentity = blockRedisIdentity, retireWallet = retireUserForDeletion,
  cleanupAvatars = cleanupDeletionAvatars, cleanupRedis = cleanupRedisIdentity, deleteAuth = deleteAuthUser, redisIsMemory = isMemoryStore,
  coordinatePokerPrivacy, resyncPokerPrivacy }) {
  // Bound lock/query waits within each effect transaction, below lease horizon.
  const rawBeginSql = beginSql;
  beginSql = (fn) => rawBeginSql(async (tx) => {
    await tx.unsafe("set local statement_timeout='5s';");
    await tx.unsafe("set local lock_timeout='5s';");
    return fn(tx);
  });
  let running = false;
  const transactionFor = (context, fn) => beginSql(async (tx) => {
    await lockAccountLifecycle(tx,[context.userId]);
    const request = await context.assertLease(tx);
    return fn(tx,request);
  });
  const steps = {
    preparing: async (context) => {
      if (redisIsMemory) throw new Error('distributed_redis_required');
      await blockIdentity(context.userId);
      await disconnectUser(context.userId);
      await transactionFor(context,async () => {});
      return {done:true};
    },
    poker: async (context) => {
      const rows = await transactionFor(context,(tx) => tx.unsafe(`select p.table_id from public.poker_seats p where p.user_id=$1 and ${deletionPokerSeatPendingSql}
        union select distinct s.table_id from public.poker_state s
        where exists(select 1 from public.poker_seats p where p.table_id=s.table_id and p.user_id=$1 and ${deletionPokerSeatPendingSql})
          or s.state->'stacks' ? $1::text
          or (s.state->>'phase' in ('PREFLOP','FLOP','TURN','RIVER','SHOWDOWN') and
            exists(select 1 from jsonb_array_elements(coalesce(s.state->'handSeats',s.state->'seats','[]'::jsonb)) h where h->>'userId'=$1::text));`,[context.userId]));
      const deadline = context.progress?.poker?.waitDeadline || new Date(Date.now()+30*60*1000).toISOString();
      if (rows.length && !context.progress?.poker?.waitDeadline) await transactionFor(context,(tx) => tx.unsafe(
        `update public.account_deletion_requests set progress=jsonb_set(progress,'{poker}', ($2::text)::jsonb) where request_id=$1;`,
        [context.requestId,JSON.stringify({waitDeadline:deadline})]));
      if (rows.length && Date.parse(deadline) <= Date.now()) throw new Error('poker_progress_overdue');
      for (const row of rows.slice(0,5)) {
        await transactionFor(context,async () => {});
        await leaveFromTable({tableId:row.table_id,userId:context.userId,requestId:context.requestId});
      }
      if (rows.length) return {waitUntil:new Date(Date.now()+15000).toISOString(),actionableAt:deadline};
      return {done:true};
    },
    burn: async (context) => {
      const started = Date.now();
      try {
        return await beginSql((tx) => retireWallet({tx,userId:context.userId,requestId:context.requestId,assertLease:context.assertLease}));
      } catch (error) {
        // Keep provider messages, SQL and parameters out of logs; preserve the
        // original error so durable retry/financial-incident rules still apply.
        klog('account_deletion_burn_failed', { requestId:context.requestId,
          sqlState:/^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : null,
          durationMs:Date.now()-started });
        throw error;
      }
    },
    cleanup: async (context) => {
      const avatar = await cleanupAvatars({...context,env,beginSql});
      if (avatar?.waitUntil) return avatar;
      if (avatar?.done !== true) throw new Error('storage_cleanup_unconfirmed');
      const redis = await cleanupRedis({userId:context.userId,cursor:context.progress?.redisCleanupCursor || null,beginSql,env});
      await transactionFor(context,(tx) => tx.unsafe(`update public.account_deletion_requests set progress=jsonb_set(progress,'{redisCleanupCursor}',($2::text)::jsonb),
        progress_at=case when $3 then clock_timestamp() else progress_at end,
        actionable_since=case when $3 then clock_timestamp() else actionable_since end where request_id=$1;`,[context.requestId,JSON.stringify(redis?.cursor || null),redis?.reason === 'redis_cleanup_scanning' && JSON.stringify(redis.cursor) !== JSON.stringify(context.progress?.redisCleanupCursor)]));
      // V3 owner index and durable legacy cutover attestation are required.
      if (redis?.done !== true) throw new Error('redis_cleanup_unconfirmed');
      const privacy=await cleanupDeletionPoker({context,beginSql,coordinate:coordinatePokerPrivacy,resync:resyncPokerPrivacy});
      if(privacy.done!==true)return privacy;
      await beginSql(async (tx) => {
        // Claims lock campaign before lifecycle. Match that order when removing
        // ownership/claims; never hold lifecycle while waiting on campaign rows.
        await tx.unsafe(`select c.id from public.bonus_campaigns c where c.created_by=$1
          or exists(select 1 from public.bonus_claims b where b.campaign_id=c.id and b.user_id=$1)
          or exists(select 1 from public.bonus_campaign_eligible_users e where e.campaign_id=c.id and (e.user_id=$1 or e.created_by=$1))
          order by c.id for update;`,[context.userId]);
        await lockAccountLifecycle(tx,[context.userId]);
        const request = await context.assertLease(tx);
        if (!request.progress?.walletRetirement?.retiredAt) throw Object.assign(new Error('financial_mismatch'),{code:'financial_mismatch'});
        await tx.unsafe('update public.bonus_campaigns set created_by=null where created_by=$1;',[context.userId]);
        await tx.unsafe('update public.bonus_campaign_eligible_users set created_by=null where created_by=$1;',[context.userId]);
        await tx.unsafe('delete from public.bonus_campaign_eligible_users where user_id=$1;',[context.userId]);
        await tx.unsafe('delete from public.bonus_claims where user_id=$1;',[context.userId]);
        await tx.unsafe('delete from public.favorites where user_id=$1;',[context.userId]);
        await tx.unsafe('select private.account_avatar_prepare_purge($1,$2,$3,$4);',
          [context.userId,context.requestId,context.generation,env.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER]);
        // Public manifests survive until the authorized Auth FK cascade.
        await tx.unsafe('delete from private.account_avatar_objects where user_id=$1;',[context.userId]);
        await tx.unsafe('delete from public.user_profiles where user_id=$1;',[context.userId]);
      });
      return {done:true};
    },
    auth: async (context) => {
      await resyncPokerPrivacy?.(context);
      return deleteAuth({userId:context.userId,supabaseUrl:env.SUPABASE_URL || env.SUPABASE_URL_V2,
      serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY,
      authorizeDeletion: (userId) => transactionFor(context,async (tx,request) => {
        const [guards] = await tx.unsafe('select private.account_avatar_guards_ready() as ready;');
        if (guards?.ready !== true || request.progress?.avatarPurge?.owner !== userId
          || request.progress?.avatarPurge?.requestId !== context.requestId
          || request.progress?.avatarPurge?.marker !== env.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER
          || userId !== request.old_user_id || request.phase !== 'auth' || request.progress?.cleanup?.done !== true
          || request.progress?.poker?.done !== true || !request.progress?.walletRetirement?.retiredAt) throw new Error('deletion_prerequisites_missing');
        await assertDeletionPokerAbsent(tx,userId);
        await tx.unsafe(`update public.account_deletion_requests set progress=jsonb_set(progress,'{authIntent}', 'true'::jsonb)
          where request_id=$1;`,[context.requestId]);
      })});
    }
  };
  return { async tick() {
    if (!accountDeletionEnabled(env) || running) return;
    running = true;
    try {
      const rows = await scanDeletionRequests(beginSql);
      for (const row of rows) {
        const outcome = await advanceDeletion({beginSql,requestId:row.request_id,steps});
        if (outcome.incident) klog('account_deletion_operator_incident',{
          requestId:row.request_id,code:outcome.financial ? 'financial_mismatch' : 'progress_overdue'});
      }
    } catch { klog('account_deletion_tick_failed',{code:'dependency_unavailable'}); }
    finally { running=false; }
  }, steps };
}
