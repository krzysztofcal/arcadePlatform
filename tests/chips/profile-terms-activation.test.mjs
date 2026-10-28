// PREPARED ONLY for separately authorized isolated PostgreSQL17 execution.
// Never accepts a remote URL or a nonempty test database. No Stage connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
const url=process.env.PROFILE_TERMS_ACTIVATION_TEST_DB_URL;
test('guarded Stage Terms activation: fail closed, exact history, receipts, one update and rollback',{skip:!url},async()=>{
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
  for(let i=0;i<120;i++){
   const version=String(20260000000000+i),name='fixture_'+i,file=version+'_'+name+'.sql',hash=createHash('sha256').update(file).digest('hex');
   await sql`insert into supabase_migrations.schema_migrations values(${version},${name})`;
   await sql`insert into supabase_migrations.schema_migration_files values(${version},${name},${file},${hash})`;
   lines.push(version+':'+file+':'+hash);
  }
  const original=await readFile(new URL('../../specs/1114-arcade-profiles-avatars/operations/enable-terms.sql',import.meta.url),'utf8');
  const system=(await sql`select system_identifier::text id from pg_control_system()`)[0].id;
  assert.notEqual(system,'7656985631720456337','never use Stage');
  const set=async(k,v)=>sql`select set_config(${k},${v},false)`;
  await set('arcade.terms_project','krydukthwdvccggbyjfw');
  await set('arcade.terms_confirmation','ENABLE TERMS krydukthwdvccggbyjfw');
  await set('arcade.terms_legal_version','2026-10-28-a2');
  await set('arcade.terms_readers',JSON.stringify({version:'2026-10-28-a2',apiSha:'fixture-api',wsSha:'fixture-ws',apkSha:'fixture-apk',documentsSha256:'fixture-docs'}));
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
  // Replace only the declaration; the literal sentinel guard must remain intact.
  let ready=local.replace("constant text := 'OWNER_LEGAL_VERSION_NOT_APPROVED'","constant text := '2026-10-28-a2'");
  await denied(ready,/readers preflight not approved/);
  const pins={'API_SHA_NOT_APPROVED':'fixture-api','WS_SHA_NOT_APPROVED':'fixture-ws','APK_SHA_NOT_APPROVED':'fixture-apk','DOCUMENTS_HASH_NOT_APPROVED':'fixture-docs'};
  const keys={API_SHA_NOT_APPROVED:'apiSha',WS_SHA_NOT_APPROVED:'wsSha',APK_SHA_NOT_APPROVED:'apkSha',DOCUMENTS_HASH_NOT_APPROVED:'documentsSha256'};
  const pinned=(source,missing)=>{
   for(const [sentinel,value] of Object.entries(pins))if(sentinel!==missing){
    source=source.replaceAll(sentinel,value).replace("readers->>'"+keys[sentinel]+"'='"+value+"'","readers->>'"+keys[sentinel]+"'='"+sentinel+"'");
   }
   return source;
  };
  for(const missing of Object.keys(pins)){
   const readers={version:'2026-10-28-a2',apiSha:'fixture-api',wsSha:'fixture-ws',apkSha:'fixture-apk',documentsSha256:'fixture-docs'};
   readers[keys[missing]]=missing;await set('arcade.terms_readers',JSON.stringify(readers));
   await denied(pinned(ready,missing),/readers preflight not approved/);
  }
  await set('arcade.terms_readers',JSON.stringify({version:'2026-10-28-a2',apiSha:'fixture-api',wsSha:'fixture-ws',apkSha:'fixture-apk',documentsSha256:'fixture-docs'}));
  ready=pinned(ready);
  await denied(ready,/migration\/hash history/);
  ready=ready.replace('aee0fb222b7040de6b851b258800ecee43aa060db4a6a4a281040777d1f29484',createHash('sha256').update(lines.join('\n')).digest('hex'));
  await set('arcade.terms_readers',JSON.stringify({version:'2026-10-28-a2',apiSha:'wrong-api',wsSha:'fixture-ws',apkSha:'fixture-apk',documentsSha256:'fixture-docs'}));
  await denied(ready,/readers preflight not approved/);
  await set('arcade.terms_readers',JSON.stringify({version:'2026-10-28-a2',apiSha:'fixture-api',wsSha:'fixture-ws',apkSha:'fixture-apk',documentsSha256:'fixture-docs'}));
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
 }finally{await sql.end();}
});
