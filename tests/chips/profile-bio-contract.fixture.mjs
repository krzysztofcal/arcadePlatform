// Only the existing dedicated disposable PostgreSQL migration harness may invoke this.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
import {ensureUserProfile,updateUserProfile,findPublicProfile,updateUserAvatarKey} from '../../netlify/functions/_shared/user-profile.mjs';
import {createPendingUpload,cleanupExpiredUploads} from '../../netlify/functions/_shared/profile-avatar.mjs';
import {requestDeletion,assertDeletionLease} from '../../shared/account-deletion.mjs';
import {cleanupDeletionAvatars} from '../../shared/account-deletion-storage.mjs';
import {PUBLIC_AVATAR_VARIANTS} from '../../shared/profile-avatar-projection.mjs';
const read=p=>fs.readFileSync(p,'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
export async function assertProfileBioContract(sql,dbUrl){
 const target=new URL(dbUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname));assert.match(target.pathname,/_test$|chips_test_db$/);
 assert.equal(process.env.CHIPS_MIGRATIONS_DISPOSABLE_CLUSTER_CONFIRMATION,'I_CONFIRM_THIS_CLUSTER_IS_DEDICATED_AND_DISPOSABLE');
 const [{system_identifier:system}]=await sql`select system_identifier::text from pg_control_system()`;
 assert.equal(system,process.env.CHIPS_MIGRATIONS_EXPECTED_SYSTEM_IDENTIFIER);
 const original=read('specs/1114-arcade-profiles-avatars/operations/contract.sql');
 const migration=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_profile_phase_a_bio_contract.sql'));assert.ok(migration);assert.equal(original,read('supabase/migrations/'+migration),'operations and versioned Stage contract must be identical');
 const production=read('supabase/production-migrations/'+migration);const core=text=>text.split('-- BEGIN SHARED BIO CONTRACT')[1].split('-- END SHARED BIO CONTRACT')[0];assert.equal(core(production),core(original),'Production uses the exact same guarded schema/data contract');
 const contract=original.replaceAll('7656985631720456337',system);
 const rejected=async(text,pattern)=>{await assert.rejects(sql.unsafe(text),pattern);await sql.unsafe('rollback');};
 const columns=async()=> (await sql`select attname from pg_attribute where attrelid='public.user_profiles'::regclass and attnum>0 and not attisdropped order by attnum`).map(r=>r.attname);
 const tableRows=async table=>plain(await sql.unsafe(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`));
 const invariant=async()=>({auth:await tableRows('auth.users'),accounts:await tableRows('public.chips_accounts'),entries:await tableRows('public.chips_entries'),ledger:await tableRows('public.chips_transactions'),poker:await tableRows('public.poker_state'),deletion:await tableRows('public.account_deletion_requests'),uploads:await tableRows('public.profile_avatar_uploads'),objects:await tableRows('private.account_avatar_objects')});
 const env={ACCOUNT_DELETION_ENABLED:'1',ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED:'1',ACCOUNT_DELETION_AVATAR_TRACKING_MARKER:'contract-fixture',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'};
 const deps={env,executeSql:(q,p=[])=>sql.unsafe(q,p),beginSql:fn=>sql.begin(fn),syncLeaderboardVisibility:async()=>{},fetch:async()=>new Response(JSON.stringify({url:'/object/upload/sign/profile-avatar-uploads/pending/fixture?token=fixture'}),{status:200})};
 const ids=[];for(let i=0;i<16;i++){const id=randomUUID();ids.push(id);await sql`insert into auth.users(id) values(${id})`;await sql`update public.user_profiles set avatar_variant=${PUBLIC_AVATAR_VARIANTS[i]},leaderboard_visible=false where user_id=${id}`;}
 const owner=ids[0],photo=randomUUID()+'.webp';
 await sql`update public.user_profiles set handle=${'legacy-'+randomUUID().slice(0,8)},display_name='Legacy Name',bio='Synthetic BIO',handle_customized_at='2026-01-01',avatar_key=${photo} where user_id=${owner}`;
 await sql`insert into private.account_avatar_objects(user_id,output_path) values(${owner},${photo})`;
 await sql.unsafe('alter table public.profile_avatar_uploads enable trigger account_avatar_manifest_guard_v3');
 const capUser=ids[1];await createPendingUpload(capUser,{mimeType:'image/png',size:100},deps);
 await sql`insert into private.avatar_tracking_cutover(marker,cutover_at,legacy_inventory_verified,upload_bucket,public_bucket) values('contract-fixture',now()-interval '3 hours',true,'profile-avatar-uploads','profile-avatars')`;
 // Real schema/history precondition, not a production test-mode bypass.
 await sql.unsafe("insert into supabase_migrations.schema_migrations(version) values('20261026120000') on conflict do nothing");
 await sql.unsafe("set arcade.profile_bio_contract_confirmation='DROP EMPTY PROFILE BIO krydukthwdvccggbyjfw'");
 // Before normalization must fail without dropping a column.
 await rejected(contract,/Normalization|normalization/);assert.ok((await columns()).includes('bio'));
 await sql.unsafe(read('specs/1114-arcade-profiles-avatars/operations/enable-catalog.sql'));
 await sql.unsafe(read('specs/1114-arcade-profiles-avatars/operations/normalize-profiles.sql'));
 await sql`update public.user_profiles set bio='must reject' where user_id=${owner}`;await rejected(contract,/BIO is not empty/);await sql`update public.user_profiles set bio='' where user_id=${owner}`;
 const profileBefore=await tableRows('public.user_profiles'),before=await invariant(),columnBefore=await columns();
 await rejected(production,/Production BIO contract identity/);
 await sql.unsafe("set chips.production_project_ref='otbqfijerkieoxwpxjnm';set arcade.profile_bio_contract_confirmation='DROP EMPTY PROFILE BIO otbqfijerkieoxwpxjnm'");
 const localProduction=production.replaceAll('7575202818581710058',system);
 await rejected(localProduction.replace(/COMMIT;/i,'select 1/0;COMMIT;'),e=>e.code==='22012');assert.deepEqual(await columns(),columnBefore);assert.deepEqual(await invariant(),before);
 assert.equal((await sql.unsafe('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[migration.slice(0,14)]))[0].n,0,'Production-equivalent late error also rolls back its version receipt');
 await sql.unsafe("set arcade.profile_bio_contract_confirmation='DROP EMPTY PROFILE BIO krydukthwdvccggbyjfw'");
 // Deliberate late error must rollback physical DDL and all protected data.
 await rejected(contract.replace(/COMMIT;/i,'select 1/0; COMMIT;'),e=>e.code==='22012');assert.deepEqual(await columns(),columnBefore);assert.deepEqual(await invariant(),before);assert.deepEqual(await tableRows('public.user_profiles'),profileBefore);
 // Prove a real pg_depend dependency is rejected, not just text-searched.
 await sql.unsafe('create view public.bio_contract_dependency as select bio from public.user_profiles');
 await rejected(contract,/depend|Dependent|BIO dependency/);await sql.unsafe('drop view public.bio_contract_dependency');
 const cached=await sql`select user_id from public.ensure_user_profile(${owner}::uuid)`;assert.equal(cached[0].user_id,owner);
 await sql.unsafe(contract);
 assert.equal((await columns()).includes('bio'),false);assert.ok((await columns()).includes('handle_customized_at'),'historical marker must survive');
 assert.deepEqual(await tableRows('public.user_profiles'),profileBefore.map(r=>({value:Object.fromEntries(Object.entries(r.value).filter(([k])=>k!=='bio'))})));
 assert.deepEqual(await invariant(),before,'Auth, finances, poker, V2/V3 data/capabilities must not change');
 assert.equal((await sql`select user_id from public.ensure_user_profile(${owner}::uuid)`)[0].user_id,owner,'cached statement/composite survives DROP');
 const fresh=postgres(dbUrl,{max:1,prepare:false});try{
  const id=randomUUID();await fresh`insert into auth.users(id) values(${id})`;
  const [signup]=await fresh`select to_jsonb(p) row from public.user_profiles p where user_id=${id}`;assert.equal('bio' in signup.row,false);assert.ok(PUBLIC_AVATAR_VARIANTS.includes(signup.row.avatar_variant));
  assert.equal((await fresh`select (public.ensure_user_profile(${id}::uuid)).user_id id`)[0].id,id);
  const missing=randomUUID();await fresh`insert into auth.users(id) values(${missing})`;await fresh`delete from public.user_profiles where user_id=${missing}`;
  assert.equal((await fresh`select (public.ensure_user_profile(${missing}::uuid)).user_id id`)[0].id,missing,'direct provisioning without a prior profile');
 }finally{await fresh.end();}
 await updateUserAvatarKey(owner,randomUUID()+'.webp',deps);
 const current=await ensureUserProfile(owner,deps);assert.equal((await findPublicProfile(current.handle,deps.executeSql)).userId,owner);
 const selected=await updateUserProfile(owner,{avatarVariant:'zen-lime',expectedRevision:current.avatarRevision},deps);assert.equal(selected.avatarVariant,'zen-lime');assert.equal(selected.avatarRevision,current.avatarRevision+1);
 await assert.rejects(updateUserProfile(owner,{avatarVariant:'pixel-teal',expectedRevision:current.avatarRevision},deps),{code:'stale_avatar_revision'});
 assert.equal((await updateUserProfile(owner,{leaderboardVisible:true},deps)).leaderboardVisible,true);
 assert.deepEqual((await sql`select avatar_variant from public.user_profiles where user_id=any(${ids.slice(1)}::uuid[]) order by avatar_variant`).map(r=>r.avatar_variant),PUBLIC_AVATAR_VARIANTS.slice(1).sort());
 await cleanupExpiredUploads(deps);assert.deepEqual(await tableRows('public.profile_avatar_uploads'),before.uploads,'known signed capability survives expiry cleanup');
 const request=await deps.beginSql(tx=>requestDeletion(tx,capUser));
 await sql`update public.account_deletion_requests set status='PROCESSING',phase='cleanup',accepted_at=now(),lease_generation=1,lease_until=now()+interval '2 minutes' where request_id=${request.request_id}`;
 await assert.rejects(updateUserProfile(capUser,{leaderboardVisible:false},deps),{code:'account_not_active'});
 let io=0;const waiting=await cleanupDeletionAvatars({userId:capUser,requestId:request.request_id,generation:1,env,beginSql:deps.beginSql,assertLease:tx=>assertDeletionLease(tx,{requestId:request.request_id,generation:1,phase:'cleanup'}),fetch:async()=>{io++;throw Error('must wait before Storage');}});
 assert.ok(waiting.waitUntil);assert.equal(io,0);
 await rejected(`begin;delete from auth.users where id='${capUser}';commit;`,e=>e.code==='42501');
 assert.ok((await sql`select id from auth.users where id=${capUser}`).length,'Auth-last guard retains owner and capability');
 const again=await invariant();for(const k of ['accounts','entries','ledger','poker','uploads'])assert.deepEqual(again[k],before[k],k);for(const object of before.objects)assert.ok(again.objects.some(o=>JSON.stringify(o)===JSON.stringify(object)),'historical tracker retained');
 process.stdout.write('Profile BIO contract: PostgreSQL provisioning/CAS/privacy/composite/V2-V3/rollback PASS\n');
}
