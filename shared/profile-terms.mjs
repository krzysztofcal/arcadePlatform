import { assertAccountActive } from './account-deletion.mjs';
export const PROFILE_TERMS_VERSION = '2026-10-26-a1';
export const LEGACY_AVATAR_COUNT = 6;
const problem=(code,status=409)=>Object.assign(new Error(code),{code,status});
function subject(value){
 if(!value || !['account','guest'].includes(value.kind) || typeof value.id!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id))throw problem('unauthorized',401);
 if(value.kind==='account'&&!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id))throw problem('unauthorized',401);
 return value;
}
export async function readTermsStatus(tx,principal){
 const who=subject(principal);
 const [policy]=await tx.unsafe('select version, active, variants_enabled from private.profile_terms_policy where singleton=true for share;');
 if(!policy)throw problem('terms_unavailable',503);
 const [receipt]=await tx.unsafe(`select terms_version,accepted_at from private.profile_terms_receipts
 where subject_kind=$1 and subject_id=$2 and terms_version=$3 and (expires_at is null or expires_at>now());`,[who.kind,who.id,policy.version]);
 return {required:policy.active===true,version:policy.version,current:!!receipt,acceptedAt:receipt?.accepted_at||null,variantsEnabled:policy.variants_enabled===true};
}
export async function requireCurrentTerms(tx,principal){
 const status=await readTermsStatus(tx,principal);
 if(status.required&&!status.current)throw problem('terms_required');
 return status;
}
// Reuse acceptance's guest lock; no UPDATE privilege or wait on a busy guest.
export async function cleanupExpiredGuestReceipts(tx){
 const removed=await tx.unsafe(`with sweep as materialized (
  select pg_try_advisory_xact_lock(hashtextextended('profile-terms:guest-retention',0)) acquired
 ), expired as materialized (
  select subject_kind,subject_id,terms_version from private.profile_terms_receipts
  where subject_kind='guest' and expires_at<now() and (select acquired from sweep)
  order by expires_at,subject_id,terms_version limit 100
 ), available as materialized (
  select * from expired where pg_try_advisory_xact_lock(hashtextextended('profile-terms:guest:'||subject_id,0))
 ) delete from private.profile_terms_receipts r using available e
 where (r.subject_kind,r.subject_id,r.terms_version)=(e.subject_kind,e.subject_id,e.terms_version)
 and r.subject_kind='guest' and r.expires_at<now() returning 1;`);
 return removed.length;
}
export async function acceptTerms(tx,principal,payload){
 const who=subject(principal);
 if(!/^[a-zA-Z0-9_-]{8,96}$/.test(String(payload?.requestId||'')))throw problem('invalid_request_id',400);
 if(who.kind==='account')await assertAccountActive(tx,who.id);
 else await tx.unsafe('select pg_advisory_xact_lock(hashtextextended($1,0));',['profile-terms:guest:'+who.id]);
 const status=await readTermsStatus(tx,who);
 if(!status.required)throw problem('terms_not_active');
 if(payload.version!==status.version)throw problem('terms_version_changed');
 if(who.kind==='guest')await tx.unsafe("delete from private.profile_terms_receipts where subject_kind='guest' and subject_id=$1 and expires_at<now();",[who.id]);
 await cleanupExpiredGuestReceipts(tx);
 const [replay]=await tx.unsafe('select terms_version from private.profile_terms_receipts where subject_kind=$1 and subject_id=$2 and request_id=$3;',[who.kind,who.id,payload.requestId]);
 if(replay&&replay.terms_version!==payload.version)throw problem('request_conflict');
 await tx.unsafe(`insert into private.profile_terms_receipts(subject_kind,subject_id,account_user_id,terms_version,request_id,expires_at)
 values($1,$2,$3,$4,$5,case when $1='guest' then now()+interval '1 hour' else null end)
 on conflict(subject_kind,subject_id,terms_version) do nothing;`,[who.kind,who.id,who.kind==='account'?who.id:null,status.version,payload.requestId]);
 return readTermsStatus(tx,who);
}
