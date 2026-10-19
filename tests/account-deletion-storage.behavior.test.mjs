import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { requestDeletion } from '../shared/account-deletion.mjs';
import { cleanupDeletionAvatars } from '../shared/account-deletion-storage.mjs';
import { ensureUserProfile, updateUserProfile, updateUserAvatarKey } from '../netlify/functions/_shared/user-profile.mjs';
import { createPendingUpload, finalizeAvatar, cleanupExpiredUploads } from '../netlify/functions/_shared/profile-avatar.mjs';
const env = { ACCOUNT_DELETION_ENABLED:'1', ACCOUNT_DELETION_AVATAR_TRACKING_MARKER:'local-verified-v2', SUPABASE_URL:'https://local-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'test-only-not-real' };
let db;
after(async()=>{ if(db) await db.close(); });
async function fixture() {
  if(!db) {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create table public.bonus_campaigns(created_by uuid);
create table public.bonus_campaign_eligible_users(created_by uuid);
create table public.user_profiles(user_id uuid primary key references auth.users on delete cascade,handle text,display_name text,bio text default '',avatar_key text,avatar_variant text default 'fox-blue',handle_customized_at timestamptz,leaderboard_visible boolean default true);
create function public.ensure_user_profile(uid uuid) returns setof public.user_profiles language plpgsql as $$ begin insert into public.user_profiles(user_id,handle,display_name) values(uid,uid::text,'Test') on conflict do nothing; return query select * from public.user_profiles where user_id=uid; end $$;
create table public.profile_avatar_uploads(id uuid primary key,user_id uuid references auth.users on delete cascade,source_path text,declared_mime_type text,declared_size integer,expires_at timestamptz,consumed_at timestamptz,created_at timestamptz default now());`);
    for(const file of ['1117-account-deletion-requests-v2.sql','1117-account-deletion-avatar-tracking-v2.sql']) await db.exec(await readFile(new URL('../supabase/manual/'+file, import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261019170000_account_avatar_manifest_guards.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select private.account_avatar_guards_ready() as ready')).rows[0].ready,false,'installation must not activate restrictive guards');
    await db.exec('alter table public.profile_avatar_uploads enable trigger account_avatar_manifest_guard_v3');
  }
  await db.exec('truncate public.account_deletion_requests,public.profile_avatar_uploads,public.user_profiles,auth.users,private.account_avatar_objects,private.avatar_tracking_cutover cascade');
  const userId = randomUUID();
  await db.query('insert into auth.users values($1)',[userId]);
  await db.query(`insert into private.avatar_tracking_cutover(marker,cutover_at,legacy_inventory_verified,upload_bucket,public_bucket) values($1,clock_timestamp()-interval '3 hours',true,'profile-avatar-uploads','profile-avatars')`,[env.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER]);
  await db.exec("update private.avatar_tracking_cutover set provider_max_token_seconds=7200,provider_max_completion_seconds=0,provider_evidence='LOCAL MODEL ONLY; not provider proof'");
  const executeSql = async(q,p=[]) => (await db.query(q,p)).rows;
  const beginSql = (fn) => db.transaction(tx=>fn({unsafe:async(q,p=[]) => (await tx.query(q,p)).rows}));
  const removed=[];
  const fetch = async(url,opts)=> {
    if(opts.method==='DELETE') { removed.push(JSON.parse(opts.body).prefixes[0]); return new Response('[]'); }
    if(url.includes('/upload/sign/')) return new Response(JSON.stringify({url:'/object/upload/sign/profile-avatar-uploads/pending/test?token=redacted'}));
    throw new Error('unexpected local Storage call');
  };
  const deps={env,executeSql,beginSql,fetch};
  const deletion = () => beginSql(tx=>requestDeletion(tx,userId));
  const cleanup = (overrides={})=>cleanupDeletionAvatars({userId,requestId:randomUUID(),assertLease:async()=>{},...deps,...overrides});
  return {userId,deps,deletion,cleanup,executeSql,removed};
}

// Local fixture clock only; production proof fields are immutable.
async function seedClock(set, params=[]) {
  await db.exec('alter table public.profile_avatar_uploads disable trigger account_avatar_manifest_guard_v3');
  try { await db.query('update public.profile_avatar_uploads set '+set,params); }
  finally { await db.exec('alter table public.profile_avatar_uploads enable trigger account_avatar_manifest_guard_v3'); }
}

test('enabled ensure/profile/avatar mutations check lifecycle in the SQL transaction and cannot resurrect owner',async()=>{
  const {userId,deps,deletion,executeSql}=await fixture();
  await ensureUserProfile(userId,deps);
  await updateUserAvatarKey(userId,randomUUID()+'.webp',deps);
  assert.equal((await executeSql('select count(*)::int n from private.account_avatar_objects'))[0].n,1);
  await deletion();
  for(const action of [()=>ensureUserProfile(userId,deps),()=>updateUserProfile(userId,{displayName:'After'},deps),()=>updateUserAvatarKey(userId,null,deps),()=>createPendingUpload(userId,{mimeType:'image/png',size:100},deps)]) await assert.rejects(action(),/account_not_active/);
});

test('signed upload capability is retained after five minutes and acceptance during signing prevents response without losing manifest',async()=>{
  const {userId,deps,deletion,cleanup,executeSql,removed}=await fixture();
  await assert.rejects(createPendingUpload(userId,{mimeType:'image/png',size:100},{...deps,fetch:async()=>{
    await deletion();
    return new Response(JSON.stringify({url:'/object/upload/sign/profile-avatar-uploads/pending/test?token=redacted'}));
  }}),/account_not_active/);
  const [row]=await executeSql('select * from public.profile_avatar_uploads');
  assert.ok(row.signing_finished_at); assert.ok(new Date(row.capability_until)-new Date(row.signing_finished_at)>=7200000);
  await seedClock("expires_at=clock_timestamp()-interval '10 minutes'");
  await cleanupExpiredUploads(deps);
  assert.equal(removed.length,0);
  assert.ok((await cleanup()).waitUntil);
  await seedClock("signing_finished_at=clock_timestamp()-interval '3 hours',capability_until=clock_timestamp()-interval '1 minute'");
  assert.deepEqual(await cleanup(),{done:true});
  assert.ok(removed.includes(row.source_path));
});

test('uncertain signing retains path and blocks completion; legacy or mixed buckets never trigger broad cleanup',async()=>{
  const {userId,deps,cleanup,executeSql,removed}=await fixture();
  await assert.rejects(createPendingUpload(userId,{mimeType:'image/png',size:100},{...deps,fetch:async()=>{throw new Error('lost response');}}),/lost response/);
  assert.equal((await executeSql('select count(*)::int n from public.profile_avatar_uploads'))[0].n,1);
  await assert.rejects(cleanup(),/dependency_unavailable/);
  await assert.rejects(executeSql('delete from public.profile_avatar_uploads'),/purge not authorized/);
  await executeSql('update private.avatar_tracking_cutover set legacy_inventory_verified=false');
  await assert.rejects(cleanup(),/dependency_unavailable/);
  assert.equal(removed.length,0);
});

test('output path is durable before upload, acceptance blocks profile finalize, final rescan removes all exact paths only after horizon',async()=>{
  const {userId,deps,deletion,cleanup,executeSql,removed}=await fixture();
  const image=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();
  const pending=await createPendingUpload(userId,{mimeType:'image/png',size:image.length},deps);
  let output;
  await assert.rejects(finalizeAvatar(userId,pending.uploadId,{...deps,fetch:async(url,opts)=>{
    if(opts.method==='GET') return new Response(image);
    if(opts.method==='POST') {
      const [row]=await executeSql('select output_path,output_write_started_at from public.profile_avatar_uploads where id=$1',[pending.uploadId]);
      output=row.output_path; assert.ok(row.output_write_started_at); assert.ok(url.endsWith(output));
      await deletion();
      return new Response('{}');
    }
    return deps.fetch(url,opts);
  }}),/account_not_active/);
  const [row]=await executeSql('select * from public.profile_avatar_uploads where id=$1',[pending.uploadId]);
  assert.equal(row.output_path,output); assert.ok(row.output_write_finished_at);
  assert.equal((await executeSql('select avatar_key from public.user_profiles where user_id=$1',[userId]))[0].avatar_key,null);
  assert.ok((await cleanup()).waitUntil);
  await seedClock("signing_finished_at=clock_timestamp()-interval '3 hours',capability_until=clock_timestamp()-interval '1 second'");
  assert.deepEqual(await cleanup(),{done:true});
  assert.ok(removed.includes(output));
  assert.equal((await executeSql('select count(*)::int n from public.profile_avatar_uploads'))[0].n,1,'manifest retained until durable owner cleanup');
});

test('uncertain output write blocks completion and failed delete remains retryable; selected avatar survives profile replacement in manifest',async()=>{
  const {userId,deps,cleanup,executeSql}=await fixture();
  const first=randomUUID()+'.webp'; const second=randomUUID()+'.webp';
  await updateUserAvatarKey(userId,first,deps);
  await updateUserAvatarKey(userId,second,deps);
  assert.equal((await executeSql('select count(*)::int n from private.account_avatar_objects'))[0].n,2);
  await assert.rejects(cleanup({fetch:async()=>new Response('fail',{status:503})}),/dependency_unavailable/);
  assert.equal((await executeSql('select count(*)::int n from private.account_avatar_objects where deleted_at is null'))[0].n,2);
  assert.deepEqual(await cleanup(),{done:true});
  const pending=await createPendingUpload(userId,{mimeType:'image/png',size:100},deps);
  await seedClock("signing_finished_at=clock_timestamp()-interval '3 hours',capability_until=clock_timestamp()-interval '1 second',output_path=$2,output_write_started_at=clock_timestamp() where id=$1",[pending.uploadId,randomUUID()+'.webp']);
  await assert.rejects(cleanup(),/dependency_unavailable/);
});


test('capability tracking can precede deletion activation and retains expired finalize manifests',async()=>{
  const {userId,deps,executeSql,removed}=await fixture();
  const tracking={...deps,env:{...env,ACCOUNT_DELETION_ENABLED:'0',ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED:'1'}};
  await updateUserAvatarKey(userId,randomUUID()+'.webp',tracking);
  assert.equal((await executeSql('select count(*)::int n from private.account_avatar_objects'))[0].n,1);
  await createPendingUpload(userId,{mimeType:'image/png',size:100},tracking);
  const [row]=await executeSql('select * from public.profile_avatar_uploads');
  assert.equal(row.tracking_version,3);assert.ok(row.signing_finished_at);
  const horizon=Date.parse(row.capability_until)-Date.parse(row.signing_finished_at);
  assert.ok(horizon>=7200000 && horizon<7201000,'documented 2h tracking horizon, no added margin');
  await seedClock("expires_at=clock_timestamp()-interval '10 minutes'");
  await cleanupExpiredUploads(tracking);
  assert.equal((await executeSql('select count(*)::int n from public.profile_avatar_uploads'))[0].n,1);
  assert.equal(removed.length,0);
});

test('older longer capability horizon and provider completion bound remain blocking without grace',async()=>{
  const {userId,deps,cleanup,executeSql,removed}=await fixture();
  await createPendingUpload(userId,{mimeType:'image/png',size:100},deps);
  await seedClock("signing_finished_at=clock_timestamp()-interval '3 hours',capability_until=clock_timestamp()+interval '1 hour',expires_at=clock_timestamp()-interval '1 hour'");
  await executeSql('update private.avatar_tracking_cutover set provider_max_completion_seconds=120');
  const [manifest]=await executeSql('select capability_until from public.profile_avatar_uploads');
  await cleanupExpiredUploads(deps);
  const result=await cleanup();
  assert.equal(Date.parse(result.waitUntil),Date.parse(manifest.capability_until)+120000);
  assert.equal(result.done,undefined);assert.equal(removed.length,0);
  assert.equal(Date.parse((await executeSql('select capability_until from public.profile_avatar_uploads'))[0].capability_until),Date.parse(manifest.capability_until));
});

test('v3 rejects legacy admission; already admitted legacy signing remains tracked and blocks completion',async()=>{
  const {userId,deps,deletion,cleanup,executeSql}=await fixture();
  const legacy={...deps,env:{...env,ACCOUNT_DELETION_ENABLED:'0',ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED:'0'}};
  await assert.rejects(createPendingUpload(userId,{mimeType:'image/png',size:100},legacy),/tracking protocol required/);
  // Model a request admitted BEFORE guard activation: the external legacy call
  // cannot be cancelled by SQL, but neither its evidence nor NO-GO may disappear.
  await db.exec('alter table public.profile_avatar_uploads disable trigger account_avatar_manifest_guard_v3');
  const signed=await createPendingUpload(userId,{mimeType:'image/png',size:100},{...legacy,fetch:async()=>{
    await db.exec('alter table public.profile_avatar_uploads enable trigger account_avatar_manifest_guard_v3');
    await deletion();
    return new Response(JSON.stringify({url:'/object/upload/sign/profile-avatar-uploads/pending/local?token=fake'}));
  }});
  assert.ok(signed.uploadUrl);
  await assert.rejects(executeSql('delete from public.profile_avatar_uploads'),/purge not authorized/);
  assert.equal((await executeSql('select count(*)::int n from public.profile_avatar_uploads'))[0].n,1);
  await assert.rejects(cleanup(),/dependency_unavailable/);
});

test('legacy expiry cleanup cannot erase a live capability or change manifest ownership',async()=>{
  const {userId,deps,executeSql,cleanup}=await fixture();
  await createPendingUpload(userId,{mimeType:'image/png',size:100},deps);
  await seedClock("expires_at=clock_timestamp()-interval '1 minute'");
  await cleanupExpiredUploads({...deps,env:{...env,ACCOUNT_DELETION_ENABLED:'0',ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED:'0'}});
  const [row]=await executeSql('select * from public.profile_avatar_uploads');
  assert.ok(Date.parse(row.capability_until)>Date.now());
  await assert.rejects(executeSql('update public.profile_avatar_uploads set source_path=$1 where id=$2',['pending/'+randomUUID(),row.id]),/immutable/);
  await assert.rejects(executeSql('update public.profile_avatar_uploads set capability_until=clock_timestamp() where id=$1',[row.id]),/immutable/);
  assert.ok((await cleanup()).waitUntil);
});

test('legacy finalize is rejected before I/O; uncertain supported output retains exact path and retries cleanup safely',async()=>{
  const {userId,deps,deletion,executeSql,cleanup,removed}=await fixture();
  const image=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();
  const signed=await createPendingUpload(userId,{mimeType:'image/png',size:image.length},deps);
  let calls=0;
  await assert.rejects(finalizeAvatar(userId,signed.uploadId,{...deps,env:{...env,ACCOUNT_DELETION_ENABLED:'0'},fetch:async()=>{calls++;throw new Error('must not reach I/O');}}),/finalize intent required/);
  assert.equal(calls,0);
  let output;
  await assert.rejects(finalizeAvatar(userId,signed.uploadId,{...deps,fetch:async(url,opts)=>{
    if(opts.method==='GET') return new Response(image);
    if(opts.method==='POST') {
      const [row]=await executeSql('select output_path,output_write_started_at from public.profile_avatar_uploads');
      output=row.output_path;assert.ok(row.output_write_started_at);assert.ok(url.endsWith(output));
      await deletion();
      throw new Error('modelled committed output with lost response');
    }
    if(url.endsWith('/profile-avatars')) return new Response('unavailable',{status:503});
    return deps.fetch(url,opts);
  }}),/modelled committed output/);
  const [row]=await executeSql('select * from public.profile_avatar_uploads');
  assert.equal(row.output_path,output);assert.equal(row.output_write_finished_at,null);
  await assert.rejects(cleanup(),/dependency_unavailable/);
  // Fixture-only provider reconciliation; no real provider proof is asserted.
  await seedClock("signing_finished_at=clock_timestamp()-interval '3 hours',capability_until=clock_timestamp()-interval '1 minute',output_write_finished_at=clock_timestamp()");
  assert.deepEqual(await cleanup(),{done:true});
  const n=removed.length;
  assert.deepEqual(await cleanup(),{done:true});assert.equal(removed.length,n);
  assert.ok(removed.includes(output));
});

test('missing receipts/guard/provider evidence fail closed; canonical purge needs exact lease and authorized Auth cascade',async()=>{
  const {userId,deps,deletion,executeSql,cleanup}=await fixture();
  await assert.rejects(createPendingUpload(userId,{mimeType:'image/png',size:100},{...deps,executeSql:(q,p)=>q.includes('set signing_finished_at')?Promise.resolve([]):deps.executeSql(q,p)}),/avatar_tracking_unavailable/);
  await assert.rejects(cleanup(),/dependency_unavailable/);
  await seedClock("signing_finished_at=clock_timestamp()-interval '3 hours',capability_until=clock_timestamp()-interval '1 minute'");
  await db.exec('alter table public.profile_avatar_uploads disable trigger account_avatar_manifest_guard_v3');
  await assert.rejects(cleanup(),/dependency_unavailable/);
  await db.exec('alter table public.profile_avatar_uploads enable trigger account_avatar_manifest_guard_v3');
  for(const field of ['provider_max_token_seconds','provider_max_completion_seconds','provider_evidence']) {
    await executeSql('update private.avatar_tracking_cutover set '+field+'=null');
    await assert.rejects(cleanup(),/dependency_unavailable/);
    await executeSql("update private.avatar_tracking_cutover set provider_max_token_seconds=7200,provider_max_completion_seconds=0,provider_evidence='LOCAL MODEL ONLY; not provider proof'");
  }
  const req=await deletion();
  assert.deepEqual(await cleanup(),{done:true});
  await executeSql("update public.account_deletion_requests set status='PROCESSING',phase='cleanup',accepted_at=clock_timestamp(),lease_generation=4,lease_until=clock_timestamp()+interval '120 seconds' where request_id=$1",[req.request_id]);
  const purge=(owner,generation)=>executeSql('select private.account_avatar_prepare_purge($1,$2,$3,$4)',[owner,req.request_id,generation,env.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER]);
  await assert.rejects(purge(randomUUID(),4),/lease invalid/);
  await assert.rejects(purge(userId,3),/lease invalid/);
  await purge(userId,4);await purge(userId,4);
  await executeSql("update public.account_deletion_requests set lease_until=clock_timestamp()-interval '1 second' where request_id=$1",[req.request_id]);
  await assert.rejects(purge(userId,4),/lease invalid/);
  await executeSql("update public.account_deletion_requests set lease_until=clock_timestamp()+interval '120 seconds' where request_id=$1",[req.request_id]);
  await assert.rejects(executeSql('delete from public.profile_avatar_uploads'),/purge not authorized/);
  await assert.rejects(executeSql('delete from auth.users where id=$1',[userId]),/purge not authorized/);
  await executeSql(`update public.account_deletion_requests set phase='auth',progress=progress||'{"cleanup":{"done":true},"authIntent":true}'::jsonb where request_id=$1`,[req.request_id]);
  await executeSql('delete from auth.users where id=$1',[userId]);
  assert.equal((await executeSql('select count(*)::int n from public.profile_avatar_uploads'))[0].n,0);
  assert.deepEqual(await cleanup(),{done:true});
});


test('tracked upload/finalize publishes known output and exact cleanup is repeatable',async()=>{
  const {userId,deps,deletion,executeSql,cleanup,removed}=await fixture();
  const image=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();
  const pending=await createPendingUpload(userId,{mimeType:'image/png',size:image.length},deps);
  const profile=await finalizeAvatar(userId,pending.uploadId,{...deps,fetch:async(url,opts)=>{
    if(opts.method==='GET') return new Response(image);
    if(opts.method==='POST') return new Response('{}');
    return deps.fetch(url,opts);
  }});
  const [row]=await executeSql('select * from public.profile_avatar_uploads');
  assert.equal(profile.avatarKey,row.output_path);assert.ok(row.output_write_finished_at);
  await seedClock("signing_finished_at=clock_timestamp()-interval '3 hours',capability_until=clock_timestamp()-interval '1 minute'");
  await deletion();assert.deepEqual(await cleanup(),{done:true});
  assert.ok(removed.includes(row.source_path));assert.ok(removed.includes(row.output_path));
  assert.deepEqual(await cleanup(),{done:true});
});
