import { accountDeletionEnabled, advanceDeletion, scanDeletionRequests, lockAccountLifecycle, deleteAuthUser } from '../../../shared/account-deletion.mjs';
import { retireUserForDeletion } from '../../../netlify/functions/_shared/chips-ledger.mjs';
import { blockRedisIdentity, cleanupRedisIdentity, isMemoryStore } from '../../../netlify/functions/_shared/store-upstash.mjs';
import { cleanupDeletionAvatars } from '../../../shared/account-deletion-storage.mjs';

// Existing WS tick owns scheduling. No new worker/service or browser dependency.
export function createAccountDeletionRuntime({ beginSql, leaveFromTable, disconnectUser, klog, env = process.env,
  blockIdentity = blockRedisIdentity, retireWallet = retireUserForDeletion,
  cleanupAvatars = cleanupDeletionAvatars, cleanupRedis = cleanupRedisIdentity, deleteAuth = deleteAuthUser, redisIsMemory = isMemoryStore }) {
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
      const rows = await transactionFor(context,(tx) => tx.unsafe(`select table_id from public.poker_seats where user_id=$1
        union select distinct s.table_id from public.poker_state s
        where exists(select 1 from public.poker_seats p where p.table_id=s.table_id and p.user_id=$1)
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
    auth: (context) => deleteAuth({userId:context.userId,supabaseUrl:env.SUPABASE_URL || env.SUPABASE_URL_V2,
      serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY,
      authorizeDeletion: (userId) => transactionFor(context,async (tx,request) => {
        const [guards] = await tx.unsafe('select private.account_avatar_guards_ready() as ready;');
        if (guards?.ready !== true || request.progress?.avatarPurge?.owner !== userId
          || request.progress?.avatarPurge?.requestId !== context.requestId
          || request.progress?.avatarPurge?.marker !== env.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER
          || userId !== request.old_user_id || request.phase !== 'auth' || request.progress?.cleanup?.done !== true
          || request.progress?.poker?.done !== true || !request.progress?.walletRetirement?.retiredAt) throw new Error('deletion_prerequisites_missing');
        await tx.unsafe(`update public.account_deletion_requests set progress=jsonb_set(progress,'{authIntent}', 'true'::jsonb)
          where request_id=$1;`,[context.requestId]);
      })})
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
