import { randomUUID, randomBytes, createHash } from 'node:crypto';

export function accountDeletionEnabled(env = process.env) { return env.ACCOUNT_DELETION_ENABLED === '1'; }

const PHASES = ['preparing', 'poker', 'burn', 'cleanup', 'auth', 'completed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw Object.assign(new Error('invalid_identity'), { code: 'invalid_identity' });
  return value.toLowerCase();
}

// All SQL writers must acquire this lock BEFORE their final ACTIVE check/effect.
// This helper alone does not fence Redis, WS delivery or callers not using it.
export async function lockAccountLifecycle(tx, userIds) {
  const ids = [...new Set(userIds.map(requireUuid))].sort();
  for (const id of ids) await tx.unsafe('select pg_advisory_xact_lock(hashtextextended($1, 0));', ['account-lifecycle:' + id]);
}

export async function assertAccountActive(tx, userId) {
  userId = requireUuid(userId);
  await lockAccountLifecycle(tx, [userId]);
  const [row] = await tx.unsafe(`select exists(select 1 from auth.users where id=$1) as present,
    exists(select 1 from public.account_deletion_requests where old_user_id=$1) as deleting;`, [userId]);
  if (row?.present !== true || row?.deleting !== false) {
    throw Object.assign(new Error('account_not_active'), { code: 'account_not_active' });
  }
}

export async function requestDeletion(tx, userId) {
  userId = requireUuid(userId);
  await lockAccountLifecycle(tx, [userId]);
  const [existing] = await tx.unsafe('select * from public.account_deletion_requests where old_user_id=$1;', [userId]);
  if (existing) return existing;
  await assertAccountActive(tx, userId);
  const [row] = await tx.unsafe(`insert into public.account_deletion_requests(request_id,old_user_id)
    values($1,$2) returning *;`, [randomUUID(), userId]);
  return row;
}

export function deletionStatus(row) {
  if (!row) return null;
  return { requestId: row.request_id, status: row.status, phase: row.phase,
    accepted: row.accepted_at != null, completed: row.status === 'COMPLETED', requiresIntervention: row.incident === true,
    retryable: !['ERROR', 'COMPLETED'].includes(row.status) };
}

export async function getDeletionStatus(tx, userId) {
  const [row] = await tx.unsafe('select * from public.account_deletion_requests where old_user_id=$1;', [requireUuid(userId)]);
  return deletionStatus(row);
}

// SQL phase adapters MUST call this in the same transaction as their effects.
// It serializes with takeover/error transitions, not external network effects.
export async function assertDeletionLease(tx, { requestId, generation, phase }) {
  requireUuid(requestId);
  const [row] = await tx.unsafe(`select * from public.account_deletion_requests
    where request_id=$1 and lease_generation=$2 and phase=$3
      and status='PROCESSING' and lease_until>clock_timestamp() for update;`, [requestId, generation, phase]);
  if (!row) throw Object.assign(new Error('deletion_lease_lost'), { code: 'deletion_lease_lost' });
  return row;
}

// One bounded durable phase per invocation. External adapters must be exact-owner,
// idempotent and reconcile lost responses. Lease CAS fences progress, not an
// in-flight external side effect; it is NOT a PostgreSQL+Redis transaction.
export async function advanceDeletion({ beginSql, requestId, steps }) {
  requireUuid(requestId);
  if (!PHASES.slice(0, -1).every((phase) => typeof steps?.[phase] === 'function')) {
    throw Object.assign(new Error('deletion_dependencies_incomplete'), { code: 'deletion_dependencies_incomplete' });
  }
  const row = await beginSql(async (tx) => {
    const [claimed] = await tx.unsafe(`update public.account_deletion_requests set
      status='PROCESSING', lease_generation=lease_generation+1,
      lease_until=clock_timestamp()+interval '120 seconds'
      where request_id=$1 and status in ('PENDING','PROCESSING','RETRY')
      and next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()) returning *;`, [requestId]);
    return claimed;
  });
  if (!row) return { advanced: false };
  let result;
  try {
    result = await steps[row.phase]({ userId: row.old_user_id, requestId: row.request_id,
      generation: row.lease_generation, phase: row.phase,
      beginSql, progress: row.progress || {},
      assertLease: (tx) => assertDeletionLease(tx, { requestId: row.request_id, generation: row.lease_generation, phase: row.phase }) });
    if (result?.waitUntil) {
      const until = new Date(result.waitUntil);
      if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) throw new Error('invalid_wait');
      await beginSql((tx) => tx.unsafe(`update public.account_deletion_requests set
        status='PENDING',lease_until=null,next_attempt_at=$3,actionable_since=$4
        where request_id=$1 and lease_generation=$2 and status='PROCESSING' and lease_until>clock_timestamp();`,
      [requestId,row.lease_generation,until.toISOString(),result.actionableAt || until.toISOString()]));
      return { advanced:false, waiting:true };
    }
    // Explicit success only; a missing/uncertain outcome never completes a phase.
    if (result?.done !== true) throw Object.assign(new Error('dependency_unavailable'), { code: 'dependency_unavailable' });
  } catch (error) {
    const financial = error?.code === 'financial_mismatch';
    let incident = financial;
    if (financial) {
      // A discovered financial discrepancy must not vanish when a lease expires.
      // SQL adapters serialize this condition with actual effects using assertLease.
      await beginSql((tx) => tx.unsafe(`update public.account_deletion_requests set
        status=case when status='COMPLETED' then status else 'ERROR' end,
        error_code='financial_mismatch', incident=true, lease_until=null
        where request_id=$1;`, [requestId]));
    } else {
      const [retried] = await beginSql((tx) => tx.unsafe(`update public.account_deletion_requests set
        status='RETRY', error_code='dependency_unavailable', incident=incident or actionable_since<clock_timestamp()-interval '30 minutes',
        lease_until=null, next_attempt_at=clock_timestamp()+interval '30 seconds'
        where request_id=$1 and lease_generation=$2 and status='PROCESSING' and lease_until>clock_timestamp() returning incident;`,
      [requestId, row.lease_generation]));
      incident = retried?.incident === true && row.incident !== true;
    }
    return { advanced: false, retryable: !financial, incident, financial };
  }
  return beginSql(async (tx) => {
    const next = PHASES[PHASES.indexOf(row.phase) + 1];
    const [updated] = await tx.unsafe(`update public.account_deletion_requests set phase=$3,
      status=$4, accepted_at=coalesce(accepted_at,clock_timestamp()), progress_at=clock_timestamp(),
      actionable_since=clock_timestamp(), progress=jsonb_set(progress,ARRAY[$5::text],coalesce(progress->$5::text,'{}'::jsonb) || ($6::text)::jsonb),
      completed_at=case when $3='completed' then clock_timestamp() else null end,
      lease_until=null, error_code=null, next_attempt_at=clock_timestamp()
      where request_id=$1 and lease_generation=$2 and status='PROCESSING' and lease_until>clock_timestamp() returning *;`,
    [requestId, row.lease_generation, next, next === 'completed' ? 'COMPLETED' : 'PENDING', row.phase, JSON.stringify({ done:true })]);
    return { advanced: !!updated, state: deletionStatus(updated) };
  });
}

