// PREPARED ONLY for separately authorized isolated PostgreSQL17 execution.
// Never accepts a remote URL or a nonempty test database. No Stage connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
const url=process.env.PROFILE_TERMS_ACTIVATION_TEST_DB_URL;
test('guarded Stage Terms activation and deactivation: fail closed, exact history, pins, receipts, one update and rollback',{skip:!url},async()=>{
 const target=new URL(url);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname));
 assert.match(target.pathname,/\/[^/]+_test$/);
 const sql=postgres(url,{max:1,prepare:false});
 try{
  assert.match((await sql`show server_version`)[0].server_version,/^17\./);
  assert.equal((await sql`select count(*)::int n from pg_tables where schemaname in ('public','private','auth','supabase_migrations')`)[0].n,0,'fresh synthetic database required');
  await sql.unsafe(`create schema private;create schema auth;create schema supabase_migrations;
   create table supabase_migrations.schema_migrations(version text primary key,name text);
   create table supabase_migrations.schema_migration_files(version text primary key,name text,file text,sha256 text);
   create table private.profile_terms_policy(singleton boolean primary key,version text,active boolean,variants_enabled boolean,identity_normalized_at timestamptz);
   create table private.profile_terms_receipts(subject_kind text,subject_id text,terms_version text,accepted_at timestamptz,request_id text);
   create table public.user_profiles(user_id uuid primary key,handle_customized_at timestamptz,avatar_variant text,avatar_revision bigint,leaderboard_visible boolean);
   create table public.protected_fixture(kind text primary key,value text);
   insert into public.protected_fixture values('Auth','unchanged'),('CH','unchanged'),('XP','unchanged'),('Poker','unchanged'),('Storage','unchanged');
   insert into private.profile_terms_policy values(true,'2026-10-26-a1',false,true,now());
   insert into public.user_profiles values('00000000-0000-4000-8000-000000000001',now(),'comet-blue',7,false);
   insert into private.profile_terms_receipts values('account','synthetic','old-version',now(),'old-receipt');`);
  const lines=[];
  for(let i=0;i<125;i++){
   const version=String(20260000000000+i),name='fixture_'+i,file=version+'_'+name+'.sql',hash=createHash('sha256').update(file).digest('hex');
   await sql`insert into supabase_migrations.schema_migrations values(${version},${name})`;
   await sql`insert into supabase_migrations.schema_migration_files values(${version},${name},${file},${hash})`;
   lines.push(version+':'+file+':'+hash);
  }
  const original=await readFile(new URL('../../specs/1114-arcade-profiles-avatars/operations/enable-terms.sql',import.meta.url),'utf8');
  const disable=await readFile(new URL('../../specs/1114-arcade-profiles-avatars/operations/disable-terms.sql',import.meta.url),'utf8');
  // Approved pins live in the operation itself; the literal sentinel guards must stay for every pin.
  const pinOf=key=>original.match(new RegExp("readers->>'"+key+"' IS DISTINCT FROM '([^']+)'"))[1];
  const real={apiSha:pinOf('apiSha'),wsSha:pinOf('wsSha'),apkSha:pinOf('apkSha'),documentsSha256:pinOf('documentsSha256')};
  for(const value of Object.values(real))assert.match(value,/^[0-9a-f]{40,64}$/,'approved API/WS/APK/documents pins');
  // OWNER-approved Stage-only debug APK from #1244 (workflow 43525617080); not a Google Play AAB.
  assert.equal(real.apkSha,'a9eb1151c11813fb245866b1cc331636c275a3cf8a3ac3f87ae2d731cc1d1982','approved Stage APK pin');
  // The API reader is the Stage API serving the trial (Deploy Preview #1244), not a WWW Production SHA.
  assert.equal(real.apiSha,'736eb01dc860b895b63167f63b1b809f2d5c266f','Stage API reader pin');
  for(const sentinel of ['API_SHA_NOT_APPROVED','WS_SHA_NOT_APPROVED','APK_SHA_NOT_APPROVED','DOCUMENTS_HASH_NOT_APPROVED'])assert.ok(original.includes("='"+sentinel+"'"),'sentinel guard kept: '+sentinel);
  assert.ok(original.includes("approved_version='OWNER_LEGAL_VERSION_NOT_APPROVED'"),'version sentinel guard kept');
  const readersWith=over=>JSON.stringify({version:'2026-10-28-a2',...real,...over});
  const system=(await sql`select system_identifier::text id from pg_control_system()`)[0].id;
  assert.notEqual(system,'7656985631720456337','never use Stage');
  const set=async(k,v)=>sql`select set_config(${k},${v},false)`;
  await set('arcade.terms_project','krydukthwdvccggbyjfw');
  await set('arcade.terms_confirmation','ENABLE TERMS krydukthwdvccggbyjfw');
  await set('arcade.terms_legal_version','2026-10-26-a1');
  await set('arcade.terms_readers',readersWith({}));
  const fingerprints=await sql.unsafe(`select
   (select md5(jsonb_agg(to_jsonb(r) order by subject_kind,subject_id,terms_version)::text) from private.profile_terms_receipts r) receipts,
   (select md5(jsonb_agg(to_jsonb(p) order by user_id)::text) from public.user_profiles p) profiles`);
  await set('arcade.terms_receipts_fingerprint',fingerprints[0].receipts);
  await set('arcade.terms_receipts_count','1');
  await set('arcade.terms_profiles_fingerprint',fingerprints[0].profiles);
  const state=()=>sql.unsafe(`select jsonb_build_object('policy',(select to_jsonb(p) from private.profile_terms_policy p),
   'receipts',(select jsonb_agg(to_jsonb(r)) from private.profile_terms_receipts r),'profiles',(select jsonb_agg(to_jsonb(p)) from public.user_profiles p),
   'protected',(select jsonb_agg(to_jsonb(p) order by kind) from public.protected_fixture p)) state`);
  const before=await state();
  const denied=async(source,pattern,expected=before)=>{await assert.rejects(sql.unsafe(source),pattern);await sql.unsafe('rollback');assert.deepEqual(await state(),expected);};
  await denied(original,/identity\/operator/);
  const local=original.replaceAll('7656985631720456337',system);
  await denied(local,/version not approved/);
  await set('arcade.terms_legal_version','2026-10-28-a2');
  // Every pin must match exactly; a sentinel value is refused even if supplied by the operator.
  for(const [key,wrong] of [['version','2026-10-26-a1'],['apiSha','0'.repeat(40)],['wsSha','0'.repeat(40)],['apkSha','0'.repeat(64)],['apkSha','APK_SHA_NOT_APPROVED'],['documentsSha256','0'.repeat(64)]]){
   await set('arcade.terms_readers',readersWith({[key]:wrong}));
   await denied(local,/readers preflight not approved/);
  }
  // A committed sentinel comparison keeps the operation refused even when the operator supplies the sentinel.
  const sentinelApk=local.replace("readers->>'apkSha' IS DISTINCT FROM '"+real.apkSha+"'","readers->>'apkSha' IS DISTINCT FROM 'APK_SHA_NOT_APPROVED'");
  assert.notEqual(sentinelApk,local);
  await set('arcade.terms_readers',readersWith({apkSha:'APK_SHA_NOT_APPROVED'}));
  await denied(sentinelApk,/readers preflight not approved/);
  await set('arcade.terms_readers',readersWith({}));
  await denied(local,/migration\/hash history/);
  const ready=local.replace(/manifest_hash constant text := '[0-9a-f]{64}'/,"manifest_hash constant text := '"+createHash('sha256').update(lines.join('\n')).digest('hex')+"'");
  assert.notEqual(ready,local);
  await sql.unsafe("update private.profile_terms_receipts set request_id='changed-receipt'");
  await denied(ready,/inventory drift/,await state());
  await sql.unsafe("update private.profile_terms_receipts set request_id='old-receipt'");
  await set('arcade.terms_receipts_count','0');await denied(ready,/inventory drift/);await set('arcade.terms_receipts_count','1');
  await sql.unsafe('update private.profile_terms_policy set variants_enabled=false');
  await denied(ready,/Terms OFF policy/,await state());await sql.unsafe('update private.profile_terms_policy set variants_enabled=true');
  await sql.unsafe('update private.profile_terms_policy set identity_normalized_at=null');
  await denied(ready,/Terms OFF policy/,await state());await sql`update private.profile_terms_policy set identity_normalized_at=${before[0].state.policy.identity_normalized_at}::text::timestamptz`;
  const blocker=postgres(url,{max:1,prepare:false});
  try{
   await blocker.unsafe('begin');
   await blocker.unsafe("select pg_advisory_xact_lock(hashtextextended('profile-terms-stage-activation',0))");
   await denied(ready,/Concurrent Terms activation/);await blocker.unsafe('rollback');
   await blocker.unsafe('begin');await blocker.unsafe('select 1 from private.profile_terms_policy for update');
   const started=Date.now();
   await denied(ready,error=>error.code==='55P03');
   assert.ok(Date.now()-started<6000,'bounded lock wait');
  }finally{await blocker.unsafe('rollback');await blocker.end();}
  await denied(ready.replace('COMMIT;','SELECT 1/0; COMMIT;'),/division by zero/);
  // An accidental trigger write to a protected table must abort everything.
  await sql.unsafe(`create function private.unexpected_write() returns trigger language plpgsql as $$begin update public.protected_fixture set value='bad' where kind='CH';return new;end$$;
   create trigger unexpected_write after update on private.profile_terms_policy for each row execute function private.unexpected_write();`);
  await denied(ready,/Unexpected transaction data write/);
  await sql.unsafe('drop trigger unexpected_write on private.profile_terms_policy');
  await sql.unsafe(ready);
  const after=(await state())[0].state,expected=before[0].state;assert.equal(after.policy.active,true);
  assert.equal(after.policy.version,'2026-10-28-a2');
  after.policy.active=false;after.policy.version=expected.policy.version;assert.deepEqual(after,expected);
  await assert.rejects(sql.unsafe(ready),/Terms OFF policy/);await sql.unsafe('rollback');
  // Deactivation: identity and phrase, only active=false, version a2 and receipts kept, side writes abort.
  const activeState=await state();
  const off=disable.replaceAll('7656985631720456337',system);
  await denied(disable,/identity\/operator/,activeState);
  await denied(off,/identity\/operator/,activeState);
  await set('arcade.terms_confirmation','DISABLE TERMS krydukthwdvccggbyjfw');
  await sql.unsafe(`create function private.unexpected_off() returns trigger language plpgsql as $$begin update public.protected_fixture set value='bad' where kind='XP';return new;end$$;
   create trigger unexpected_off after update on private.profile_terms_policy for each row execute function private.unexpected_off();`);
  await denied(off,/Unexpected transaction data write/,activeState);
  await sql.unsafe('drop trigger unexpected_off on private.profile_terms_policy');
  await sql.unsafe(off);
  const disabled=(await state())[0].state,activeBefore=activeState[0].state;
  assert.equal(disabled.policy.active,false);assert.equal(disabled.policy.version,'2026-10-28-a2');
  disabled.policy.active=true;assert.deepEqual(disabled,activeBefore);
  await assert.rejects(sql.unsafe(off),/Expected active Terms a2 policy/);await sql.unsafe('rollback');
 }finally{await sql.end();}
});
