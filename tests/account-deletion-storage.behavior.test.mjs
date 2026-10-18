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
const env = { ACCOUNT_DELETION_ENABLED:'1', ACCOUNT_DELETION_AVATAR_GRACE_SECONDS:'300', ACCOUNT_DELETION_AVATAR_TRACKING_MARKER:'local-verified-v2', SUPABASE_URL:'https://local-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'test-only-not-real' };
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
  }
  await db.exec('truncate public.account_deletion_requests,public.profile_avatar_uploads,public.user_profiles,auth.users,private.account_avatar_objects,private.avatar_tracking_cutover cascade');
  const userId = randomUUID();
  await db.query('insert into auth.users values($1)',[userId]);
  await db.query(`insert into private.avatar_tracking_cutover values($1,clock_timestamp()-interval '3 hours',true,'profile-avatar-uploads','profile-avatars')`,[env.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER]);
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
  assert.ok(row.signing_finished_at); assert.ok(new Date(row.capability_until)-new Date(row.signing_finished_at)>=7500000);
  await executeSql("update public.profile_avatar_uploads set expires_at=clock_timestamp()-interval '10 minutes'");
  await cleanupExpiredUploads(deps);
  assert.equal(removed.length,0);
  assert.ok((await cleanup()).waitUntil);
  await executeSql("update public.profile_avatar_uploads set capability_until=clock_timestamp()-interval '1 minute'");
  assert.deepEqual(await cleanup(),{done:true});
  assert.ok(removed.includes(row.source_path));
});

test('uncertain signing retains path and blocks completion; legacy or mixed buckets never trigger broad cleanup',async()=>{
  const {userId,deps,cleanup,executeSql,removed}=await fixture();
  await assert.rejects(createPendingUpload(userId,{mimeType:'image/png',size:100},{...deps,fetch:async()=>{throw new Error('lost response');}}),/lost response/);
  assert.equal((await executeSql('select count(*)::int n from public.profile_avatar_uploads'))[0].n,1);
  await assert.rejects(cleanup(),/dependency_unavailable/);
  await executeSql('delete from public.profile_avatar_uploads');
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
  await executeSql("update public.profile_avatar_uploads set capability_until=clock_timestamp()-interval '1 second'");
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
  await executeSql("update public.profile_avatar_uploads set capability_until=clock_timestamp()-interval '1 second',output_path=$2,output_write_started_at=clock_timestamp() where id=$1",[pending.uploadId,randomUUID()+'.webp']);
  await assert.rejects(cleanup(),/dependency_unavailable/);
});
