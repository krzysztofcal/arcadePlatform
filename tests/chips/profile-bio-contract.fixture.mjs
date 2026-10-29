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
 // Public block on the complete post-contract schema: owner/provisioning/CAS remain valid.
 const blockBefore=(await sql`select to_jsonb(p) value from public.user_profiles p where user_id=${owner}`)[0].value;
 const protectedBefore=await invariant();
 await sql`update public.user_profiles set public_profile_blocked=true where user_id=${owner}`;
 assert.equal(await findPublicProfile(current.handle,deps.executeSql),null);
 const ensuredBlocked=await ensureUserProfile(owner,deps);
 assert.equal(ensuredBlocked.userId,owner);
 assert.equal((await sql`select public_profile_blocked from public.ensure_user_profile(${owner}::uuid)`)[0].public_profile_blocked,true);
 const changed=await updateUserProfile(owner,{avatarVariant:'pixel-teal',expectedRevision:ensuredBlocked.avatarRevision},deps);
 assert.equal(changed.avatarVariant,'pixel-teal');
 assert.equal((await sql`select public_profile_blocked from user_profiles where user_id=${owner}`)[0].public_profile_blocked,true);
 // This role is the real fixture service_role, not a renamed operator.
 await assert.rejects(sql.begin(async tx=>{
  // Temporary permissive fixture access proves the trigger itself, not a missing grant.
  // Entire transaction rolls back, including these grants/policy.
  await tx.unsafe('grant usage on schema public to service_role;grant select,update on public.user_profiles to service_role;create policy profile_block_fixture_access on public.user_profiles to service_role using(true) with check(true)');
  await tx.unsafe('set local role service_role');
  assert.equal((await tx`select public_profile_blocked from public.ensure_user_profile(${owner}::uuid)`)[0].public_profile_blocked,true);
  await tx`update public.user_profiles set public_profile_blocked=false where user_id=${owner}`;
 }),e=>e.code==='42501' && /requires database administrator/.test(e.message));
 await sql`update public.user_profiles set public_profile_blocked=false where user_id=${owner}`;
 assert.equal((await findPublicProfile(current.handle,deps.executeSql)).userId,owner);
 const afterBlock=(await sql`select to_jsonb(p) value from public.user_profiles p where user_id=${owner}`)[0].value;
 for(const key of Object.keys(blockBefore).filter(k=>!['avatar_variant','avatar_revision','updated_at'].includes(k)))assert.deepEqual(afterBlock[key],blockBefore[key],key);
 assert.deepEqual(await invariant(),protectedBefore,'block and unblock preserve Auth, finance, Poker, deletion and Storage');
 const newId=randomUUID();await sql`insert into auth.users(id) values(${newId})`;
 assert.equal((await sql`select public_profile_blocked from public.ensure_user_profile(${newId}::uuid)`)[0].public_profile_blocked,false,'signup trigger and composite default public ON');
 await sql`update public.user_profiles set public_profile_blocked=true where user_id=${capUser}`;
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