// Official documented Supabase Auth Admin HTTP API, without adding an SDK.
// Only the final auth phase may call this, after financial/Storage dependencies.
export async function deleteAuthUser({ userId, supabaseUrl, serviceRoleKey, authorizeDeletion, fetchImpl = globalThis.fetch }) {
  userId = requireUuid(userId);
  if (typeof authorizeDeletion !== 'function') throw new Error('auth_delete_intent_required');
  // Caller must durably persist Auth intent and validate finalized prerequisites,
  // exact owner/phase/generation. Revalidate immediately before the external effect.
  await authorizeDeletion(userId);
  const base = new URL(supabaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !serviceRoleKey) {
    throw new Error('auth_delete_unconfigured');
  }
  const url = base.origin + '/auth/v1/admin/users/' + userId;
  const headers = { apikey: serviceRoleKey, authorization: 'Bearer ' + serviceRoleKey };
  const read = () => fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
  const before = await read();
  if (before.status === 404) return { done: true, reconciled: true };
  if (!before.ok) throw new Error('auth_lookup_failed');
  const existing = await before.json();
  if ((existing?.id || existing?.user?.id) !== userId) throw new Error('auth_identity_mismatch');
  await authorizeDeletion(userId);
  try {
    const removed = await fetchImpl(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
    if (removed.ok) return { done: true };
  } catch {
    // A lost response may follow a committed delete. Reconcile exact old UUID.
  }
  await authorizeDeletion(userId);
  const after = await read();
  if (after.status === 404) return { done: true, reconciled: true };
  throw new Error('auth_delete_unconfirmed');
}


export async function scanDeletionRequests(beginSql, limit = 10) {
  limit = Math.max(1, Math.min(10, Number(limit) || 10));
  return beginSql((tx) => tx.unsafe(`select request_id from public.account_deletion_requests
    where status in ('PENDING','PROCESSING','RETRY') and next_attempt_at<=clock_timestamp()
      and (lease_until is null or lease_until<clock_timestamp()) order by next_attempt_at limit $1;`, [limit]));
}

export async function issueDeletionStatusAccess(tx, userId) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const [row] = await tx.unsafe(`update public.account_deletion_requests set status_token_hash=$2,
    status_token_expires_at=clock_timestamp()+interval '24 hours' where old_user_id=$1 returning *;`, [requireUuid(userId),hash]);
  if (!row) throw new Error('deletion_request_missing');
  return { ...deletionStatus(row), statusToken:token };
}

export async function readDeletionStatusAccess(tx, requestId, token) {
  requireUuid(requestId);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await tx.unsafe(`select * from public.account_deletion_requests where request_id=$1
    and status_token_hash=$2 and status_token_expires_at>clock_timestamp();`,
  [requestId,createHash('sha256').update(token).digest('hex')]);
  return deletionStatus(row);
}


// Authorization and synchronous transport enqueue share the acceptance lock.
// A frame already enqueued before acceptance cannot be recalled from the network.
export function queueAccountPrivateFrame({ws,connection,ownerId,frame,beginSql,close}) {
  ws.__deletionSendCount=(ws.__deletionSendCount || 0)+1;
  if (ws.__deletionSendCount>100) { ws.__deletionSendCount--; close('send_queue_full'); return Promise.resolve(); }
  ws.__deletionSendTail=(ws.__deletionSendTail || Promise.resolve()).then(() => beginSql(async(tx)=>{
    await assertAccountActive(tx,ownerId);
    if (ws.readyState===1 && connection.session?.userId===ownerId && !connection.sessionInvalidated) ws.send(JSON.stringify(frame));
  })).catch(()=>close('account_not_active')).finally(()=>{ws.__deletionSendCount--;});
  return ws.__deletionSendTail;
}