// Same dedicated disposable harness, actual Production 67 shape; no BIO contract here.
export async function assertProductionProfileEquivalents(sql,dbUrl){
 const target=new URL(dbUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname));
 assert.equal(process.env.CHIPS_MIGRATIONS_DISPOSABLE_CLUSTER_CONFIRMATION,'I_CONFIRM_THIS_CLUSTER_IS_DEDICATED_AND_DISPOSABLE');
 const [cluster]=await sql`select system_identifier::text from pg_control_system()`;assert.equal(cluster.system_identifier,process.env.CHIPS_MIGRATIONS_EXPECTED_SYSTEM_IDENTIFIER);
 // The historical runner creates a version-only history table; model observed Supabase metadata columns.
 await sql.unsafe('alter table supabase_migrations.schema_migrations add column if not exists name text,add column if not exists statements text[]');
 assert.equal(Number((await sql`select count(*) n from supabase_migrations.schema_migrations`)[0].n),67);
 assert.equal((await sql`select to_regclass('private.profile_terms_policy') t`)[0].t,null,'no Stage Phase A hidden inside Production baseline');
 // Model Supabase's observed per-role function defaults absent in bare PostgreSQL CI.
 await sql.unsafe('grant usage on schema public to anon,authenticated,service_role;revoke all on function public.ensure_user_profile(uuid),public.create_user_profile_after_signup() from public,anon,authenticated,service_role;grant execute on function public.ensure_user_profile(uuid),public.create_user_profile_after_signup() to anon,authenticated,service_role');
 const owner=(await sql`select user_id from public.user_profiles order by user_id limit 1`)[0].user_id;
 await sql`update public.user_profiles set avatar_key=${randomUUID()+'.webp'},bio='Synthetic legacy BIO' where user_id=${owner}`;
 const table=randomUUID();await sql`insert into public.poker_tables(id,created_by,max_players) values(${table},${owner},2)`;
 await sql`insert into public.chips_accounts(account_type,system_key,balance) values('ESCROW',${'POKER_TABLE:'+table},0)`;
 await sql`insert into public.poker_seats(table_id,user_id,seat_no,status,stack) values(${table},${owner},1,'INACTIVE',0)`;
 await sql`insert into public.poker_state(table_id,version,state) values(${table},42,${JSON.stringify({stacks:{[owner]:0},potTotal:0,phase:'WAITING',handId:'synthetic-contract'})})`;
 await sql`insert into public.poker_actions(table_id,user_id,version,action_type,amount) values(${table},${owner},42,'CHECK',0)`;

 const rows=async table=>plain(await sql.unsafe(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`));
 const tables=['auth.users','public.user_profiles','public.chips_accounts','public.chips_transactions','public.chips_entries','public.chips_transaction_idempotency','public.poker_state','public.poker_tables','public.poker_seats','public.poker_actions','public.account_deletion_requests','public.account_deletion_release','public.profile_avatar_uploads','private.account_avatar_objects','private.avatar_tracking_cutover','storage.buckets','storage.objects'];
 const snapshot=async()=>{const data={};for(const t of tables)data[t]=await rows(t);return data;};
 const before=await snapshot();
 const rawPhase=read('supabase/production-migrations/20261026120000_profile_phase_a.sql');
 const rawBlock=read('supabase/production-migrations/20261028180000_public_profile_block.sql');
 const {createHash}=await import('node:crypto');const hash=s=>createHash('sha256').update(s).digest('hex');
 const phase=rawPhase.replaceAll('7575202818581710058',cluster.system_identifier),block=rawBlock.replaceAll('7575202818581710058',cluster.system_identifier);
 const reject=async(text,pattern)=>{await assert.rejects(sql.unsafe(text),pattern);await sql.unsafe('rollback');};
 const metadata=async()=>plain(await sql`select * from supabase_migrations.schema_migrations order by version`);
 const originalHistory=await metadata();
 await reject(phase,/identity\/confirmation/);
 await sql.unsafe("set arcade.production_profile_confirmation='INSTALL PROFILE PHASE A otbqfijerkieoxwpxjnm'");
 await reject(phase,/source hash/);
 await sql`select set_config('arcade.production_profile_source_sha256',${hash(rawPhase)},false)`;
 await sql`insert into supabase_migrations.schema_migrations(version) values('20990101000000')`;
 await reject(phase,/history drift/);await sql`delete from supabase_migrations.schema_migrations where version='20990101000000'`;
 await reject(phase.replaceAll(cluster.system_identifier,'0'),/identity\/confirmation/);
 await sql.unsafe('create function public.fixture_profile_reader(uuid) returns public.user_profiles language sql security definer as $$select p.* from public.user_profiles p where user_id=$1$$');
 await reject(phase,/Unexpected related SECURITY DEFINER/);await sql.unsafe('drop function public.fixture_profile_reader(uuid)');
 const locker=postgres(dbUrl,{max:1,prepare:false});try{await locker.begin(async tx=>{await tx.unsafe("select pg_advisory_xact_lock(hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0))");await reject(phase,/coordination busy/);});}finally{await locker.end();}
 await reject(phase.replace(/commit;\s*$/i,'select 1/0;commit;'),e=>e.code==='22012');
 assert.equal((await sql`select to_regclass('private.profile_terms_policy') t`)[0].t,null);assert.deepEqual(await snapshot(),before);assert.deepEqual(await metadata(),originalHistory);
 // Operator batch: exactly the two reviewed operational bodies, no nested BEGIN/COMMIT.
 const core=text=>text.replace(/^begin;$/m,'').replace(/commit;\s*$/i,'');
 const pair="begin;set local arcade.production_profile_confirmation='INSTALL PROFILE PHASE A otbqfijerkieoxwpxjnm';set local arcade.production_profile_source_sha256='"+hash(rawPhase)+"';\n"+core(phase)+"\nset local arcade.production_profile_confirmation='INSTALL PUBLIC PROFILE BLOCK otbqfijerkieoxwpxjnm';set local arcade.production_profile_source_sha256='"+hash(rawBlock)+"';\n"+core(block)+"\ncommit;";
 await reject(pair.replace(/commit;\s*$/i,'select 1/0;commit;'),e=>e.code==='22012');assert.deepEqual(await snapshot(),before);assert.deepEqual(await metadata(),originalHistory);assert.equal((await sql`select to_regclass('private.profile_terms_policy') t`)[0].t,null);
 await sql.unsafe('begin;'+core(phase));
 const phaseData=await snapshot();for(const row of phaseData['public.user_profiles']){assert.equal(row.value.avatar_revision,1);assert.equal(row.value.google_photo_suppressed,false);delete row.value.avatar_revision;delete row.value.google_photo_suppressed;}assert.deepEqual(phaseData,before);
 await sql.unsafe("set arcade.production_profile_confirmation='INSTALL PUBLIC PROFILE BLOCK otbqfijerkieoxwpxjnm'");
 await sql`select set_config('arcade.production_profile_source_sha256',${hash(rawBlock)},false)`;
 const beforeBlock=await snapshot(),history68=await metadata();
 const rejectBlock=async(text,pattern)=>{await sql.unsafe('savepoint block_attempt');await assert.rejects(sql.unsafe(text),pattern);await sql.unsafe('rollback to savepoint block_attempt');};
 await sql`update supabase_migrations.schema_migrations set statements=array['source_sha256=drift'] where version='20261026120000'`;await rejectBlock(core(block),/source receipt drift/);await sql`update supabase_migrations.schema_migrations set statements=${['source_sha256='+hash(rawPhase)]} where version='20261026120000'`;
 await rejectBlock(core(block)+'select 1/0;',e=>e.code==='22012');assert.deepEqual(await snapshot(),beforeBlock);assert.deepEqual(await metadata(),history68);
 await sql.unsafe(core(block));
 const after=await snapshot();for(const row of after['public.user_profiles']){assert.equal(row.value.public_profile_blocked,false);delete row.value.public_profile_blocked;}assert.deepEqual(after,beforeBlock);
 await sql.unsafe('rollback');assert.deepEqual(await snapshot(),before);assert.deepEqual(await metadata(),originalHistory);
 // Positive Production path: one outer BEGIN, unchanged operational bodies, one final COMMIT.
 assert.equal((pair.match(/^begin;|^commit;$/gm)||[]).length,2);
 await sql.unsafe(pair);
 const committed=await snapshot();for(const row of committed['public.user_profiles']){assert.equal(row.value.avatar_revision,1);assert.equal(row.value.google_photo_suppressed,false);assert.equal(row.value.public_profile_blocked,false);delete row.value.avatar_revision;delete row.value.google_photo_suppressed;delete row.value.public_profile_blocked;}assert.deepEqual(committed,before);
 const committedHistory=await metadata();assert.deepEqual(committedHistory.filter(r=>!['20261026120000','20261028180000'].includes(r.version)),originalHistory);
 for(const [version,source] of [['20261026120000',rawPhase],['20261028180000',rawBlock]])assert.deepEqual(committedHistory.find(r=>r.version===version).statements,['source_sha256='+hash(source)]);
 assert.equal(Number((await sql`select count(*) n from supabase_migrations.schema_migrations`)[0].n),69);
 await sql.unsafe("set arcade.production_profile_confirmation='INSTALL PUBLIC PROFILE BLOCK otbqfijerkieoxwpxjnm'");
 await sql`select set_config('arcade.production_profile_source_sha256',${hash(rawBlock)},false)`;
 await reject(block,/history drift/);
 for(const role of ['anon','authenticated']){
  await assert.rejects(sql.begin(async tx=>{await tx.unsafe('set local role '+role);await tx`select public.ensure_user_profile(${owner}::uuid)`;}),e=>e.code==='42501');
  assert.equal((await sql`select has_function_privilege(${role},'public.create_user_profile_after_signup()','EXECUTE') allowed`)[0].allowed,false);
 }
 assert.equal((await sql`select has_table_privilege('service_role','private.profile_terms_policy','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('service_role','private.profile_terms_receipts','UPDATE,TRUNCATE') unexpected`)[0].unexpected,false);
 const id=randomUUID();await sql`insert into auth.users(id) values(${id})`;
 await sql.begin(async tx=>{await tx.unsafe('set local role service_role');const [p]=await tx`select * from public.ensure_user_profile(${id}::uuid)`;assert.equal(p.user_id,id);assert.ok(PUBLIC_AVATAR_VARIANTS.slice(0,6).includes(p.avatar_variant));assert.equal(p.public_profile_blocked,false);});
 const deps={env:{ACCOUNT_DELETION_ENABLED:'0'},executeSql:(q,p=[])=>sql.unsafe(q,p),beginSql:fn=>sql.begin(fn),syncLeaderboardVisibility:async()=>{}};
 const p=await ensureUserProfile(owner,deps);assert.ok(p.avatarKey,'legacy avatar key retained');
 const status=await import('../../shared/profile-terms.mjs');const terms=await sql.begin(tx=>status.readTermsStatus(tx,{kind:'account',id:owner}));assert.equal(terms.required,false);assert.equal(terms.variantsEnabled,false);assert.equal(terms.version,'2026-10-26-a1');
 const {readLeaderboardProfiles}=await import('../../netlify/functions/_shared/xp-leaderboard-read.mjs');
 await updateUserProfile(owner,{leaderboardVisible:true},deps);assert.equal((await readLeaderboardProfiles([owner],deps.executeSql)).size,1);
 await sql`update public.user_profiles set public_profile_blocked=true where user_id=${owner}`;assert.equal(await findPublicProfile(p.handle,deps.executeSql),null);assert.equal((await readLeaderboardProfiles([owner],deps.executeSql)).size,0);
 const {createProfileMeHandler}=await import('../../netlify/functions/profile-me.mjs');
 const handler=createProfileMeHandler({verifySupabaseJwt:async()=>({valid:true,userId:owner}),ensureUserProfile:id=>ensureUserProfile(id,deps),updateUserProfile:(id,patch)=>updateUserProfile(id,patch,deps)});
 const event={httpMethod:'GET',headers:{origin:'https://arcade.test',authorization:'Bearer fixture'},queryStringParameters:{}};
 assert.equal((await handler(event)).statusCode,200);
 assert.equal((await handler({...event,httpMethod:'PATCH',body:JSON.stringify({leaderboardVisible:true})})).statusCode,200);
 const freshProfile=await ensureUserProfile(id,deps);assert.equal((await updateUserProfile(id,{avatarVariant:'fox-blue',expectedRevision:freshProfile.avatarRevision},deps)).avatarVariant,'fox-blue');
 await assert.rejects(updateUserProfile(id,{avatarVariant:'zen-lime',expectedRevision:freshProfile.avatarRevision},deps),{code:'avatar_variants_not_active'});
 await assert.rejects(updateUserProfile(id,{avatarVariant:'falcon-orange',expectedRevision:freshProfile.avatarRevision},deps),{code:'stale_avatar_revision'});
 assert.equal((await sql`select public_profile_blocked from public.ensure_user_profile(${owner}::uuid)`)[0].public_profile_blocked,true);
 await assert.rejects(sql.begin(async tx=>{await tx.unsafe('grant select,update on public.user_profiles to service_role;create policy fixture_profile_operator_guard on public.user_profiles to service_role using(true) with check(true);set local role service_role');await tx`update public.user_profiles set public_profile_blocked=false where user_id=${owner}`;}),e=>e.code==='42501');
 await sql`update public.user_profiles set public_profile_blocked=false where user_id=${owner}`;
 // Execute actual old deployed reader/owner/WS source, with all SQL pinned to this fixture.
 const {execFileSync}=await import('node:child_process');const {pathToFileURL}=await import('node:url');const path=await import('node:path');const os=await import('node:os');
 const sha='a63e44b0d9a1d3625956ed98b75c1242989efdd3';
 const files=['netlify/functions/_shared/user-profile.mjs','netlify/functions/profile-me.mjs','shared/profile-avatar-projection.mjs','ws-server/poker/profile/public-profile-repository.mjs','ws-server/poker/read-model/public-poker-identity.mjs'];
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pr1155-old-readers-'));const locations=new Map(files.map(f=>[f,path.join(dir,f)]));
 for(const f of files){const source=execFileSync('git',['show',sha+':'+f],{encoding:'utf8'});const code=source.replace(/(from\s+|import\s*)(['"])(\.[^'"]+)\2/g,(all,prefix,quote,relative)=>{const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(f),relative));return prefix+quote+pathToFileURL(locations.get(resolved)||path.resolve(resolved)).href+quote;});fs.mkdirSync(path.dirname(locations.get(f)),{recursive:true});fs.writeFileSync(locations.get(f),code);}
 const old=await import(pathToFileURL(locations.get(files[0])).href);const oldProfile=await old.ensureUserProfile(owner,deps);assert.equal(oldProfile.userId,owner);assert.equal(old.ownerProfile(oldProfile).bio,'Synthetic legacy BIO');assert.equal((await old.findPublicProfile(oldProfile.handle,deps.executeSql)).userId,owner);
 const {createProfileMeHandler:oldHandler}=await import(pathToFileURL(locations.get(files[1])).href);assert.equal((await oldHandler({verifySupabaseJwt:async()=>({valid:true,userId:owner}),ensureUserProfile:id=>old.ensureUserProfile(id,deps)})(event)).statusCode,200);
 const {createPublicProfileRepository}=await import(pathToFileURL(locations.get(files[3])).href);const ws=await createPublicProfileRepository({env:{SUPABASE_DB_URL:dbUrl},beginSql:fn=>sql.begin(fn)}).loadPublicProfiles([owner]);assert.equal(ws[owner].handle,p.handle);
 const oldApi=oldHandler({verifySupabaseJwt:async()=>({valid:true,userId:owner}),ensureUserProfile:id=>old.ensureUserProfile(id,deps),updateUserProfile:(id,patch)=>old.updateUserProfile(id,patch,deps)});
 assert.equal((await oldApi({...event,httpMethod:'PATCH',body:JSON.stringify({bio:'Synthetic legacy BIO'})})).statusCode,200);
 const {assertAccountActive}=await import('../../shared/account-deletion.mjs');
 await sql.begin(async tx=>{await requestDeletion(tx,id);await assert.rejects(tx.savepoint(sp=>assertAccountActive(sp,id)),{code:'account_not_active'});throw Object.assign(new Error('synthetic deletion rollback'),{fixtureRollback:true});}).catch(e=>{if(!e.fixtureRollback)throw e;});
 const financialAfter=await snapshot();for(const t of tables.filter(t=>!['auth.users','public.user_profiles'].includes(t)))assert.deepEqual(financialAfter[t],before[t],t);
 process.stdout.write('[klog] production_profile_equivalents PASS: exact67→69; OFF/6; profiles preserved; RPC denied; signup/backend/owner/CAS/leaderboard/block; late rollback; actual old deployed SQL readers/owner PATCH executed; protectedProfiles='+before['public.user_profiles'].length+'\n');
}
